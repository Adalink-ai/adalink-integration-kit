---
description: Implementa uma superfície de integração do Adaflow no app atual (sso, assistants, agent, chat, knowledge, governance, base44, v0)
argument-hint: <sso|assistants|agent|chat|knowledge|governance|base44|v0>
---

Implemente no projeto atual a integração com o Adaflow pedida em
`$ARGUMENTS`, usando a skill correspondente deste plugin:

| Argumento | Skill |
|---|---|
| `sso` | `adaflow-sso` |
| `assistants` | `adaflow-assistants` |
| `agent` | `adaflow-autonomous-agent` |
| `chat` | `adaflow-generic-chat` |
| `knowledge` | `adaflow-knowledge-repository` |
| `governance` | `adaflow-governance` |
| `base44` | `adaflow-base44` |
| `v0` | `adaflow-v0` |

Se o argumento vier vazio ou não bater com a tabela, mostre as opções e
pergunte qual. Ordem recomendada quando o app ainda não tem nada: SSO →
superfície de consumo (assistants, agent ou chat) → knowledge → governance.
App da Base44 ou do v0 usa `base44` ou `v0`, que já cobrem chat, agentes e
governança com token de app, sem SSO.

Siga os passos e o checklist de validação da skill. Antes de começar, verifique
se o projeto já usa `@adaflow/sdk` e reaproveite o client existente. Se as
tools MCP `adaflow` estiverem disponíveis, use-as para descobrir ids reais
(`list_specialists`, `list_agents`) em vez de deixar placeholders.
