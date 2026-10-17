---
'@adaflow/sdk': minor
---

Repositórios e especialistas: `repositories.list` (busca e paginação), `repositories.removeFile`, `specialists.unlinkRepository` e os tipos `RepositoryFile`/`RepositoryPage` (`listFiles` deixa de devolver `unknown`; inclui `fileHash` e `fileUpdatedAt` quando a plataforma expõe). Quebra de tipo pequena: quem fazia `as { items: ... }` direto no retorno de `listFiles` passa a precisar de `as unknown as ...` (o retorno real sempre foi um array). Documentação corrigida: as chamadas `assistant:<uuid>` via `/v1/openai` aplicam o RAG do especialista, usando a última mensagem do usuário como consulta.
