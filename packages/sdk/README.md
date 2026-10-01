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

### Host que já autentica (`authFetch`)

Quando o app já tem um `fetch` que injeta o Bearer e renova em 401 (ex.: sessão
por cookie servida no mesmo host do Adaflow), passe-o em `authFetch`. O SDK não
envia credencial própria, então não combine com `jwt` nem `appToken`. Uploads
para URLs pré-assinadas seguem no `fetch` comum, para o Bearer não ir ao storage.

```ts
const client = new AdaflowClient({
  authFetch: auth.fetch, // renova e repete em 401 por conta própria
  baseUrl: '',           // mesma origem (browser); também aceita '/api'
  client: 'ada-one',     // header x-ada-client: atribuição de uso no gateway
});
```

### Timeout, cancelamento e retry

```ts
const client = new AdaflowClient({
  jwt,
  timeoutMs: 30_000,              // até a resposta chegar; sem default
  retry: { retries: 2, baseMs: 300 }, // default; `false` desliga
});

// Por chamada: cancela com o signal (ex.: TanStack Query) e sobrepõe o prazo.
await client.agents.list({ limit: 20 }, { signal, timeoutMs: 5_000 });
```

- O prazo vale até os headers chegarem. Em stream, o corpo segue enquanto durar
  e só o `signal` do chamador o interrompe.
- O retry só vale para **GET**, em erro de rede e 502/503/504 (respeita
  `Retry-After`). 401 nunca é repetido: quem renova é a credencial.

## SSO handoff (browser)

O Adaflow é o Identity Provider. O app redireciona para o handoff e recebe o
JWT no fragment `#sso_token=` (não vai ao servidor nem vaza por Referer):

Use a sessão gerenciada — ela guarda o token, anexa o `Authorization`, renova
em 401 e traz as proteções anti-loop de redirect (guarda por cooldown, 401
amarrado ao token da request, single-flight):

```ts
import { createSsoSession } from '@adaflow/sdk';

const session = createSsoSession({
  adaflowUrl: 'https://app.adalink.ai',
  onSessionLost: () => mostrarTelaDeLogin(),
});

session.login();         // botão "Entrar" → redireciona ao handoff
session.completeLogin(); // na página de callback: consome #sso_token e limpa a URL

// Renovação em 401 já embutida; com sessão ativa no Adaflow é transparente
const res = await session.fetch('https://adalink-api-gateway.onrender.com/v1/autonomous-agents');
```

As pontas do fluxo continuam disponíveis soltas (`buildHandoffUrl`,
`consumeSsoToken`) — mas o tratamento manual de 401 é fácil de errar (loop
infinito de redirect); prefira `createSsoSession`.

## Chat (genérico e especialista)

```ts
// Genérico: <gatewayId> do catálogo
const { content } = await client.chat.create({
  model: 'anthropic/claude-haiku-4.5',
  messages: [{ role: 'user', content: 'Classifique: "adorei o produto"' }],
});

// Especialista: assistant:<uuid> — prompt, skills, conectores, tools MCP e
// governança valem (RAG das bases do especialista ainda NÃO vale por API)
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

// Streaming — includeUsage pede o chunk final (choices: []) com o usage do turno
const stream = await client.chat.stream({
  model: 'anthropic/claude-haiku-4.5',
  messages,
  includeUsage: true,
});
for await (const chunk of stream) {
  process.stdout.write(chunk.choices[0]?.delta.content ?? '');
  if (chunk.usage) console.log(chunk.usage.total_tokens);
}

// Catálogo de modelos
const models = await client.chat.models();
```

Limitações da rota (detalhes em [OPENAI-COMPAT.md](../../docs/OPENAI-COMPAT.md#limitações-conhecidas)):

- **Sem saída estruturada** — `response_format` é descartado pelo gateway sem
  erro; não aponte `generateObject`/`streamObject` do AI SDK para o Adaflow.
  Se precisar de JSON, peça no prompt e valide `content` com o seu schema.
- **Sem PDF/imagem** — `content` é só texto (array de partes → `400`).
- **`finish_reason: 'length'`** = resposta truncada por `maxTokens`.
- **`usage`** vem real ou omitido, nunca zerado.

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

// Vincula ao especialista — arquivos passam a compor o RAG no chat do Adaflow
await client.specialists.linkRepository(specialistId, repo.id);
```

> O RAG dessas bases vale nas conversas pelo chat do Adaflow; as chamadas
> `assistant:<uuid>` feitas pelo app ainda não o aplicam.

O processamento (OCR/embedding) é assíncrono após o `confirm`; acompanhe via
`client.repositories.listFiles(repo.id)`.

## Documentos

Upload, consulta e processamento de documentos de um **Espaço** (`spaceId`). O
espaço é o contêiner onde o trabalho acontece; a plataforma ainda o chama de
projeto, e o SDK traduz o nome nos dois sentidos.

```ts
// Upload completo: presign → PUT direto no storage → confirm.
const doc = await client.documents.upload({
  spaceId,
  fileName: 'contrato.pdf',
  contentType: 'application/pdf',
  data: arquivo, // Blob, ArrayBuffer ou Uint8Array; até 500 MB
});

// Extração e indexação são assíncronas e não têm stream: o helper consulta.
const pronto = await client.documents.waitUntilProcessed(doc.id);
if (pronto.extractionStatus === 'FAILED') console.warn(pronto.errorCode, pronto.errorMessage);

const docs = await client.documents.list({ spaceId, status: 'COMPLETED', limit: 50 });
const thumb = await client.documents.thumbnail(doc.id); // null enquanto não há frame
const media = await client.documents.mediaContent(doc.id); // transcrição e frames (áudio e vídeo)
await client.documents.delete(doc.id); // definitivo
```

- O PUT envia o `Content-Type` que a plataforma assinou (não o informado);
  divergir dá 403 no storage. O `upload` já cuida disso, e o PUT usa o `fetch`
  comum, sem o Bearer.
- `skipIndexing: true` guarda o arquivo só como anexo.
- Também: `presign`/`confirm` separados, `importFromProvider` (Drive, OneDrive),
  `reprocess`, `reindex` e `pages` (imagens das páginas).
- Permissões: leitura `knowledge.documents.read.*`, upload
  `knowledge.documents.upload` (flag `knowledge.creation`), exclusão
  `knowledge.documents.delete.*`. Upload num espaço pede papel EDITOR ou acima.

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

### Lado servidor: verificar o SSO e registrar o acesso

O admin do Adaflow precisa saber **quem acessou o app** e **que trilha a pessoa
fez**. O SSO já registra o login do lado do Adaflow; o app registra o acesso a
ele mesmo e os momentos de negócio, sempre assinados com o JWT da pessoa (a
plataforma tira o autor da credencial, nunca do payload).

```ts
import { createJwtVerifier, recordAppAccess, AdaflowTokenError } from '@adaflow/sdk';

// Um por processo: guarda o JWKS em cache e só busca de novo em rotação de chave.
const verifier = createJwtVerifier({
  jwksUrl: process.env.ADAFLOW_JWKS_URL!,
  issuer: process.env.ADAFLOW_JWT_ISSUER, // opcional
});

// No callback do SSO (servidor), com o token recebido do handoff:
try {
  const identity = await verifier.verify(token); // EdDSA fixo; exp/nbf/iss/aud
  const user = await findLocalUser(identity.email);
  await recordAppAccess(
    { token, identity, app: 'meu-app', outcome: user ? 'granted' : 'denied', reason: user ? undefined : 'sem_cadastro' },
    { baseUrl: process.env.ADAFLOW_GATEWAY_URL },
  ); // nunca lança: falha na trilha não impede o login
} catch (err) {
  if (err instanceof AdaflowTokenError) return deny(err.code); // expired, invalid_signature...
  throw err;
}
```

A identidade prova quem é a pessoa; a permissão continua local no app. O acesso
entra na Governança como `app.acesso.login` (ou `app.acesso.negado`), categoria
`acesso`, idempotente por sessão do Adaflow: reenviar o mesmo callback não
duplica o registro.

### Catálogo de eventos

Declare os momentos de negócio num lugar só. A validação roda na definição (um
evento fora do contrato quebra no boot, não como 400 em produção), e o
`eventId` é um UUID v5 determinístico: cron que repete ou webhook duplicado
viram `duplicated`, não uma segunda linha.

```ts
import { defineAuditEvents } from '@adaflow/sdk';

export const events = defineAuditEvents('meu-app', {
  quoteApproved: { action: 'app.cotacao.aprovada', label: 'Cotação aprovada', resource: 'Cotacao' },
  quoteDeleted: { action: 'app.cotacao.removida', label: 'Cotação removida', resource: 'Cotacao', severity: 'warning' },
});

await client.governance.track(
  await events.build('quoteApproved', { subjectId: quote.id }),
  { app: 'meu-app' },
);
// Repetição legítima do mesmo momento: passe `occurrence` para não deduplicar.
await events.build('quoteDeleted', { subjectId: quote.id, occurrence: String(version) });
```

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
