# @adaflow/sdk

SDK Node/TypeScript oficial para integração com a plataforma Adaflow.
Client tipado sobre o API Gateway: chat OpenAI-compatible (genérico e
especialista), agentes autônomos, repositórios de conhecimento, SSO handoff e
billing. Zero dependências de runtime — usa `fetch` nativo (Node ≥ 18.17 ou
browser).

> Contexto completo das superfícies: [guia de apps integrados](../../docs/INTEGRATED-APPS-GUIDE.md)
> e [contrato OpenAI-compatible](../../docs/OPENAI-COMPAT.md).

## Instalação

```bash
pnpm add @adaflow/sdk
```

## Credenciais

Regra da plataforma: **JWT do usuário logado sempre que há usuário no fluxo**
(a ação fica auditada no usuário real); app token (`x-ada-token`) só para
server-to-server.

```ts
import { AdaflowClient } from '@adaflow/sdk';

// Usuário logado (preferido) — JWT obtido via SSO handoff.
// Aceita função (sincrona/assíncrona) para renovação a cada request.
const client = new AdaflowClient({
  jwt: () => sessionStorage.getItem('adaflow:jwt')!,
});

// Server-to-server — app token, NUNCA exposto no browser.
const s2s = new AdaflowClient({ appToken: process.env.ADAFLOW_APP_TOKEN! });
```

`baseUrl` resolve nesta ordem: valor explícito → env **`ADAFLOW_BASE_URL`** →
default de produção (`https://adalink-api-gateway.onrender.com`). Clientes
private label com API própria só setam a env — zero mudança de código. O app
token também pode vir do ambiente (**`ADAFLOW_APP_TOKEN`**, alias `ADA_TOKEN`),
permitindo `new AdaflowClient()` sem argumentos em integrações server-to-server:

```ts
// ADAFLOW_BASE_URL=https://api.cliente.com  ADAFLOW_APP_TOKEN=ada_...
const client = new AdaflowClient(); // pronto — private label, sem usuário logado
```

## SSO handoff (browser)

O Adaflow é o Identity Provider. O app redireciona para o handoff e recebe o
JWT no fragment `#sso_token=` (não vai ao servidor nem vaza por Referer):

```ts
import { buildHandoffUrl, consumeSsoToken } from '@adaflow/sdk';

// 1. Redireciona para o Adaflow
location.href = buildHandoffUrl('https://app.adalink.ai', 'https://meuapp.com/sso/callback');

// 2. Na página de callback: extrai o token e limpa a URL
const jwt = consumeSsoToken();
if (jwt) sessionStorage.setItem('adaflow:jwt', jwt);
```

Quando o JWT expira, `AdaflowApiError.isAuthError` fica `true` — refaça o
handoff (com sessão ativa no Adaflow o redirect volta imediatamente).

## Chat (genérico e especialista)

```ts
// Genérico: <gatewayId> do catálogo
const { content } = await client.chat.create({
  model: 'anthropic/claude-haiku-4.5',
  messages: [{ role: 'user', content: 'Classifique: "adorei o produto"' }],
});

// Especialista: assistant:<uuid> — RAG, skills, conectores e governança valem
const result = await client.chat.create({
  model: 'assistant:0198c9a1-...',
  messages: [{ role: 'user', content: 'Resuma o contrato X.' }],
});

// Histórico server-side: persista o chatId e envie só a mensagem nova
const followUp = await client.chat.create({
  model: 'assistant:0198c9a1-...',
  chatId: result.chatId,
  messages: [{ role: 'user', content: 'E os riscos?' }],
});

// Streaming
const stream = await client.chat.stream({ model: 'anthropic/claude-haiku-4.5', messages });
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta.content ?? '');
}

// Catálogo de modelos
const models = await client.chat.models();
```

## Agentes autônomos

```ts
const { data } = await client.agents.list({ search: 'relatório' });

// Síncrono
const exec = await client.agents.execute(agentId, {
  input: 'Gere o relatório semanal',
  threadId: 'meu-app:user-42', // reenvie para manter contexto
});

// Streaming SSE
for await (const event of client.agents.stream(agentId, { input: '...' })) {
  console.log(event);
}
```

## Repositórios de conhecimento

```ts
const repo = await client.repositories.create({ name: 'Contratos 2026' });

// Upload orquestrado: presign → PUT no storage → confirm (os 3 passos em um)
const { fileId } = await client.repositories.uploadDocument(repo.id, {
  fileName: 'contrato.pdf',
  contentType: 'application/pdf',
  data: await readFile('./contrato.pdf'),
});

// Vincula ao especialista — arquivos passam a compor o RAG
await client.specialists.linkRepository(specialistId, repo.id);
```

O processamento (OCR/embedding) é assíncrono após o `confirm`; acompanhe via
`client.repositories.listFiles(repo.id)`.

## Governança / Trilha de Auditoria

Registre os passos do usuário logado — eles aparecem no módulo Governança do
Adaflow identificados como `App: <nome>`:

```ts
// Browser: tracker buffered (fail-soft, flush automático + keepalive no unload)
const tracker = client.governance.tracker({ app: 'meu-app' });
tracker.track({
  action: 'app.contrato.aprovado',   // namespace obrigatório: app.<dominio>.<verbo>
  resource: 'Contrato',
  actionLabel: 'Contrato aprovado',  // label pt-BR exibido na Governança
});

// Server-side / evento crítico: imediato e awaitável (idempotente por eventId)
await client.governance.track(
  { action: 'app.proposta.enviada', resource: 'Proposta', eventId: proposta.id },
  { app: 'meu-app' },
);

// Sessão automática (browser): heartbeat 60s + session-end no fechamento
import { startSessionTracking } from '@adaflow/sdk';
const handle = startSessionTracking(client);
handle.pageView('/contratos');   // no route-change do SPA
await handle.stop();             // no logout/cleanup

// Leitura (exige permissão platform.audit.read — 403 → err.isPermissionError)
const page = await client.governance.listLogs({ sourceService: 'app:meu-app' });
```

Nunca coloque PII/segredos em `metadata` (cap 4KB). No browser, aponte o
`baseUrl` para um proxy do seu app (ver template NextJS) — sem CORS.

## Tratamento de erros

Toda resposta não-2xx vira `AdaflowApiError`, normalizando os dois envelopes
de erro da plataforma (OpenAI e gateway):

```ts
import { AdaflowApiError } from '@adaflow/sdk';

try {
  await client.chat.create(params);
} catch (err) {
  if (err instanceof AdaflowApiError) {
    if (err.isAuthError) refazerHandoff();          // 401 — JWT expirado
    else if (err.isInsufficientQuota) avisarSaldo(); // condição do tenant, não é bug
    else if (err.isRateLimit) retryComBackoff();     // 429
    else reportar(err.status, err.code, err.message);
  }
}
```

## Desenvolvimento

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest
pnpm build       # tsup — ESM + CJS + d.ts
```
