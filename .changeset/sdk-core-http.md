---
'@adaflow/sdk': minor
---

Núcleo HTTP para hosts que já autenticam e para uso em produção:

- `authFetch`: `fetch` já autenticado (ex.: sessão por cookie). O SDK não envia
  credencial própria e recusa combiná-lo com `jwt` ou `appToken`. Uploads para
  URLs pré-assinadas continuam no `fetch` comum, sem vazar o Bearer.
- `client`: envia o header `x-ada-client` (atribuição de uso no gateway).
- `timeoutMs` no client e por chamada, e `signal` por chamada (`CallOptions`),
  já repassados em `chat` e `agents`. O prazo vale até os headers chegarem.
- Retry com backoff e jitter só para GET, em erro de rede e 502/503/504,
  respeitando `Retry-After`. Nunca repete 401. `retry: false` desliga.
- `baseUrl` aceita `''` ou caminho relativo para chamadas na mesma origem.
