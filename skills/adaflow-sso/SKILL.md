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

1. **Botão/redirect de login**:

   ```ts
   const redirectUrl = encodeURIComponent(window.location.origin + '/auth/callback');
   window.location.href = `https://<adaflow>/sso/handoff?redirect-url=${redirectUrl}`;
   ```

2. **Página de callback** (`/auth/callback` ou equivalente) — extrair o token
   do fragment, limpar a URL e persistir:

   ```ts
   const params = new URLSearchParams(window.location.hash.slice(1));
   const token = params.get('sso_token');
   if (token) {
     sessionStorage.setItem('adalink:jwt', decodeURIComponent(token));
     history.replaceState(null, '', window.location.pathname + window.location.search);
   }
   ```

   NUNCA logar o token nem deixá-lo no histórico do browser (o
   `history.replaceState` é obrigatório).

3. **Uso nas chamadas à API** — `Authorization: Bearer <jwt>` no gateway
   (produção: `https://adalink-api-gateway.onrender.com`).

4. **Renovação em 401** — interceptor HTTP que, ao receber `401`, refaz o
   redirect do passo 1. Se a sessão do Adaflow ainda existir, o ciclo é
   transparente (sem digitar senha). Cuidado com loop: se o handoff voltar e a
   chamada seguinte ainda der 401, pare e mostre erro de sessão.

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
