---
'@adaflow/sdk': minor
---

`createSsoSession` renova o JWT sem redirect. Com a opção nova `authUrl`
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
