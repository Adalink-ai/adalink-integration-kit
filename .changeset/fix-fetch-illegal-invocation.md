---
'@adaflow/sdk': patch
---

Corrige "TypeError: Illegal invocation" no browser: o fetch do window exige
`this` correto e o transporte o invocava como método da classe. Agora o fetch
é vinculado a `globalThis` no HttpTransport e no upload de repositórios —
tracker de governança e demais chamadas voltam a funcionar em apps browser.
