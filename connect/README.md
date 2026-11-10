# Adaflow Connect

Integração da Adaflow com plataformas de criação de apps por IA. Um núcleo
comum e uma camada fina por plataforma.

| Pasta | O que é |
|---|---|
| [`openapi/adaflow.yaml`](./openapi/adaflow.yaml) | Spec OpenAPI 3.1 pública e curada: só as rotas que um app integrado usa com token de app. Sem rotas administrativas ou internas |
| [`base44/`](./base44/README.md) | Guia da Base44 e a Backend Function [`adaflow`](./base44/functions/adaflow/entry.ts) (proxy com streaming) |
| [`mcp/`](./mcp/README.md) | Deploy na Vercel do MCP remoto, aberto a todas as organizações, com token de app ou JWT do usuário |
| [`prompts/`](./prompts) | Prompts de instalação para colar no builder de cada plataforma |
| `test/` | Testes da spec e da função (`pnpm --filter @adaflow/connect test`) |

Próxima fase: v0 (registry shadcn com botão *Open in v0*).

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
