# Adaflow Starter (NextJS)

App integrado à plataforma [Adaflow](https://github.com/Adalink-ai/adalink-integration-kit)
gerado com `pnpm create adaflow-app`. Vem pronto com:

- **Next.js** (App Router) + **Tailwind CSS 4** + **shadcn/ui**
- **Prisma** (Postgres) com schema inicial e client singleton
- **@adaflow/sdk** — client tipado da plataforma
- **SSO handoff do Adaflow** (`/` → login → `/auth/callback`)
- **Chat genérico com IA em streaming** (`/chat` + `/api/chat`)

## Começando

```bash
cp .env.example .env       # ajuste DATABASE_URL e, se preciso, o modelo
pnpm install
pnpm dev
```

Abra http://localhost:3000 e clique em **Entrar com Adaflow**. Em produção o
app precisa estar em domínio `adalink.ai`/`adalink.app` (allowlist do SSO);
`http://localhost` é aceito em dev.

## Como funciona

| Peça | Arquivo | O que faz |
|---|---|---|
| Login | `src/app/page.tsx` + `src/lib/auth.ts` | Redireciona para o handoff do Adaflow (`buildHandoffUrl`) |
| Callback | `src/app/auth/callback/page.tsx` | `consumeSsoToken()` extrai o JWT do fragment e limpa a URL |
| Chat (UI) | `src/app/chat/page.tsx` | Streaming, continuação via `x-chat-id`, retry de sessão sem loop |
| Chat (API) | `src/app/api/chat/route.ts` | Proxy server-side com `@adaflow/sdk` (`client.chat.stream`) — sem CORS |
| Banco | `prisma/schema.prisma` + `src/lib/prisma.ts` | Exemplo de persistência local (o chat não depende de banco) |

O modelo default é `anthropic/claude-haiku-4.5` — troque via `ADAFLOW_MODEL`
(`GET /v1/openai/models` lista o catálogo). Para conversar com um
especialista do Adaflow (RAG, skills, governança), use `assistant:<uuid>`
como modelo — detalhes no
[guia de apps integrados](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/docs/INTEGRATED-APPS-GUIDE.md).

## Skills de agente (Claude Code)

```bash
npx @adaflow/cli skills add
```

Instala em `.claude/skills/` as skills que ensinam o Claude Code a evoluir a
integração (assistants, agentes autônomos, repositórios de conhecimento).
