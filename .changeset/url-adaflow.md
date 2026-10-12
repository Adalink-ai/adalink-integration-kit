---
"@adaflow/sdk": patch
"adaflow-template-nextjs": patch
---

Corrige a URL do Adaflow para `https://adaflow.adalink.ai` no template NextJS (padrão do SSO e `.env.example`) e no exemplo do README do SDK, que traziam `app.adalink.ai`. O README passa a indicar a URL do JWKS (`https://adaflow.adalink.ai/v1/auth/jwks`).
