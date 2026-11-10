---
name: adaflow-base44
description: Integra um app da Base44 à Adaflow (Adaflow Connect) com a Backend Function adaflow, o token de app nos Secrets e chamadas pelo base44.functions.fetch. Use quando o projeto tiver a pasta base44/ (CLI da Base44) ou o pedido for conectar um app Base44 a especialistas, agentes, chat ou governança da Adaflow.
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Adaflow em app da Base44

Conecta um app da Base44 à Adaflow sem o token chegar ao navegador: o
frontend chama a Backend Function `adaflow`, que exige usuário logado, lê o
token nos Secrets e chama a API. Fonte de verdade: o
[guia da Base44](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/connect/base44/README.md).
Em divergência, o guia prevalece.

## Pré-requisitos

- Plano Base44 **Builder ou superior** (Backend Functions).
- Projeto com a pasta `base44/` (CLI `npx base44`). Sem CLI, o caminho é o
  [prompt de instalação](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/connect/prompts/base44.md)
  no chat do editor: não siga esta skill.
- Token de app da Adaflow (`ada_...`), criado por um **usuário de serviço** com
  permissões mínimas. O token age em nome de quem o criou.

## Passos de implementação

1. **Copiar a função** do kit para `base44/functions/adaflow/`, sem alterar:
   - [`function.jsonc`](https://raw.githubusercontent.com/Adalink-ai/adalink-integration-kit/main/connect/base44/functions/adaflow/function.jsonc)
   - [`entry.ts`](https://raw.githubusercontent.com/Adalink-ai/adalink-integration-kit/main/connect/base44/functions/adaflow/entry.ts)

   É um arquivo único de propósito. Mudança de comportamento vai para o kit,
   não para a cópia.

2. **Secrets** (peça o valor do token ao usuário; nunca escreva o token em
   arquivo do repositório):

   ```bash
   npx base44 secrets set ADAFLOW_APP_TOKEN=<token>
   ```

   Opcionais: `ADAFLOW_APP_SLUG` (nome do app na Governança), `ADAFLOW_BASE_URL`
   (gateway private label). Não ligue `ADAFLOW_ALLOW_ANONYMOUS` sem pedido
   explícito: cada chamada anônima consome créditos da organização.

3. **Publicar a função**: `npx base44 functions deploy adaflow`.

4. **Usar no frontend**, sempre por `base44.functions.fetch('/adaflow', ...)`
   com `POST` e JSON `{ action, ...params }`. Ações: `listSpecialists`,
   `listAgents`, `listModels`, `listRepositories`, `chat`, `runAgent`,
   `trackEvents`. Parâmetros e exemplos (chat em streaming, agente,
   governança) estão no guia, seção "Ações da função".

5. **Ids reais**: se as tools MCP `adaflow` estiverem disponíveis, use
   `list_specialists` e `list_agents` para preencher `specialistId` e `agentId`
   em vez de deixar placeholder.

## Regras

- Nunca chame a API da Adaflow direto do frontend nem guarde o token em
  entidade, código ou variável de frontend.
- Erros vêm como `{ error: { code, message } }`. Mostre `message` ao usuário.
  `insufficient_quota` é aviso informativo, não erro.
- Chat: use `stream: true` e guarde o header `x-chat-id` para o próximo turno
  (envie só a mensagem nova com `chatId`).
- Governança: `action` no formato `app.<domínio>.<verbo>`. Sem dados pessoais
  em `metadata`. O nome do app vem do secret, não do navegador.
- **Sem SSO** em `*.base44.app` nem no preview: o app usa o token de app. O SSO
  da Adaflow só vale para apps publicados em `adalink.ai`/`adalink.app`.

## Erros comuns

| Resposta | Causa | Correção |
|---|---|---|
| `500 not_configured` | Falta `ADAFLOW_APP_TOKEN` | Passo 2 |
| `401 login_required` | Ninguém logado no app | Exigir login antes da tela |
| `401 adaflow_auth` | Token inválido ou revogado | Novo token + passo 2 |
| `403 adaflow_forbidden` | Usuário de serviço sem permissão | Ajustar o papel na Adaflow |
| `429 insufficient_quota` | Organização sem créditos | Aviso informativo |

## Validação

1. No app logado: `action: 'listSpecialists'` responde 200 com a lista.
2. Chat com `stream: true`: o texto aparece aos poucos, e o segundo turno com
   `chatId` mantém o contexto.
3. Deslogado: a função responde 401 `login_required`.
4. Inspecionar o bundle e as requisições do navegador: o token não aparece.
