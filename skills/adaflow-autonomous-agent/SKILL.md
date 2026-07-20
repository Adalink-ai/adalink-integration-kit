---
name: adaflow-autonomous-agent
description: Integra este app à execução de agentes autônomos da plataforma Adalink (POST /v1/autonomous-agents/:id/execute e stream SSE) com JWT do usuário. Use quando o pedido for executar/disparar um agente autônomo por id.
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Integração com Adaflow Autonomous Agent

Executa um **agente autônomo** da organização a partir deste app, passando o
`agentId`. Fonte de verdade: o
[guia de apps integrados](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/docs/INTEGRATED-APPS-GUIDE.md)
— seção 2.

> Para conversar com um **especialista** (RAG/memória/conectores), NÃO é esta
> API — use a skill `adaflow-assistants` (`assistant:<uuid>` no `/v1/openai`).

## Passos de implementação

1. **Descobrir o agente**: `GET /v1/autonomous-agents` (paginado) com
   `Authorization: Bearer <JWT>`; guardar o `id` (UUID).

2. **Execução síncrona**:

   ```bash
   curl -X POST "https://adalink-api-gateway.onrender.com/v1/autonomous-agents/<agentId>/execute" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"input": "...", "threadId": "<opcional>"}'
   ```

   Body: `input` (obrigatório, máx. 50.000 chars), `threadId` (opcional —
   reenviar o mesmo valor mantém contexto entre execuções). Resposta:
   `{ id, agentId, input, output, threadId?, status, error? }` com
   `status ∈ pending|running|completed|failed|cancelled`.

3. **Execução streaming (SSE)**:
   `GET /v1/autonomous-agents/:id/stream?input=...&threadId=...` —
   `EventSource` não envia headers, então use `fetch` com
   `Accept: text/event-stream` e leia o body como stream; cada linha
   `data: <chunk JSON>`. Snippet completo na seção 2 do guia.

## Regras

- Credencial: JWT do usuário logado (via handoff — skill `adaflow-sso`).
  A ação fica auditada no usuário real; requer permissão
  `autonomous-agents.execute` (scope `write`).
- `organizationId`/`userId` vêm SEMPRE do token — nunca aceitar no body.
- `:id` é UUID — validar client-side antes de chamar (o gateway rejeita
  não-UUID com 400).

## Erros

| Status | Causa | Tratamento no app |
|---|---|---|
| 401 | JWT expirado | Refazer handoff (skill `adaflow-sso`) |
| 403 | Sem permissão / feature flag off | Aviso informativo, não erro de sistema |
| 404 | Agente inexistente ou de outra org | Revalidar o id via listagem |
| 429 | Saldo/rate-limit | Saldo → aviso informativo; rate-limit → backoff |

## Validação

1. Listar agentes, executar um com `input` simples → `status: completed` e
   `output` não vazio.
2. Duas execuções com o mesmo `threadId` — a segunda deve ter contexto da
   primeira.
3. Stream: chunks chegam incrementalmente (não um bloco único no fim).
4. UUID de outra org → 404 (isolamento de tenant OK).
