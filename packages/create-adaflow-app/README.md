# create-adaflow-app

CLI oficial para criar apps integrados à plataforma Adaflow a partir
dos templates do [integration kit](../../README.md).

## Uso

```bash
pnpm create adaflow-app meu-app
# ou: npm create adaflow-app meu-app / npx create-adaflow-app meu-app
```

Sem argumento, o nome do projeto é perguntado interativamente.

```
Uso:
  pnpm create adaflow-app <diretório> [--template nextjs]

Opções:
  -t, --template   Template a usar (default: nextjs)
  -h, --help       Mostra esta ajuda
```

## O que a CLI faz

1. Baixa `templates/<nome>` do monorepo via [tiged](https://github.com/tiged/tiged)
   — só a subpasta, sem histórico git.
2. Aplica o nome do projeto no `package.json` gerado.
3. Troca a dependência `workspace:*` do `@adaflow/sdk` pela versão publicada
   (dentro do monorepo o template usa protocolo de workspace, que não resolve
   fora dele).
4. Roda `git init` no diretório criado (best-effort — avisa se git não estiver
   disponível).

Depois é só `pnpm install && pnpm dev`.

## Alternativa sem a CLI

O mesmo template pode ser consumido direto com tiged:

```bash
npx tiged Adalink-ai/adalink-integration-kit/templates/nextjs meu-app
```

Nesse caso o `package.json` mantém o nome do template e a dependência
`workspace:*` do SDK precisa ser trocada manualmente pela versão publicada.

## Desenvolvimento

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest — funções puras do scaffold
pnpm build       # tsup — ESM com shebang
```
