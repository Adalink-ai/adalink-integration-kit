# @adaflow/sdk

## 0.8.0

### Minor Changes

- 3c52c84: `createSsoSession` renova o JWT sem redirect. Com a opção nova `authUrl`
  (gateway do Adaflow ou proxy do app que repasse `/v1/auth/*`), o
  `completeLogin()` troca o `#sso_code` do handoff por uma sessão de 7 dias
  (`POST /v1/auth/partner/handoff/exchange`) e o JWT de 15 minutos passa a ser
  renovado em `GET /v1/auth/token`, com single-flight e reenvio único da request
  que tomou 401. O redirect ao handoff, com as defesas anti-loop, fica para quando
  a sessão de 7 dias vence ou é encerrada.

  - `session.refresh()` para quem usa interceptor próprio.
  - `session.logout()` também encerra a sessão de 7 dias (melhor esforço).
  - `consumeSsoFragment()` devolve `{ token, code }`.

  Sem `authUrl`, ou com um Adaflow que ainda não emite `sso_code`, o comportamento
  é o da 0.6.

## 0.7.0

### Minor Changes

- 3d8790e: Repositórios e especialistas: `repositories.list` (busca e paginação), `repositories.removeFile`, `specialists.unlinkRepository` e os tipos `RepositoryFile`/`RepositoryPage` (`listFiles` deixa de devolver `unknown`; inclui `fileHash` e `fileUpdatedAt` quando a plataforma expõe). Quebra de tipo pequena: quem fazia `as { items: ... }` direto no retorno de `listFiles` passa a precisar de `as unknown as ...` (o retorno real sempre foi um array). Documentação corrigida: as chamadas `assistant:<uuid>` via `/v1/openai` aplicam o RAG do especialista, usando a última mensagem do usuário como consulta.

### Patch Changes

- 1793c4b: `DEFAULT_BASE_URL` passa a ser `https://zeus.adalink.app`, a mesma API que o frontend do Adaflow usa e o issuer do JWT. `adaflow.adalink.ai` só repassa `/v1/auth/*` ao backend, então não serve como base da API.

## 0.6.1

### Patch Changes

- 73d0fca: Corrige a URL do Adaflow para `https://adaflow.adalink.ai` no template NextJS (padrão do SSO e `.env.example`) e no exemplo do README do SDK, que traziam `app.adalink.ai`. O README passa a indicar a URL do JWKS (`https://adaflow.adalink.ai/v1/auth/jwks`).

## 0.6.0

### Minor Changes

- 24f244a: Recurso `documents` (`/v1/documents`), com o domínio inteiro:

  - `upload` (presign → PUT com o `Content-Type` assinado, sem Bearer → confirm),
    além de `presign`/`confirm` separados e `importFromProvider`.
  - `list` (por espaço, com status, thumbnails e `limit`/`offset`), `get`,
    `delete` (204), `reprocess`, `reindex`, `mediaContent`, `thumbnail` (`null`
    em 204) e `pages`.
  - `waitUntilProcessed` e `isDocumentSettled`: a plataforma não tem stream de
    progresso de documento, então o helper consulta até extração e indexação
    terminarem.
  - O contêiner se chama Espaço (`spaceId`); o SDK traduz para o `projectId` da
    plataforma nos dois sentidos.

## 0.5.0

### Minor Changes

- 4cef50d: Núcleo HTTP para hosts que já autenticam e para uso em produção:

  - `authFetch`: `fetch` já autenticado (ex.: sessão por cookie). O SDK não envia
    credencial própria e recusa combiná-lo com `jwt` ou `appToken`. Uploads para
    URLs pré-assinadas continuam no `fetch` comum, sem vazar o Bearer.
  - `client`: envia o header `x-ada-client` (atribuição de uso no gateway).
  - `timeoutMs` no client e por chamada, e `signal` por chamada (`CallOptions`),
    já repassados em `chat` e `agents`. O prazo vale até os headers chegarem.
  - Retry com backoff e jitter só para GET, em erro de rede e 502/503/504,
    respeitando `Retry-After`. Nunca repete 401. `retry: false` desliga.
  - `baseUrl` aceita `''` ou caminho relativo para chamadas na mesma origem.

- 0a010d7: Trilha e acesso do lado servidor, para o admin do Adaflow saber quem acessou o
  app e que trilha a pessoa fez:

  - `createJwtVerifier`: verifica o JWT do Adaflow pelo JWKS com EdDSA fixo
    (contra confusão de algoritmo), `exp`/`nbf` com folga, `iss`/`aud` opcionais,
    cache do JWKS e nova busca em rotação de chave com cooldown. Erros tipados em
    `AdaflowTokenError.code`. Sem dependência: usa WebCrypto.
  - `recordAppAccess` / `buildAccessEvent`: registra o acesso ao app
    (`app.acesso.login` ou `app.acesso.negado`, categoria `acesso`) assinado com o
    JWT da pessoa, idempotente por sessão do Adaflow. Nunca lança.
  - `defineAuditEvents`: catálogo de eventos validado na definição, com `eventId`
    UUID v5 determinístico (`uuidV5`) para reenvios idempotentes.

## 0.4.0

### Minor Changes

- 79243a5: `chat.stream()` aceita `includeUsage: true` (envia `stream_options.include_usage`)
  e o `ChatCompletionChunk` passa a tipar o chunk final com `usage` e `choices: []`.
  Novo tipo exportado `ChatUsage`. A documentação dos tipos de chat foi corrigida
  para o comportamento real da plataforma: `usage` vem real ou omitido (não mais
  zerado), `finish_reason: 'length'` indica truncamento, e a rota não suporta
  saída estruturada, conteúdo multimodal nem RAG no modo `assistant:<uuid>`.
- 0086696: `createSsoSession`: sessão SSO gerenciada no browser. Encapsula o miolo do
  handoff que cada app reimplementava à mão — storage do token, `Authorization`
  automático em `session.fetch`, renovação em 401 e renovação proativa por
  `exp` — com as proteções anti-loop de redirect aprendidas em produção: guarda
  de retry por cooldown (nenhuma resposta 200 consegue rearmá-la), 401 amarrado
  ao token da request (ignora 401 atrasado de token antigo) e single-flight de
  redirect. Inclui `readJwtExpMs` e os tipos `SsoSession`/`SsoSessionOptions`.
  O template Next.js e o guia de apps integrados passam a usar o helper.

## 0.3.2

### Patch Changes

- 65e6e14: Corrige o contrato de `telemetry.pageViews`/`startSessionTracking` com o
  endpoint real `/v1/telemetry/page-view`: envelope `{ events: [...] }` com
  `route` e `viewedAt` (antes enviava `{ sessionId, views }` com `path`, que
  respondia 400). Validado contra o ambiente real.

## 0.3.1

### Patch Changes

- ab2410b: Corrige "TypeError: Illegal invocation" no browser: o fetch do window exige
  `this` correto e o transporte o invocava como método da classe. Agora o fetch
  é vinculado a `globalThis` no HttpTransport e no upload de repositórios —
  tracker de governança e demais chamadas voltam a funcionar em apps browser.

## 0.3.0

### Minor Changes

- ad4a016: Configuração via ambiente para private label e server-to-server: `baseUrl`
  resolve valor explícito → env `ADAFLOW_BASE_URL` → default de produção
  (clientes com API customizada só setam a env), e o app token pode vir de
  `ADAFLOW_APP_TOKEN` (alias `ADA_TOKEN`) — `new AdaflowClient()` sem argumentos
  passa a funcionar em integrações sem usuário logado. `resolveBaseUrl` exportado.

## 0.2.0

### Minor Changes

- c40a723: Nova superfície de Governança / Trilha de Auditoria: `client.governance` com
  `track()` (envio imediato) e `tracker()` (AdaflowTracker buffered — flush por
  lote/intervalo, retry com backoff e Retry-After, dedupe por eventId, flush
  final com fetch keepalive e auto-desativação em ambiente sem o endpoint),
  leituras `listLogs`/`stats`/`userTimeline`/`governanceOverview`/`exportLogs`
  (exigem `platform.audit.read`; novo `err.isPermissionError`),
  `client.telemetry` (heartbeat/page-views/session-end) e `startSessionTracking`
  (sessão automática no browser: heartbeat 60s com visibilitychange, session-end
  no pagehide, page-views de SPA). Eventos usam o namespace `app.<dominio>.<verbo>`
  e aparecem no módulo Governança identificados por app.
