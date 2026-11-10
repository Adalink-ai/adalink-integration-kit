---
name: adaflow-v0
description: Integra um app Next.js gerado pelo v0 (ou hospedado na Vercel sem SSO da Adaflow) aos blocos do Adaflow Connect, adaflow-chat e adaflow-agent-runner, com o token de app só no servidor. Use quando o pedido for conectar um app do v0 ou da Vercel a especialistas ou agentes da Adaflow.
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Adaflow em app do v0 (Next.js)

Instala os blocos do Adaflow Connect: rotas no servidor do próprio app falam
com a Adaflow usando o token de app, e os componentes falam só com essas
rotas. Fonte de verdade: o
[guia do v0](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/connect/v0/README.md).
Em divergência, o guia prevalece.

> App publicado em `adalink.ai`/`adalink.app` com usuário logado? Prefira o
> JWT do usuário (skill `adaflow-sso` + `adaflow-assistants`). Esta skill é para
> o preview do v0 e domínios `*.vercel.app`, onde o SSO da Adaflow não vale.

## Blocos

| Bloco | Uso |
|---|---|
| `adaflow-chat` | `<AdaflowChat specialistId="<uuid>" />` ou `model="<id do catálogo>"` |
| `adaflow-agent-runner` | `<AdaflowAgentRunner agentId="<uuid>" />` |

Os dois levam a mesma base: `lib/adaflow-server.ts`,
`app/api/adaflow/status/route.ts` e `components/adaflow-setup-notice.tsx`.

## Passos de implementação

1. **Instalar o bloco.** Com a vitrine publicada, use o shadcn:

   ```bash
   npx shadcn@latest add https://<vitrine>/r/adaflow-chat.json
   ```

   Sem a vitrine, copie os arquivos do bloco de
   [`connect/v0`](https://github.com/Adalink-ai/adalink-integration-kit/tree/main/connect/v0)
   para os mesmos caminhos (veja `files` em `registry.json`), instale
   `@adaflow/sdk` e `server-only`, e os componentes shadcn `button`, `card`,
   `input` e `scroll-area`. Em projeto com `src/`, os caminhos ganham `src/`
   na frente.

2. **Variável do projeto**: `ADAFLOW_APP_TOKEN` com o token de app (`ada_...`),
   nas Vars do v0 ou nas Environment Variables da Vercel. Peça o valor ao
   usuário; nunca escreva o token em arquivo. **Nunca** use o prefixo
   `NEXT_PUBLIC_`. Opcional: `ADAFLOW_BASE_URL` para gateway private label.

3. **Ids reais**: se as tools MCP `adaflow` estiverem disponíveis, use
   `list_specialists` e `list_agents` para preencher `specialistId` e `agentId`.

4. **Montar a tela** com o componente do bloco. Não chame a API da Adaflow de
   componente cliente: tudo passa pelas rotas `/api/adaflow/*`.

## Regras

- `lib/adaflow-server.ts` importa `server-only`; não o importe em componente
  cliente.
- Rotas de agente precisam de `maxDuration = 300`: execuções podem levar
  minutos.
- Erros das rotas vêm como `{ error: { code, message } }`; mostre `message`.
  `insufficient_quota` é aviso informativo.
- Toda chamada sai com `x-ada-client: v0`. Não troque o valor.

## Validação

1. Sem `ADAFLOW_APP_TOKEN`: o bloco mostra o aviso de configuração, sem erro.
2. Com o token: `GET /api/adaflow/status` responde `{ "configured": true }` e o
   chat responde em streaming.
3. Agente: a execução devolve `status: completed` e o segundo pedido mantém o
   contexto pelo `threadId`.
4. O token não aparece no bundle do navegador nem nas respostas das rotas.
