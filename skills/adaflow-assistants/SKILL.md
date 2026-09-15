---
name: adaflow-assistants
description: Integra este app a um especialista (assistant) do Adaflow via API OpenAI-compatible com assistant:<uuid> — skills, conectores, tools MCP, memória server-side e governança. Use quando o pedido for conversar com um especialista/assistant da plataforma Adalink ou expor tools do app para um especialista via MCP.
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Integração com Adaflow Assistants (especialistas)

Conecta este app a um **especialista** da organização via API
OpenAI-compatible. Fonte de verdade: o
[guia de apps integrados](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/docs/INTEGRATED-APPS-GUIDE.md)
(seções 3, 3.1 e 3.2) e o
[contrato OpenAI-compat](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/docs/OPENAI-COMPAT.md).

## Quando usar este modo (vs chat genérico)

Use assistants quando o agente será usado no Adaflow E/OU em outros projetos,
ou quando precisa de conectores, skills, tools MCP ou memória. O agente é
criado e mantido **no Adaflow** (prompt, modelo, tools) — o app só consome.
Para chamada pontual de LLM (classificação, extração), use a skill
`adaflow-generic-chat`. Tabela de decisão completa na seção 3.1 do guia.

> ⚠️ **RAG não vale por API.** Bases de conhecimento vinculadas ao
> especialista só são consultadas no chat da UI do Adaflow — NÃO nas chamadas
> `assistant:<uuid>`. Não prometa respostas baseadas nessas bases no app. Se
> o assistente precisa de dados/documentos do app, exponha a busca como tool
> MCP (passo 2).

## Passos de implementação

1. **Descobrir o UUID do especialista** (não aparece em `GET /models`;
   `assistant:<slug>` não é suportado no M1):

   ```bash
   # usuário logado
   curl "https://adalink-api-gateway.onrender.com/v1/specialists" -H "Authorization: Bearer $JWT"
   # server-side: app token SÓ no x-ada-token aqui (Bearer → 401 invalid_token)
   curl "https://adalink-api-gateway.onrender.com/v1/specialists" -H "x-ada-token: $ADALINK_APP_TOKEN"
   ```

   Guarde o UUID em env (ex.: `ADAFLOW_ASSISTANT_ID`) em vez de listar a cada
   request.

2. **(Opcional) Tools do app via MCP** — para o especialista consultar dados
   do app: exponha um servidor MCP (Streamable HTTP, autenticação Bearer),
   cadastre-o na organização no Adaflow e habilite as tools no especialista.
   As tools executam no servidor da plataforma; o app recebe só o texto final.
   Nomes viram `mcp_<servidor>_<tool>` — servidor em minúsculas com
   `[^a-z0-9]` → `_` (ex.: `BIB Normas-Bacen` + `buscar_norma` →
   `mcp_bib_normas_bacen_buscar_norma`). Use o nome completo no prompt do
   especialista quando citar tools.

3. **Chat via SDK OpenAI** — trocar só `baseURL` + API key:

   ```python
   from openai import OpenAI

   # api_key vai como Bearer. Exceção do /v1/openai: app token é aceito como
   # Bearer aqui. Com usuário logado no fluxo, use o JWT do handoff.
   client = OpenAI(
       base_url="https://adalink-api-gateway.onrender.com/v1/openai",
       api_key=credencial,
   )
   stream = client.chat.completions.create(
       model="assistant:<uuid-do-especialista>",
       messages=[{"role": "user", "content": "..."}],
       stream=True,
       extra_body={"chat_id": chat_id},  # memória server-side
   )
   ```

4. **Memória com `chat_id`** — envie um UUID no body (`chat_id`) ou header
   `x-chat-id`; os turnos seguintes reidratam o histórico server-side (mande
   só a mensagem nova). SEMPRE persista o id efetivo que volta no header
   `x-chat-id` da resposta — se o id enviado pertencer a outro
   usuário/organização, o backend cria conversa nova com id próprio.

## Regras

- Credencial: JWT do usuário logado preferido (skill `adaflow-sso`); app
  token só server-to-server (ver seção "Credenciais" do guia).
- O modelo pinado do especialista é autoritativo — `temperature`/`max_tokens`
  do request não trocam o modelo.
- Especialista de outra org responde `404 model_not_found` — não tratar como
  bug, é isolamento de tenant.
- Governança e billing valem: saldo (`429 insufficient_quota`) e allowlist
  (`403 model_blocked`) são condições do tenant — mostre aviso informativo ao
  usuário, não erro de sistema.
- Mesmas limitações do chat genérico: `response_format` e `tools` do cliente
  são descartados sem erro; `content` multimodal → `400`.
- **Sem usuário logado (página pública)**: app token só no servidor do app,
  token dedicado, rate-limit na rota do app, `model` e `max_tokens` fixados no
  servidor — seção 3.3 do guia.

## Validação

1. `GET /v1/specialists` retorna o especialista esperado; chat com
   `assistant:<uuid>` responde seguindo o prompt dele (perguntar algo que só
   o prompt ou uma tool MCP do especialista responde — NÃO use pergunta sobre
   bases de conhecimento, o RAG não vale por API).
2. Memória: 2 turnos com o mesmo `chat_id`, o segundo enviando SÓ a mensagem
   nova — a resposta deve referenciar o turno 1.
3. Erros: UUID inexistente → `404 model_not_found`; nenhum erro engolido
   silenciosamente (todo catch loga e dá feedback na UI).
