# API OpenAI-compatible (`/v1/openai/*`)

A Adalink expõe uma superfície **compatível com a API da OpenAI** para integrações
externas (SDKs oficiais, LibreChat, n8n, LangChain, etc.) e para a API pública
whitelabel. Qualquer cliente OpenAI funciona trocando apenas **baseURL + API key**.

- **Base URL**: `https://<gateway>/v1/openai` (produção: `https://adalink-api-gateway.onrender.com/v1/openai`)
- **Endpoints**: `POST /chat/completions` (stream e não-stream) e `GET /models`
- **Inferência**: sempre via **Vercel AI Gateway** com a chave da plataforma
  (env `AI_GATEWAY_API_KEY`) ou BYO-LLM da organização — a chave de provider
  **nunca** transita no request.
- **Billing e governança valem integralmente**: todo turno passa por saldo de
  créditos, model-policy da org e allowlist por centro de custo, e emite
  `usage.recorded` para débito na wallet (fonte `GATEWAY` debita; `BYO` não).

## Autenticação

| Método | Como | Uso |
|---|---|---|
| **Bearer com app token** | `Authorization: Bearer <app-token>` | O caminho para SDKs OpenAI: a "API key" do SDK é um app token da Adalink (criado em `POST /gateway/app-tokens`). Aceito **somente** no prefixo `/v1/openai` — um Bearer sem estrutura de JWT é validado como app token (mesma validação criptográfica, cache e rate-limit do `x-ada-token`). |
| **`x-ada-token`** | header `x-ada-token: <app-token>` | Continua aceito, para clientes que já usam o padrão da plataforma. |
| **Bearer JWT** | `Authorization: Bearer <jwt>` | JWT de usuário (Better Auth) também funciona no prefixo. |

Erros de autenticação respondem no envelope OpenAI:

```json
{ "error": { "message": "Chave de API inválida ou expirada. Use um app token da Adalink como Bearer ou no header x-ada-token.", "type": "invalid_request_error", "code": "invalid_api_key" } }
```

Rate-limit de app token **preserva o 429** (`type: rate_limit_error`,
`code: rate_limit_exceeded`) para o SDK aplicar backoff/retry — nunca é
mascarado como 401. JWT sem organização preserva o 403 (`request_forbidden`).

## Semântica do `model` (dual)

| Valor | Comportamento |
|---|---|
| `<gatewayId>` do catálogo curado (ex.: `anthropic/claude-sonnet-4.6`) | **Passthrough sem especialista**: sem prompt de especialista, sem RAG/skills. Governança, saldo e billing valem normalmente. |
| `assistant:<uuid>` | Conversa com o **especialista** da organização (skills, RAG, conectores e gate de aprovação valem); o modelo pinado do especialista é autoritativo. Visibilidade validada (especialista de outra org → `model_not_found`). |
| Desconhecido | `404` com `code: model_not_found`. |

`GET /v1/openai/models` lista o catálogo curado no shape OpenAI
(`{object:'list', data:[{id, object:'model', owned_by:'adalink'}]}`).

> **M1**: `assistant:<slug>` não é suportado (apenas UUID) e os especialistas
> não aparecem em `GET /models` — obtenha o UUID em `GET /v1/specialists`.

## Extensão `chat_id` — histórico server-side

Sem `chat_id`, a API é **stateless**: `messages[]` do request é a fonte da
verdade do turno (uma conversa interna é criada mesmo assim, para billing e
auditoria). Com `chat_id`, o backend guarda e reidrata o histórico:

- Envie o UUID no campo `chat_id` do body **ou** no header `x-chat-id`
  (body prevalece).
- Primeira chamada cria a conversa com esse id; as seguintes **reidratam o
  histórico server-side** — o cliente pode mandar só a mensagem nova.
- Isolamento de tenant: se o id pertence a outro usuário/organização, uma
  conversa **nova** é criada com id próprio (nunca há vazamento). O id efetivo
  volta sempre no header `x-chat-id` da resposta e no `id` do completion
  (`chatcmpl-<uuid>`) — compare com o enviado para detectar reatribuição.
- Funciona também no modo `assistant:` (vira a conversa daquele especialista).

## Request (subset M1)

```json
{
  "model": "anthropic/claude-sonnet-4.6",
  "messages": [
    { "role": "system", "content": "Você é um analista financeiro." },
    { "role": "user", "content": "Resuma o fluxo de caixa do trimestre." }
  ],
  "stream": true,
  "temperature": 0.7,
  "max_tokens": 1024,
  "chat_id": "0197a3b2-1111-7222-8333-444455556666"
}
```

Campos aceitos: `model`, `messages` (roles `system`/`user`/`assistant`,
`content` string), `stream`, `temperature`, `max_tokens`, `chat_id`, `user`
(ignorado). Campos desconhecidos são **ignorados silenciosamente**
(comportamento OpenAI). `tools`, `response_format` e conteúdo multimodal
(imagens) ficam para o M2.

## Resposta

- **`stream: true`** — SSE com chunks `chat.completion.chunk`
  (`choices:[{delta:{content}}]`), `finish_reason` no último chunk e terminador
  `data: [DONE]`. Erros de negócio no meio do stream (ex.: saldo) chegam como
  chunk de erro antes do `[DONE]`.
- **`stream: false`** — objeto `chat.completion` com
  `choices[0].message.content`.

> **M1**: o campo `usage` do não-stream vem **zerado** (a contabilização de
> tokens acontece de forma assíncrona no fim do pipeline). O **débito de
> créditos acontece normalmente** — apenas o eco no JSON é placeholder;
> confira o consumo em `GET /v1/usage`.

## Erros (envelope OpenAI)

| Situação | Status | `code` |
|---|---|---|
| Credencial inválida/expirada | 401 | `invalid_api_key` |
| Modelo/assistant desconhecido ou invisível | 404 | `model_not_found` |
| Saldo de créditos insuficiente | 429 | `insufficient_quota` |
| Modelo bloqueado pela allowlist do centro de custo | 403 | `model_blocked` |
| Rate-limit de app token | 429 | `rate_limit_exceeded` |
| Usuário sem organização | 403 | `request_forbidden` |

## Exemplos

### curl

```bash
curl https://<gateway>/v1/openai/chat/completions \
  -H "Authorization: Bearer $ADALINK_APP_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"model":"anthropic/claude-sonnet-4.6","messages":[{"role":"user","content":"Olá!"}]}'
```

### SDK OpenAI (Python)

```python
from openai import OpenAI

client = OpenAI(
    base_url="https://<gateway>/v1/openai",
    api_key=os.environ["ADALINK_APP_TOKEN"],
)

stream = client.chat.completions.create(
    model="assistant:0190a1c4-0000-7000-8000-00000000a1c4",
    messages=[{"role": "user", "content": "Resuma o pipeline de vendas."}],
    stream=True,
    extra_body={"chat_id": "0197a3b2-1111-7222-8333-444455556666"},
)
for chunk in stream:
    print(chunk.choices[0].delta.content or "", end="")
```

### SDK OpenAI (Node)

```ts
import OpenAI from 'openai';

const client = new OpenAI({
  baseURL: 'https://<gateway>/v1/openai',
  apiKey: process.env.ADALINK_APP_TOKEN,
});

const completion = await client.chat.completions.create({
  model: 'anthropic/claude-sonnet-4.6',
  messages: [{ role: 'user', content: 'Olá!' }],
});
console.log(completion.choices[0].message.content);
```

### LibreChat / n8n

Configure um endpoint "OpenAI compatible" com:

- **Base URL**: `https://<gateway>/v1/openai`
- **API Key**: um app token da Adalink
- **Models**: buscados automaticamente de `GET /models`, ou informe um
  `assistant:<uuid>` manualmente para falar com um especialista.

## Billing e auditoria

Cada turno emite um evento `usage.recorded` com
`metadata.source: 'openai-compat'`, `conversationId` (o `chat_id` efetivo) e
`specialistId` apenas no modo `assistant:`. O credits-service resolve o pricing
pelo `modelName` e debita a wallet da organização. Consulte:

- `GET /v1/usage` — eventos de consumo (feature `CHAT`)
- `GET /v1/wallet` — saldo da organização

Organizações com **BYO-LLM** (chave própria de provider) têm o turno marcado
como `usageSource: 'BYO'` e **não** são debitadas em créditos — o custo é pago
direto ao provider.

## Limitações do M1

1. `usage` zerado no não-stream (billing ocorre; eco no JSON é placeholder).
2. `assistant:<slug>` não suportado — apenas UUID.
3. `GET /models` não lista os especialistas da org.
4. Sem `tools`, `response_format`, `n > 1`, `logprobs` ou conteúdo multimodal.

## Referências de implementação

- Guia de uso para apps integrados (SSO + agentes + este endpoint): [INTEGRATED-APPS-GUIDE.md](./INTEGRATED-APPS-GUIDE.md)
- Gateway (auth + roteamento): `apps/api-gateway/src/auth/openai-compat-path.ts`,
  `apps/api-gateway/src/auth/jwt-auth.guard.ts`, `apps/api-gateway/src/proxy/proxy.service.ts`
- Chat-service (controller + tradutores): `apps/chat-service/src/infrastructure/http/controllers/openai-compat.controller.ts`,
  `apps/chat-service/src/application/openai-compat/`
- Testes de regressão: `.claude/skills/regression-test/SKILL.md` — seção 24
