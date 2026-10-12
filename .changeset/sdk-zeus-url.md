---
'@adaflow/sdk': patch
---

`DEFAULT_BASE_URL` passa a ser `https://zeus.adalink.app`, a mesma API que o frontend do Adaflow usa e o issuer do JWT. `adaflow.adalink.ai` só repassa `/v1/auth/*` ao backend, então não serve como base da API.
