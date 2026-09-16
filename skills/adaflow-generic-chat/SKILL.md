---
name: adaflow-generic-chat
description: Integra este app ao chat genérico OpenAI-compatible da plataforma Adalink (/v1/openai/chat/completions com modelo do catálogo) para chamadas pontuais de LLM — classificação, extração, sumarização. Use quando o pedido for uma chamada genérica de LLM via Adalink sem especialista.
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Integração com Adaflow Generic Chat (OpenAI-compatible)

Chamada **genérica e pontual** a uma LLM do catálogo via a superfície
OpenAI-compatible. Fonte de verdade: o
[guia de apps integrados](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/docs/INTEGRATED-APPS-GUIDE.md)
(seções 3 e 3.1) e o
[contrato OpenAI-compat](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/docs/OPENAI-COMPAT.md)
(request, erros, limitações do M1).

## Antes de tudo: o que NÃO funciona nesta rota

Verifique a chamada que vai migrar. Se ela depender de algo abaixo, **não
aponte para o Adaflow ainda** — o gateway responde `200` e o resultado sai
errado sem nenhum erro:

- **Saída estruturada** — `response_format` é descartado. `generateObject` /
  `streamObject` (AI SDK) e `beta.chat.completions.parse` (SDK OpenAI) NÃO
  funcionam. Procure no código por `generateObject`, `streamObject`,
  `response_format`, `json_schema`, `Output.object` antes de trocar o provider.
- **`tools` do cliente** — descartadas. Tools só via especialista + MCP
  (skill `adaflow-assistants`).
- **PDF/imagem na mensagem** — `content` que não é string responde `400`.
  Extraia o texto no app antes.

Se a pipeline precisa de JSON e não dá para esperar o suporte: peça o JSON
no prompt e valide o `content` com o schema (`zod.safeParse`), tratando
falha de parse como erro com retry (seção 3.4 do guia).

## Quando usar este modo (vs assistants)

Use o chat genérico para transformações pontuais de texto — classificação,
extração de campos, sumarização, tradução, moderação — em que o prompt vive
no código do app. Se o agente será reutilizado no Adaflow/outros apps, ou
precisa de conectores/tools MCP/memória, use a skill `adaflow-assistants` (o agente
é criado no Adaflow). Tabela de decisão na seção 3.1 do guia.

## Passos de implementação

1. **Escolher o modelo**: `GET /v1/openai/models` lista o catálogo curado no
   shape OpenAI. Para tarefas simples (classificação), prefira um modelo
   barato/rápido (ex.: `anthropic/claude-haiku-4.5`).

2. **Chamada via SDK OpenAI** — trocar só `baseURL` + API key:

   ```ts
   import OpenAI from 'openai';

   // apiKey vai como Bearer. Exceção do /v1/openai: app token é aceito como
   // Bearer aqui. Com usuário logado no fluxo, use o JWT do handoff.
   const client = new OpenAI({
     baseURL: 'https://adalink-api-gateway.onrender.com/v1/openai',
     apiKey: credencial,
   });

   const completion = await client.chat.completions.create({
     model: 'anthropic/claude-haiku-4.5',
     messages: [
       { role: 'system', content: 'Classifique o ticket em urgente|normal|baixo. Responda só a label.' },
       { role: 'user', content: textoDoTicket },
     ],
     temperature: 0,
   });
   ```

3. **Stateless por padrão** — sem `chat_id`, cada request é independente e o
   `messages[]` é a fonte da verdade do turno. Para histórico server-side,
   `chat_id` funciona também no modo genérico, mas se você precisa de memória
   de agente, reavalie se o caso não é de especialista (seção 3.1 do guia).

## Regras e limitações (M1)

- Credencial: server-to-server → app token; com usuário logado → JWT
  (ver seção "Credenciais" do guia). Nunca enviar `x-ada-token` E
  `Authorization` juntos — o `x-ada-token` prevalece e o Bearer é ignorado.
- Pedir modelo concreto exige a permissão `chat.models.select` no usuário da
  credencial (no app token, o usuário criador) — sem ela, `403 model_blocked`.
- Subset M1: sem `tools`, `response_format`, `n > 1` nem multimodal (ver
  seção acima). Campos desconhecidos são descartados sem erro.
- `usage` vem real ou omitido (nunca zerado); no stream, peça com
  `stream_options: { include_usage: true }`. Fonte de verdade do consumo:
  `GET /v1/usage`.
- `finish_reason: "length"` = resposta truncada por `max_tokens` (pode vir
  com `content` vazio) — trate como falha, não como resposta.
- Billing/governança valem: saldo (`429 insufficient_quota`), model-policy,
  allowlist (`403 model_blocked`). Saldo zerado é condição do tenant →
  aviso informativo ao usuário, nunca erro de sistema.

## Validação

1. `GET /v1/openai/models` responde e contém o modelo escolhido.
2. Chamada não-stream retorna `choices[0].message.content` coerente;
   `stream: true` entrega chunks e termina com `data: [DONE]`.
3. Modelo inventado → `404 model_not_found` no envelope OpenAI.
4. Consumo aparece em `GET /v1/usage` com `metadata.source: 'openai-compat'`.
5. Se a chamada espera JSON: teste com entrada que force um campo
   obrigatório/enum e confirme que o app **rejeita** resposta fora do schema
   (não basta um caso feliz).
