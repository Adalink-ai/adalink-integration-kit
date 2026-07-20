# @adaflow/cli

CLI oficial da plataforma Adaflow. Hoje gerencia as **skills de agente**
(Claude Code) do [integration kit](../../README.md) nos projetos integrados;
novos comandos da plataforma chegarão aqui.

## Uso

```bash
npx @adaflow/cli skills add                 # todas as skills → .claude/skills/ do projeto
npx @adaflow/cli skills add adaflow-sso     # só as pedidas
npx @adaflow/cli skills add --global        # → ~/.claude/skills (todos os projetos)
npx @adaflow/cli skills update              # atualiza as gerenciadas pela CLI
npx @adaflow/cli skills list                # instaladas × disponíveis
```

Opções: `-g/--global` (usa `~/.claude/skills`), `-d/--dir <path>` (raiz do
projeto de destino; default é o diretório atual).

## Como funciona

- O conteúdo vem **sempre da `main`** do kit no GitHub (subpasta `skills/`,
  via tiged) — skill editada e pushada já chega no próximo `skills update`,
  sem release de pacote.
- Um manifest (`.claude/skills/.adaflow-skills.json`) rastreia o que a CLI
  instalou (nomes + commit da main + data). É ele que permite:
  - `update` tocar **só** no que a CLI gerencia;
  - `list` avisar quando há atualização no kit desde a última instalação;
  - **nunca sobrescrever** uma skill que o time customizou por conta própria
    (skill local sem entrada no manifest é preservada, com aviso).

## Desenvolvimento

```bash
pnpm typecheck   # tsc --noEmit
pnpm test        # vitest — funções puras (manifest, planos de add/update)
pnpm build       # tsup — ESM com shebang
```
