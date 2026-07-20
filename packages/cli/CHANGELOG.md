# @adaflow/cli

## 0.1.0

### Minor Changes

- 0640b75: Primeira versão do `@adaflow/cli` (binário `adaflow`): gerenciador de skills
  de agente (Claude Code) do integration kit. `adaflow skills add [nomes...]`
  instala no projeto (`.claude/skills/`) ou globalmente (`--global`);
  `adaflow skills update` atualiza só as skills gerenciadas pela CLI (manifest
  `.adaflow-skills.json`), preservando customizações locais; `adaflow skills
list` mostra instaladas × disponíveis e avisa quando o kit tem novidades. O
  conteúdo vem sempre da `main` do kit no GitHub — sem release de pacote para
  atualizar skills.
