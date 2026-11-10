---
"@adaflow/mcp": minor
---

Servidor MCP remoto (Streamable HTTP, sem sessão) em `@adaflow/mcp/remote`, para clientes que só aceitam URL, como o v0 e a Base44. Cada requisição traz a credencial: token de app em `x-ada-token` ou `Authorization: Bearer ada_...`, ou o JWT do usuário em `Authorization: Bearer`. No modo remoto, `upload_document` fica de fora, porque leria arquivos do servidor.
