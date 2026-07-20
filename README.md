# Adalink Integration Kit

Kit oficial para integrar apps parceiros e de clientes ao Adaflow, a
plataforma de IA da Adalink: documentação, skills de agente (Claude Code),
SDK TypeScript (`@adaflow/sdk`), CLI de scaffold (`create-adaflow-app`) e, em
breve, template NextJS.

## O que tem aqui

| Pasta | Conteúdo |
|---|---|
| [`docs/`](./docs) | [Guia de uso para apps integrados](./docs/INTEGRATED-APPS-GUIDE.md) (SSO, agentes, chat OpenAI-compatible, repositórios de conhecimento) e o [contrato da API OpenAI-compatible](./docs/OPENAI-COMPAT.md) |
| [`skills/`](./skills) | Skills de Claude Code prontas para copiar para o repositório do seu app |
| [`packages/sdk`](./packages/sdk) | [`@adaflow/sdk`](./packages/sdk/README.md) — SDK TypeScript com client tipado (SSO, chat, especialistas, agentes, repositórios, billing) |
| [`packages/create-adaflow-app`](./packages/create-adaflow-app) | [`create-adaflow-app`](./packages/create-adaflow-app/README.md) — CLI que cria um app integrado a partir dos templates |
| [`packages/cli`](./packages/cli) | [`@adaflow/cli`](./packages/cli/README.md) — binário `adaflow`; instala e atualiza as skills nos projetos (`adaflow skills add\|update\|list`) |
| `templates/` | Templates de app integrado, consumidos via [`tiged`](#templates) (NextJS em breve) |

## Skills

Cada skill instrui um agente (Claude Code) a implementar uma superfície de
integração no seu app, com passos, snippets e checklist de validação:

| Skill | Integra |
|---|---|
| [`adaflow-sso`](./skills/adaflow-sso/SKILL.md) | Autenticação via SSO handoff do Adaflow (JWT via fragment) |
| [`adaflow-assistants`](./skills/adaflow-assistants/SKILL.md) | Chat com especialistas (`assistant:<uuid>`) — RAG, memória, governança |
| [`adaflow-autonomous-agent`](./skills/adaflow-autonomous-agent/SKILL.md) | Execução de agentes autônomos por id (síncrono + SSE) |
| [`adaflow-generic-chat`](./skills/adaflow-generic-chat/SKILL.md) | Chamada genérica de LLM via API OpenAI-compatible |
| [`adaflow-knowledge-repository`](./skills/adaflow-knowledge-repository/SKILL.md) | Criar repositórios de conhecimento e subir documentos (RAG) |

### Instalação das skills no seu projeto

```bash
# na raiz do repositório do seu app
npx @adaflow/cli skills add

# atualizar depois (o conteúdo vem sempre da main deste repositório):
npx @adaflow/cli skills update
```

A CLI copia as skills para `.claude/skills/` do projeto (ou `~/.claude/skills`
com `--global`) e mantém um manifest para atualizá-las sem sobrescrever
customizações locais — detalhes no [README da CLI](./packages/cli/README.md).
Depois disso, basta pedir ao Claude Code — ex.: "implemente o login via
Adaflow" — e a skill correspondente é usada automaticamente.

> O script `scripts/install-skills.sh` (curl | bash) continua funcionando,
> mas está **deprecated** em favor da CLI.

## Templates

Os templates vivem em `templates/` dentro deste monorepo. O jeito recomendado
de consumir é a CLI [`create-adaflow-app`](./packages/create-adaflow-app/README.md),
que baixa o template, aplica o nome do projeto, ajusta a dependência do
`@adaflow/sdk` e roda `git init`:

```bash
pnpm create adaflow-app meu-app
cd meu-app && pnpm install
```

Alternativa manual com [`tiged`](https://github.com/tiged/tiged) (sucessor do
degit), que baixa só a subpasta, sem histórico git — mesmo padrão do
`create-next-app --example` e do Turborepo:

```bash
npx tiged Adalink-ai/adalink-integration-kit/templates/nextjs meu-app
cd meu-app && git init && pnpm install
```

> O template NextJS ainda está no [roadmap](#roadmap) — os comandos acima
> passam a funcionar assim que `templates/nextjs` for publicado.

## Começando do zero

1. Leia o [guia de apps integrados](./docs/INTEGRATED-APPS-GUIDE.md) — visão
   geral das superfícies e a regra de credenciais (JWT do usuário logado
   preferido; app token só server-to-server).
2. Instale as skills no seu repositório (acima).
3. Implemente na ordem: SSO → superfície de consumo (assistants, agente
   autônomo ou chat genérico) → repositórios de conhecimento, se o caso.

## Roadmap

- [x] `packages/sdk` — SDK TypeScript com client tipado (auth, agents, chat, repositories)
- [x] `packages/create-adaflow-app` — CLI de scaffold a partir dos templates
- [ ] `templates/nextjs` — app NextJS de referência com SSO handoff e chat de especialista prontos
- [x] Publicar `@adaflow/sdk` e `create-adaflow-app` no registry npm (0.1.0, 2026-07-20)
- [x] `packages/cli` — `@adaflow/cli` (binário `adaflow`) com `skills add|update|list`

## Desenvolvimento

Monorepo pnpm workspaces (`packages/*`, `templates/*`). Requer Node 22+ e pnpm 10+.

```bash
pnpm install
pnpm -r typecheck && pnpm -r test && pnpm -r build
```

### Release (Changesets)

Publicação no npm é automatizada via [Changesets](https://github.com/changesets/changesets)
(`.github/workflows/release.yml`):

1. No PR que altera um pacote publicável, rode `pnpm changeset` — escolha o(s)
   pacote(s), o bump (patch/minor/major) e escreva o resumo do changelog. O
   arquivo gerado em `.changeset/` vai junto no PR.
2. Ao entrar na `main`, a action abre/atualiza o PR **"Version Packages"**
   acumulando os bumps pendentes e os CHANGELOGs.
3. **Merge do PR de versão = publish automático** no npm dos pacotes alterados.

PR sem changeset não gera release — mudanças em docs, skills e templates não
precisam de changeset. A CI de PRs (`ci.yml`) roda typecheck + test + build.
