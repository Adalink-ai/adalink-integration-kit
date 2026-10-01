# @adaflow/mcp

Servidor [MCP](https://modelcontextprotocol.io) oficial da plataforma Adaflow.
Dá ao Claude (e a qualquer cliente MCP) acesso direto à sua organização no
Adaflow: especialistas, agentes autônomos, chat OpenAI-compatible,
repositórios de conhecimento, governança e billing. É construído sobre o
[`@adaflow/sdk`](../sdk/README.md).

## Uso com o plugin do Claude Code (recomendado)

O plugin `adaflow` deste repositório já declara o servidor, junto com as skills
de integração:

```bash
/plugin marketplace add Adalink-ai/adalink-integration-kit
/plugin install adaflow@adalink
```

Na instalação, o Claude Code pede o **app token** (guardado no cofre de
credenciais do sistema, não no `settings.json`) e, opcionalmente, a base URL
do gateway. Depois disso, rode `/adaflow:doctor` para validar a conexão.

## Uso standalone

```bash
ADAFLOW_APP_TOKEN=... npx -y @adaflow/mcp
```

Exemplo de `.mcp.json`:

```json
{
  "mcpServers": {
    "adaflow": {
      "command": "npx",
      "args": ["-y", "@adaflow/mcp"],
      "env": { "ADAFLOW_APP_TOKEN": "${ADAFLOW_APP_TOKEN}" }
    }
  }
}
```

## Credenciais

| Variável | Uso |
|---|---|
| `ADAFLOW_JWT` | JWT do usuário logado (SSO handoff). **Preferido**: as ações ficam auditadas no usuário real. Tem precedência sobre o app token |
| `ADAFLOW_APP_TOKEN` (alias `ADA_TOKEN`) | App token server-to-server, enviado como `x-ada-token` |
| `ADAFLOW_BASE_URL` | Gateway customizado (private label). Vazio = produção |
| `ADAFLOW_CLIENT` | Identificador do produto chamador (header `x-ada-client`) |

O servidor sobe mesmo sem credencial. Nesse caso, cada tool responde com um
erro explicando o que configurar.

> Rotas de escrita em repositórios exigem JWT de usuário ADMIN/CREATOR. A
> leitura de governança exige `platform.audit.read`. Com app token, essas tools
> respondem 401/403, e o erro diz isso.

## Tools

| Tool | Tipo | O que faz |
|---|---|---|
| `list_models` | leitura | Catálogo curado de modelos |
| `list_specialists` / `get_specialist` | leitura | Especialistas e repositórios vinculados |
| `chat` | escrita | Mensagem para `assistant:<uuid>` ou modelo do catálogo, com `chatId` para continuar |
| `list_agents` / `execute_agent` | leitura / escrita | Agentes autônomos (execução síncrona, `threadId` para contexto) |
| `create_repository` | escrita | Novo repositório de conhecimento |
| `upload_document` | escrita | Envia arquivo local (presign → PUT → confirm) |
| `list_repository_files` | leitura | Arquivos e status de processamento |
| `list_audit_logs` / `governance_overview` | leitura | Trilha de auditoria e dashboard executivo |
| `billing` | leitura | Saldo da wallet e consumo |

As tools de leitura levam `readOnlyHint`, então clientes que respeitam
anotações podem liberá-las sem confirmação.

> ⚠️ RAG das bases vinculadas ao especialista não se aplica por API (vale para
> a tool `chat` também). Ver o [guia de apps integrados](../../docs/INTEGRATED-APPS-GUIDE.md).

## Desenvolvimento

```bash
pnpm --filter @adaflow/mcp test       # usa o SDK direto do código-fonte
pnpm --filter @adaflow/mcp build
npx @modelcontextprotocol/inspector node packages/mcp/dist/index.js
```
