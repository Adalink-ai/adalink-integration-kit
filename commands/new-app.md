---
description: Cria um app integrado ao Adaflow a partir do template NextJS oficial (SSO + chat prontos)
argument-hint: <nome-do-app>
allowed-tools: Bash(pnpm create adaflow-app:*), Bash(npx create-adaflow-app:*), Read, Glob
---

Crie um novo app integrado ao Adaflow chamado `$ARGUMENTS` (se vier vazio,
pergunte o nome antes de continuar; use kebab-case).

1. Rode `pnpm create adaflow-app $ARGUMENTS` no diretório atual (sem pnpm:
   `npx create-adaflow-app $ARGUMENTS`). A CLI baixa `templates/nextjs`, aplica
   o nome, ajusta a dependência do `@adaflow/sdk` e faz `git init`.
2. Leia o `README.md` e o `.env.example` do app gerado e liste para o usuário
   as variáveis que ele precisa preencher (sem inventar valores).
3. Termine com os próximos passos: `cd $ARGUMENTS && pnpm install`, preencher
   o `.env` e, para estender a integração, `/adaflow:integrate <superfície>`.
