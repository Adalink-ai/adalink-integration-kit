---
'@adaflow/sdk': minor
---

`chat.stream()` aceita `includeUsage: true` (envia `stream_options.include_usage`)
e o `ChatCompletionChunk` passa a tipar o chunk final com `usage` e `choices: []`.
Novo tipo exportado `ChatUsage`. A documentação dos tipos de chat foi corrigida
para o comportamento real da plataforma: `usage` vem real ou omitido (não mais
zerado), `finish_reason: 'length'` indica truncamento, e a rota não suporta
saída estruturada, conteúdo multimodal nem RAG no modo `assistant:<uuid>`.
