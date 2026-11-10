# Adaflow para v0

Registry shadcn com blocos que conectam um app do [v0](https://v0.app) à
Adaflow, e a vitrine com o botão **Abrir no v0** para cada um. O mesmo app
publica o registry, mostra a vitrine e roda os blocos como exemplo.

| Bloco | O que instala |
|---|---|
| `adaflow-chat` | Chat com especialista ou modelo da Adaflow, com resposta em streaming e histórico guardado na Adaflow (`chatId`) |
| `adaflow-agent-runner` | Execução de um agente autônomo, com o contexto mantido entre execuções (`threadId`) |

Os dois blocos levam a mesma base:

- `lib/adaflow-server.ts`: lê o token, cria o cliente do `@adaflow/sdk` e traduz
  os erros da API em mensagens amigáveis. Importa `server-only`, então o build
  falha se alguém tentar usá-lo no navegador.
- `app/api/adaflow/status/route.ts`: diz se o token está configurado, sem
  expor o valor.
- `components/adaflow-setup-notice.tsx`: o aviso que aparece no lugar do
  bloco enquanto o token não está configurado.

## Como o cliente usa

1. Na vitrine, clica em **Abrir no v0** no bloco desejado.
2. No v0, adiciona a variável `ADAFLOW_APP_TOKEN` nas **Vars** do projeto, com
   um token de app criado na Adaflow por um usuário de serviço de permissões
   mínimas. Sem o prefixo `NEXT_PUBLIC_`: o token só é lido no servidor.
3. Pede ao v0 o que construir. Até o passo 2, o bloco mostra o aviso de
   configuração em vez de um erro.

O *Open in v0* não leva variáveis de ambiente, por isso o passo 2 é manual.
Opcional: conectar o [MCP da Adaflow](../mcp/README.md)
(`https://adaflow-mcp.adalink.app/mcp`) em MCP Connections, para o v0 conhecer
os especialistas e agentes da organização enquanto gera o app.

Fora do v0, qualquer projeto Next.js com shadcn instala com:

```bash
npx shadcn@latest add https://<vitrine>/r/adaflow-chat.json
```

## Segurança

- O token fica só no servidor: as rotas leem `ADAFLOW_APP_TOKEN` e os
  componentes chamam apenas as rotas do próprio app.
- As rotas validam `specialistId`, `agentId` e `chatId` como UUID, limitam o
  tamanho das mensagens e nunca devolvem o corpo técnico de um erro da API.
- Login com o usuário da Adaflow (SSO) não funciona no preview do v0 nem em
  `*.vercel.app`; ali o app usa o token de app. Ver a decisão no
  [guia da Base44](../base44/README.md#limites-conhecidos).

## Deploy na Vercel

Projeto na Vercel com **Root Directory** `connect/v0` e preset **Next.js**. O
`vercel.json` constrói o `@adaflow/sdk` do workspace e roda `shadcn build`
(gera `public/r/*.json`) antes do `next build`.

Variável opcional: `REGISTRY_BASE_URL`, o endereço público da vitrine. Sem ela,
os links do **Abrir no v0** usam o host da própria requisição.

## Desenvolvimento

```bash
pnpm --filter @adaflow/connect-v0 dev             # vitrine e exemplos em localhost:3000
pnpm --filter @adaflow/connect-v0 registry:build  # gera public/r
pnpm --filter @adaflow/connect-v0 test
```

Os arquivos do registry são os mesmos que o app roda: mudou um bloco, rode
`registry:build` e confira o exemplo em `/adaflow/chat` ou `/adaflow/agent`.
