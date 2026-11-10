# Adaflow Connect

Integração da Adaflow com plataformas de criação de apps por IA. Um núcleo
comum e uma camada fina por plataforma.

| Pasta | O que é |
|---|---|
| [`openapi/adaflow.yaml`](./openapi/adaflow.yaml) | Spec OpenAPI 3.1 pública e curada: só as rotas que um app integrado usa com token de app. Sem rotas administrativas ou internas |
| [`base44/`](./base44/README.md) | Guia da Base44 e a Backend Function [`adaflow`](./base44/functions/adaflow/entry.ts) (proxy com streaming) |
| [`mcp/`](./mcp/README.md) | MCP remoto em `https://adaflow-mcp.adalink.app/mcp`, aberto a todas as organizações, com token de app ou JWT do usuário |
| [`v0/`](./v0/README.md) | Registry shadcn com os blocos `adaflow-chat` e `adaflow-agent-runner`, e a vitrine com o botão Abrir no v0 |
| [`prompts/`](./prompts) | Prompts de instalação para colar no builder de cada plataforma |
| `test/` | Testes da spec e da função da Base44 (`pnpm --filter @adaflow/connect test`) |

## Regras do núcleo

- **Token só no servidor.** Nenhum caminho documentado põe o token da Adaflow
  no navegador.
- **Spec curada, não gerada.** A spec lista as rotas à mão. O teste
  `openapi-spec.test.ts` falha se uma rota entrar ou sair sem que a lista
  esperada mude junto, e se aparecer `admin` ou `internal` em algum caminho.
- **Mesmas rotas em todo lugar.** A spec, o `@adaflow/sdk` e a função da Base44
  cobrem o mesmo conjunto. Ao mudar um, mude os outros.

## Validar a spec

```bash
npx @redocly/cli lint connect/openapi/adaflow.yaml
```
