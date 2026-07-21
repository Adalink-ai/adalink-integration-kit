---
'@adaflow/sdk': minor
---

Configuração via ambiente para private label e server-to-server: `baseUrl`
resolve valor explícito → env `ADAFLOW_BASE_URL` → default de produção
(clientes com API customizada só setam a env), e o app token pode vir de
`ADAFLOW_APP_TOKEN` (alias `ADA_TOKEN`) — `new AdaflowClient()` sem argumentos
passa a funcionar em integrações sem usuário logado. `resolveBaseUrl` exportado.
