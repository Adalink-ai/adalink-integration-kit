---
name: adaflow-governance
description: Registra os passos do usuário logado na trilha de auditoria/Governança do Adaflow (eventos de negócio + sessão) e consulta a trilha. Use quando o pedido for auditar ações do app, registrar eventos de governança, tracking de sessão ou dar visibilidade ao cliente no módulo Governança.
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Integração com Governança / Trilha de Auditoria do Adaflow

Registra os "passos do usuário logado" deste app na mesma trilha que o cliente
vê no módulo Governança do Adaflow, identificados como `App: <nome>`. Fonte de
verdade dos contratos: o
[guia de apps integrados](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/docs/INTEGRATED-APPS-GUIDE.md)
— seção "Governança e trilha de auditoria". Em divergência, o guia prevalece.

## Quando usar cada superfície

- **Evento de negócio** (`app.contrato.aprovado`): sempre que o usuário completa
  uma ação relevante no app → `tracker.track()` (browser) ou
  `governance.track()` (server-side, awaitável).
- **Sessão/page-view**: visibilidade de tempo ativo e navegação →
  `startSessionTracking` (browser, automático).
- **Leitura** (`listLogs`/`stats`/`governanceOverview`): telas de admin no seu
  app — exige usuário com permissão `platform.audit.read` (403 = sem acesso).

## Passos de implementação

1. **Proxy no app** (browser nunca fala direto com o gateway): route handler
   `POST /api/adaflow/[...path]` com allowlist estrita (`v1/audit/events`,
   `v1/audit/events/batch`, `v1/telemetry/*`), repassando o `Authorization`.
2. **Tracker buffered no browser** (singleton):

   ```ts
   import { AdaflowClient } from '@adaflow/sdk';
   const client = new AdaflowClient({ jwt: () => getJwt() ?? '', baseUrl: `${origin}/api/adaflow` });
   const tracker = client.governance.tracker({ app: 'meu-app' });
   tracker.track({ action: 'app.contrato.aprovado', resource: 'Contrato', actionLabel: 'Contrato aprovado' });
   ```

   Server-side/crítico: `await client.governance.track(evento, { app: 'meu-app' })`.
3. **Sessão automática**: `const handle = startSessionTracking(client)` num
   provider montado no layout; `handle.pageView(path)` no route-change;
   retorne `handle.stop` no cleanup.
4. **Convenções**: `action` no formato `app.<dominio>.<verbo>` (lowercase,
   namespace obrigatório); `app` = slug estável do seu app; `actionLabel` em
   pt-BR com acentos (é o que o gestor vê); `severity` info|warning|critical.

## Regras

- NUNCA colocar PII, segredos ou tokens em `metadata` (cap de 4KB).
- `eventId` é a chave de idempotência — gere um por evento e reuse no retry.
- `organizationId`/usuário NUNCA vão no payload — vêm da credencial.
- Com app token (`x-ada-token`), o `app` declarado deve bater com o token.
- Tracking é fail-soft: erro de telemetria jamais pode quebrar o app.

## Validação

1. Evento enviado aparece em `GET /v1/audit/logs?sourceService=app:<slug>` e
   no módulo Governança do Adaflow com o label do app.
2. Reenvio com o mesmo `eventId` → `deduplicated`/`duplicated` (sem linha nova).
3. `action` sem prefixo `app.` → 400 com mensagem clara.
4. Fechar a aba não perde o lote pendente (flush via `fetch keepalive`).
5. Usuário sem `platform.audit.read` recebe aviso amigável na leitura (403).
