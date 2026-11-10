# MCP remoto do Adaflow Connect

Servidor MCP da Adaflow por URL, para os builders de IA (v0, Base44 e qualquer
cliente MCP com transporte HTTP) conhecerem a organização enquanto geram o
app: especialistas, agentes, modelos, repositórios de conhecimento e
governança.

Aberto a todas as organizações. Cada requisição traz a própria credencial, e
nada fica guardado entre requisições. O código está em
[`@adaflow/mcp/remote`](../../packages/mcp/README.md#servidor-remoto-http);
esta pasta só faz o deploy na Vercel.

## Credencial

| Como enviar | O que é | Quando usar |
|---|---|---|
| `Authorization: Bearer <jwt>` | JWT do usuário logado | Sempre que houver usuário: as ações ficam auditadas nele |
| `x-ada-token: ada_...` | Token de app | Cliente que aceita header customizado |
| `Authorization: Bearer ada_...` | Token de app | Cliente que só oferece o campo de Bearer token |

O servidor reconhece o token de app pelo prefixo `ada_`. Sem credencial, a
resposta é 401. `x-ada-token` junto com um JWT diferente responde 400.

O token de app age como o usuário que o criou. Use um usuário de serviço com
permissões mínimas, como no [guia da Base44](../base44/README.md).

## Tools

As mesmas do servidor local, menos `upload_document`, que leria arquivos da
máquina do servidor: `list_models`, `list_specialists`, `get_specialist`,
`chat`, `list_agents`, `execute_agent`, `create_repository`,
`list_repository_files`, `list_audit_logs`, `governance_overview` e `billing`.

Criar repositório e ler governança exigem JWT de usuário com a permissão
certa; com token de app, essas tools respondem 401 ou 403 explicando o motivo.

## Deploy na Vercel

1. Crie um projeto na Vercel a partir deste repositório, com **Root Directory**
   `connect/mcp`. A Vercel detecta o workspace pnpm e instala pela raiz.
2. O `vercel.json` já define o build (`@adaflow/sdk` e `@adaflow/mcp`), a rota
   `/mcp` e 300 s de duração máxima, porque `execute_agent` pode levar minutos.
3. Variável de ambiente opcional: `ADAFLOW_BASE_URL`, para um gateway que não
   seja o de produção. O gateway nunca vem da requisição.
4. Depois do deploy, teste:

```bash
curl -sS -X POST https://<seu-projeto>.vercel.app/mcp \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -H "x-ada-token: $ADAFLOW_APP_TOKEN" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
```

## Conectar nos builders

| Builder | Onde | Credencial |
|---|---|---|
| v0 | MCP Connections, com a URL `https://<seu-projeto>.vercel.app/mcp` | Bearer token (`ada_...`) ou header `x-ada-token` |
| Base44 | MCP connections da conta, com a mesma URL | Header `x-ada-token` ou Bearer token |
| Claude Code | `claude mcp add --transport http adaflow https://<seu-projeto>.vercel.app/mcp --header "x-ada-token: $ADAFLOW_APP_TOKEN"` | Header |

O MCP só atua enquanto o builder gera código. O app gerado continua chamando a
API da Adaflow pelo próprio backend (Backend Function na Base44, route handler
no v0), com o token nos secrets da plataforma.

## Limites

- **Sem sessão:** não há stream `GET` de notificações nem `DELETE` de sessão;
  os dois respondem 405.
- **Respostas inteiras:** o servidor responde em JSON, sem streaming. Uma
  execução longa de agente aparece de uma vez, no fim.
- **Sem OAuth:** a credencial vai no header. Clientes que só fazem OAuth ainda
  não conseguem conectar.
