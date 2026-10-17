import type { HttpTransport } from '../http.js';
import type { ExtractionStatus, IndexingStatus } from './documents.js';

export type RepositoryVisibility = 'PRIVATE' | 'TEAM' | 'ORG' | 'PUBLIC';

export interface CreateRepositoryParams {
  name: string;
  description?: string;
  /** `a-z`, `0-9` e hífens; único na organização. Gerado a partir do nome se omitido. */
  slug?: string;
  /** Default `PRIVATE`. `TEAM` exige `teamIds`. */
  visibility?: RepositoryVisibility;
  teamIds?: string[];
}

export interface Repository {
  id: string;
  name: string;
  slug?: string;
  description?: string;
  visibility?: RepositoryVisibility;
  [key: string]: unknown;
}

/** Página de `GET /v1/repositories` (formato da plataforma: `items`, não `data`). */
export interface RepositoryPage {
  items: Repository[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Arquivo vinculado a um repositório (`GET /v1/repositories/:id/files`). */
export interface RepositoryFile {
  /** id do vínculo (RepositoryFile) */
  id: string;
  repositoryId: string;
  /** id do arquivo: é este que `removeFile` e `documents.get` recebem. Cada novo envio gera um novo. */
  projectFileId: string;
  fileName: string;
  contentType: string;
  size: number;
  // `(string & {})` aceita status novos da plataforma sem apagar o autocomplete dos conhecidos
  extractionStatus: ExtractionStatus | (string & {});
  indexingStatus: IndexingStatus | (string & {});
  addedBy: string;
  /** quando o arquivo foi vinculado ao repositório */
  createdAt: string;
  chunkCount?: number;
  errorMessage?: string | null;
  errorCode?: string | null;
  /**
   * Sinal de troca de conteúdo (sha256 calculado na ingestão); `null` enquanto
   * a ingestão não calculou. Só em versões da plataforma que já o expõem.
   */
  fileHash?: string | null;
  /** última alteração do arquivo (inclui mudanças de status); só em versões que o expõem */
  fileUpdatedAt?: string;
  [key: string]: unknown;
}

export interface PresignResult {
  fileId: string;
  presignedUrl: string;
  storageKey: string;
}

export interface UploadDocumentParams {
  fileName: string;
  contentType: string;
  /** Conteúdo do arquivo. `fileSize` é derivado automaticamente. */
  data: Uint8Array | ArrayBuffer | Blob;
}

const BASE = '/v1/repositories';

function byteLength(data: UploadDocumentParams['data']): number {
  if (data instanceof Blob) return data.size;
  return data instanceof ArrayBuffer ? data.byteLength : data.byteLength;
}

/**
 * Repositórios de conhecimento (`/v1/repositories`).
 * Rotas de escrita exigem JWT de usuário com role ADMIN/CREATOR, permissão
 * `knowledge.repositories.create` e feature flag `knowledge.creation` na org.
 */
export class RepositoriesResource {
  constructor(
    private readonly http: HttpTransport,
    private readonly fetchImpl: typeof fetch,
  ) {}

  /** Lista os repositórios visíveis para quem chama, com busca opcional por nome. */
  async list(query?: { page?: number; limit?: number; search?: string }): Promise<RepositoryPage> {
    return this.http.requestJson<RepositoryPage>(BASE, { query });
  }

  async create(params: CreateRepositoryParams): Promise<Repository> {
    return this.http.requestJson<Repository>(BASE, { method: 'POST', body: params });
  }

  async get(repositoryId: string): Promise<Repository> {
    return this.http.requestJson<Repository>(`${BASE}/${repositoryId}`);
  }

  /** Arquivos do repositório com a situação de extração e indexação (lista completa, sem paginação). */
  async listFiles(repositoryId: string): Promise<RepositoryFile[]> {
    return this.http.requestJson<RepositoryFile[]>(`${BASE}/${repositoryId}/files`);
  }

  /**
   * Tira o arquivo do repositório (`projectFileId`, não o id do vínculo).
   * Se era o último vínculo do arquivo, a plataforma apaga também o conteúdo e
   * os trechos do RAG. Arquivo que veio de fonte externa (SharePoint, Drive)
   * não volta na próxima sincronização enquanto não mudar na origem.
   * `404` = o arquivo já não está no repositório (o chamador pode tratar como sucesso).
   */
  async removeFile(repositoryId: string, projectFileId: string): Promise<void> {
    await this.http.request(`${BASE}/${encodeURIComponent(repositoryId)}/files/${encodeURIComponent(projectFileId)}`, { method: 'DELETE' });
  }

  /** Passo 1 do upload: gera a presigned URL (máx. 500 MB por arquivo). */
  async presign(
    repositoryId: string,
    params: { fileName: string; contentType: string; fileSize: number },
  ): Promise<PresignResult> {
    return this.http.requestJson<PresignResult>(`${BASE}/${repositoryId}/files/presign`, {
      method: 'POST',
      body: params,
    });
  }

  /** Passo 3 do upload: confirma e dispara o pipeline de OCR/parsing/embedding. */
  async confirm(repositoryId: string, fileId: string): Promise<unknown> {
    return this.http.requestJson<unknown>(`${BASE}/${repositoryId}/files/confirm`, {
      method: 'POST',
      body: { fileId },
    });
  }

  /**
   * Upload completo orquestrado: presign → PUT direto no storage → confirm.
   * Sem o confirm o arquivo não existe para o RAG — por isso os 3 passos são
   * um único método. O processamento (OCR/embedding) continua assíncrono após
   * o retorno; acompanhe via `listFiles`.
   */
  async uploadDocument(repositoryId: string, params: UploadDocumentParams): Promise<{ fileId: string }> {
    const fileSize = byteLength(params.data);
    const { fileId, presignedUrl } = await this.presign(repositoryId, {
      fileName: params.fileName,
      contentType: params.contentType,
      fileSize,
    });

    const putRes = await this.fetchImpl(presignedUrl, {
      method: 'PUT',
      headers: { 'content-type': params.contentType },
      // Cast: Uint8Array<ArrayBufferLike> não satisfaz BodyInit no TS 5.9, mas é aceito em runtime.
      body: (params.data instanceof ArrayBuffer ? new Uint8Array(params.data) : params.data) as BodyInit,
    });
    if (!putRes.ok) {
      throw new Error(
        `Falha no upload para o storage (HTTP ${putRes.status}). O arquivo NÃO foi confirmado — tente novamente.`,
      );
    }

    await this.confirm(repositoryId, fileId);
    return { fileId };
  }

  /** Vincula arquivo já existente na plataforma e dispara a indexação completa (idempotente). */
  async promoteFile(repositoryId: string, projectFileId: string): Promise<unknown> {
    return this.http.requestJson<unknown>(`${BASE}/${repositoryId}/files/promote`, {
      method: 'POST',
      body: { projectFileId },
    });
  }
}
