---
'@adaflow/sdk': patch
---

Corrige o contrato de `telemetry.pageViews`/`startSessionTracking` com o
endpoint real `/v1/telemetry/page-view`: envelope `{ events: [...] }` com
`route` e `viewedAt` (antes enviava `{ sessionId, views }` com `path`, que
respondia 400). Validado contra o ambiente real.
