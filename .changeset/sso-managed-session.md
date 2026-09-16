---
'@adaflow/sdk': minor
---

`createSsoSession`: sessão SSO gerenciada no browser. Encapsula o miolo do
handoff que cada app reimplementava à mão — storage do token, `Authorization`
automático em `session.fetch`, renovação em 401 e renovação proativa por
`exp` — com as proteções anti-loop de redirect aprendidas em produção: guarda
de retry por cooldown (nenhuma resposta 200 consegue rearmá-la), 401 amarrado
ao token da request (ignora 401 atrasado de token antigo) e single-flight de
redirect. Inclui `readJwtExpMs` e os tipos `SsoSession`/`SsoSessionOptions`.
O template Next.js e o guia de apps integrados passam a usar o helper.
