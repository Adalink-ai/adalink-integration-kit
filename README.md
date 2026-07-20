# Adalink Integration Kit

Kit oficial para integrar apps parceiros e de clientes à plataforma Adalink /
Adaflow: documentação, skills de agente (Claude Code), SDK TypeScript e, em
breve, template NextJS.

## O que tem aqui

| Pasta | Conteúdo |
|---|---|
| [`docs/`](./docs) | [Guia de uso para apps integrados](./docs/INTEGRATED-APPS-GUIDE.md) (SSO, agentes, chat OpenAI-compatible, repositórios de conhecimento) e o [contrato da API OpenAI-compatible](./docs/OPENAI-COMPAT.md) |
| [`skills/`](./skills) | Skills de Claude Code prontas para copiar para o repositório do seu app |
| [`packages/sdk`](./packages/sdk) | [`@adalink/sdk`](./packages/sdk/README.md) — SDK TypeScript com client tipado (SSO, chat, especialistas, agentes, repositórios, billing) |
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
curl -fsSL https://raw.githubusercontent.com/Adalink-ai/adalink-integration-kit/main/scripts/install-skills.sh | bash
# ou, com o kit clonado:
./scripts/install-skills.sh /caminho/do/seu/app
```

O script copia as skills para `.claude/skills/` do projeto de destino. Depois
disso, basta pedir ao Claude Code — ex.: "implemente o login via Adaflow" — e
a skill correspondente é usada automaticamente.

## Templates

Os templates vivem em `templates/` dentro deste monorepo e são consumidos com
[`tiged`](https://github.com/tiged/tiged) (sucessor do degit), que baixa só a
subpasta, sem histórico git — mesmo padrão do `create-next-app --example` e do
Turborepo:

```bash
npx tiged Adalink-ai/adalink-integration-kit/templates/nextjs meu-app
cd meu-app && git init && pnpm install
```

> O template NextJS ainda está no [roadmap](#roadmap) — o comando acima passa a
> funcionar assim que `templates/nextjs` for publicado.

## Começando do zero

1. Leia o [guia de apps integrados](./docs/INTEGRATED-APPS-GUIDE.md) — visão
   geral das superfícies e a regra de credenciais (JWT do usuário logado
   preferido; app token só server-to-server).
2. Instale as skills no seu repositório (acima).
3. Implemente na ordem: SSO → superfície de consumo (assistants, agente
   autônomo ou chat genérico) → repositórios de conhecimento, se o caso.

## Roadmap

- [x] `packages/sdk` — SDK TypeScript com client tipado (auth, agents, chat, repositories)
- [ ] `templates/nextjs` — app NextJS de referência com SSO handoff e chat de especialista prontos

## Desenvolvimento

Monorepo pnpm workspaces (`packages/*`, `templates/*`). Requer Node 22+ e pnpm 10+.

```bash
pnpm install
```
