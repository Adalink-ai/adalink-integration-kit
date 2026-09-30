---
'@adaflow/sdk': minor
---

Trilha e acesso do lado servidor, para o admin do Adaflow saber quem acessou o
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
