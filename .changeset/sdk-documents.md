---
'@adaflow/sdk': minor
---

Recurso `documents` (`/v1/documents`), com o domínio inteiro:

- `upload` (presign → PUT com o `Content-Type` assinado, sem Bearer → confirm),
  além de `presign`/`confirm` separados e `importFromProvider`.
- `list` (por espaço, com status, thumbnails e `limit`/`offset`), `get`,
  `delete` (204), `reprocess`, `reindex`, `mediaContent`, `thumbnail` (`null`
  em 204) e `pages`.
- `waitUntilProcessed` e `isDocumentSettled`: a plataforma não tem stream de
  progresso de documento, então o helper consulta até extração e indexação
  terminarem.
- O contêiner se chama Espaço (`spaceId`); o SDK traduz para o `projectId` da
  plataforma nos dois sentidos.
