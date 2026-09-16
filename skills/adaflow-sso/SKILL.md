---
name: adaflow-sso
description: Integra este app ao SSO do Adaflow (handoff). Use quando o pedido for autenticar o app via Adaflow/Adalink, implementar login SSO com handoff, consumir o fragment sso_token ou renovar JWT expirado.
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Integração com Adaflow SSO (handoff)

Implementa a autenticação deste app usando o Adaflow como Identity Provider.
Fonte de verdade dos contratos: o
[guia de apps integrados](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/docs/INTEGRATED-APPS-GUIDE.md)
— seção 1. Leia-a antes de implementar; em caso de divergência, o guia
prevalece sobre esta skill.

## Pré-requisitos

- O app DEVE ser servido em `https` num domínio `adalink.ai` / `adalink.app`
  (ou subdomínio). Em dev, `http://localhost` é aceito.
- Nenhum cadastro prévio é necessário — a autorização é pela allowlist de
  domínio, não por registro de app.

## Passos de implementação

Use `createSsoSession` do `@adaflow/sdk` (>= 0.4) — ele encapsula storage do
token, `Authorization`, renovação em 401 e as proteções anti-loop de redirect.
NÃO reimplemente esse miolo à mão; o interceptor manual "401 → refaz handoff"
já causou loop infinito de redirect em produção (ver armadilhas abaixo).

1. **Sessão** (módulo compartilhado do app):

   ```ts
   import { createSsoSession } from '@adaflow/sdk';

   export const session = createSsoSession({
     adaflowUrl: 'https://<adaflow>',
     callbackUrl: '/auth/callback', // default
     onSessionLost: () => {
       // renovação automática esgotada — mostre a tela de "Entrar".
       // NÃO redirecione ao handoff daqui: recriaria o loop.
     },
   });
   ```

2. **Botão de login** — `session.login()` redireciona ao handoff.

3. **Página de callback** (`/auth/callback`) — `session.completeLogin()`
   consome o `#sso_token`, salva no `sessionStorage` e limpa a URL do
   histórico. NUNCA logar o token.

4. **Chamadas à API** — `session.fetch(url, init)` anexa o
   `Authorization: Bearer <jwt>` (produção:
   `https://adalink-api-gateway.onrender.com`) e trata o 401 sozinho: refaz o
   handoff com guarda de cooldown, ignora 401 atrasado de token antigo e
   garante um único redirect por ciclo. Com sessão viva no Adaflow a
   renovação é transparente (sem digitar senha).

5. **UI reativa** (React) —
   `useSyncExternalStore(session.subscribe, session.getJwt, () => null)`.

### Armadilhas (se por algum motivo for implementar à mão)

Três erros que causaram loop infinito de redirect em produção, todos
disparados justamente com sessão viva no Adaflow (a volta do handoff é
instantânea) e respostas 200/401 misturadas nas chamadas paralelas:

1. Guarda de retry liberada por "alguma chamada deu 200" — cada 200 rearma a
   guarda e o próximo 401 redireciona de novo. A guarda deve ser POR TEMPO
   (cooldown, ex.: 60s).
2. Reagir a 401 de uma request enviada com token que já não é o corrente —
   derruba a sessão recém-renovada. Amarre o 401 ao token da request.
3. Vários 401 concorrentes disparando vários redirects — single-flight.

E no servidor do app, se ele valida o JWT perguntando ao gateway: gateway
inacessível deve responder `503`, nunca `401` — um 401 falso por instabilidade
derruba a sessão do usuário e alimenta o loop.

## Regras

- O JWT do usuário logado é SEMPRE preferido sobre app token — ver seção
  "Credenciais" do guia. App token (`x-ada-token`) só em server-to-server.
- O token trafega SÓ via fragment (`#sso_token=`) — nunca em query string,
  cookie cross-domain ou header no redirect.
- `/sso/finish` + `POST /v1/auth/sso/handoff/exchange` são internos do
  white-label — NÃO usar em app parceiro.

## Validação

1. Fluxo feliz: logado no Adaflow → redirect → app recebe token → chamada a
   `GET /v1/autonomous-agents` responde 200.
2. Sem sessão: deslogado → handoff manda para `/login?returnTo=...` → após
   login volta e entrega o token.
3. Segurança: conferir que a URL do browser NÃO contém `sso_token` após o
   callback (fragment limpo) e que o token não aparece em logs.
4. Expiração: forçar 401 (token inválido) e conferir que o app refaz o
   handoff sem loop infinito.
