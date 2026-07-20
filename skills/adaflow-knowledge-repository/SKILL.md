---
name: adaflow-knowledge-repository
description: Integra este app aos repositórios de conhecimento da plataforma Adalink — criar repositório, subir documentos (presign → upload R2 → confirm) e vincular ao RAG de um especialista. Use quando o pedido for criar base de conhecimento, subir/indexar documentos ou abastecer o RAG.
allowed-tools: Read, Edit, Write, Bash, Glob, Grep
---

# Integração com Adaflow Knowledge Repository

Cria repositórios de conhecimento, sobe documentos e fecha o ciclo do RAG
vinculando ao especialista. Fonte de verdade: o
[guia de apps integrados](https://github.com/Adalink-ai/adalink-integration-kit/blob/main/docs/INTEGRATED-APPS-GUIDE.md)
— seção 4.

## Pré-requisitos

- **JWT de usuário** com role `ADMIN` ou `CREATOR` (skill `adaflow-sso`).
- Permissão `knowledge.repositories.create` e feature flag
  `knowledge.creation` ligada na organização.

## Passos de implementação

1. **Criar o repositório**:

   ```bash
   curl -X POST "https://adalink-api-gateway.onrender.com/v1/repositories" \
     -H "Authorization: Bearer $JWT" \
     -H "Content-Type: application/json" \
     -d '{"name": "Base Jurídica", "description": "...", "visibility": "PRIVATE"}'
   ```

   Campos: `name` (obrigatório), `description?`, `slug?` (`a-z0-9-`, gerado
   do nome se omitido), `visibility?` (`PRIVATE` default | `TEAM` — exige
   `teamIds` | `ORG` | `PUBLIC`). Guardar o `id` do 201.

2. **Subir cada documento em 3 passos** (o binário vai direto ao storage,
   não passa pelo gateway):

   ```bash
   # 2a. presign (máx. 500 MB por arquivo)
   curl -X POST ".../v1/repositories/$REPO_ID/files/presign" \
     -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
     -d '{"fileName": "contrato.pdf", "contentType": "application/pdf", "fileSize": 2097152}'
   # → { "fileId": "<uuid>", "presignedUrl": "https://...", "storageKey": "..." }

   # 2b. upload direto na presigned URL (mesmo Content-Type do presign)
   curl -X PUT "$PRESIGNED_URL" -H "Content-Type: application/pdf" --data-binary @contrato.pdf

   # 2c. confirm — dispara OCR/parsing/embedding (SEM isso o RAG não vê o arquivo)
   curl -X POST ".../v1/repositories/$REPO_ID/files/confirm" \
     -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
     -d "{\"fileId\": \"$FILE_ID\"}"
   ```

3. **Vincular ao especialista** (o RAG passa a valer em todas as conversas,
   inclusive via `assistant:<uuid>` — skill `adaflow-assistants`):

   ```bash
   curl -X POST ".../v1/specialists/$SPECIALIST_ID/repositories" \
     -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" \
     -d "{\"repositoryId\": \"$REPO_ID\"}"
   ```

## Regras

- O `confirm` (2c) é OBRIGATÓRIO — presign + upload sem confirm deixa o
  arquivo invisível para o RAG. Em código, trate falha no confirm como falha
  do upload inteiro (retry ou desfazer).
- O processamento é **assíncrono** — acompanhe o status em
  `GET /v1/repositories/:id/files` antes de prometer o documento nas
  respostas do especialista.
- Quem pode subir: o criador do repositório, `ADMIN` ou `SUPERADMIN`.
- Arquivo já existente na plataforma: usar
  `POST /v1/repositories/:id/files/promote` com `{ "projectFileId": "<uuid>" }`
  (idempotente) em vez de novo upload.
- Vínculo ao especialista: `409` = já vinculado (ok, idempotência do caller);
  `404` = repositório não visível ao usuário (anti-IDOR).

## Validação

1. Criar repositório → 201 com `id`; slug inválido (maiúsculas) → 400.
2. Ciclo completo de upload → arquivo aparece em `GET /:id/files` e, após o
   processamento, o especialista vinculado responde pergunta cujo conteúdo só
   existe no documento.
3. Upload sem confirm → arquivo NÃO utilizado pelo RAG (comportamento
   esperado, documente no app).
4. Usuário sem role `ADMIN`/`CREATOR` → 403 no create (aviso informativo).
