# Prompt de instalação: Adaflow na Base44

Cole o bloco abaixo no chat do editor do seu app Base44. Antes, cadastre o
secret `ADAFLOW_APP_TOKEN` (passo 2 do [guia](../base44/README.md)).

Troque a última linha pelo que você quer construir.

---

```text
Quero integrar este app à Adaflow, a plataforma de IA da minha empresa.

1. Crie uma backend function chamada "adaflow" com EXATAMENTE o código do
   arquivo abaixo, sem alterar nada:
   https://raw.githubusercontent.com/Adalink-ai/adalink-integration-kit/main/connect/base44/functions/adaflow/entry.ts
   Se não conseguir abrir o link, me peça para colar o conteúdo.

2. Regras para usar a Adaflow neste app:
   - Toda chamada à Adaflow passa por essa função. Nunca chame a API da
     Adaflow direto do frontend e nunca peça, guarde ou exiba o token: ele
     fica no secret ADAFLOW_APP_TOKEN e só a função o lê.
   - Chame sempre com base44.functions.fetch('/adaflow', { method: 'POST',
     headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ...parâmetros }) }).
   - Ações disponíveis:
     - listSpecialists { page?, limit?, search? } → { items: [{ id, name, description }] }
     - listAgents { page?, limit?, search? } → { data: [{ id, name, description }] }
     - listModels {} → { data: [{ id }] }
     - listRepositories { page?, limit?, search? } → { items: [{ id, name }] }
     - chat { specialistId ou model, messages: [{ role, content }], chatId?, stream? }
       → formato OpenAI. Com stream: true a resposta é SSE: cada linha
       "data: {json}" traz choices[0].delta.content e termina em "data: [DONE]".
       Guarde o header x-chat-id da resposta e envie como chatId no próximo
       turno, mandando só a mensagem nova.
     - runAgent { agentId, input, threadId?, stream? } → { status, output } ou SSE.
     - trackEvents { events: [{ action: 'app.<dominio>.<verbo>', resource, metadata? }] }
       registra eventos na governança. Nunca ponha dados pessoais em metadata.
   - Erros vêm como { error: { code, message } }. Mostre a message ao
     usuário. Para code "insufficient_quota", mostre um aviso informativo, não
     um erro vermelho.
   - Use streaming no chat para o texto aparecer enquanto é gerado.

3. Depois de criar a função, teste chamando a ação listSpecialists e me
   mostre o resultado.

4. Agora construa: <descreva aqui a tela ou o fluxo que você quer>
```
