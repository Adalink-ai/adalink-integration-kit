---
description: Verifica a conexão do plugin com o Adaflow — credencial, gateway, especialistas, agentes e saldo
---

Diagnostique a conexão deste plugin com o Adaflow usando as tools do servidor
MCP `adaflow`. Faça as chamadas abaixo (independentes — em paralelo) e não pare
na primeira falha:

1. `list_models` — valida credencial e gateway.
2. `list_specialists` (limit 5) — confirma acesso aos especialistas.
3. `list_agents` (limit 5) — confirma acesso aos agentes autônomos.
4. `billing` (limit 1) — saldo da wallet.

Responda com uma tabela curta (verificação → ok/falha → detalhe) e, para cada
falha, a correção provável:

- Tools `adaflow` ausentes → o servidor MCP não subiu: confira `/mcp` e se o
  Node 18.17+ e o `npx` estão no PATH.
- 401 / "Informe uma credencial" → configurar o app token do plugin (`/plugin`
  → adaflow → configurar) ou exportar `ADAFLOW_APP_TOKEN` / `ADAFLOW_JWT`.
- 403 → a credencial não tem a permissão da operação (ex.: governança exige
  `platform.audit.read`).
- `insufficient_quota` → organização sem créditos.

Nunca mostre o valor de tokens na resposta.
