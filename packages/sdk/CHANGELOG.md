# @adaflow/sdk

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
