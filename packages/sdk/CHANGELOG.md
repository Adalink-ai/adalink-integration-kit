# @adaflow/sdk

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
