import type { CallOptions, HttpTransport } from '../http.js';

/**
 * Documentos (`/v1/documents`): upload, consulta, processamento e mídia.
 *
 * **Espaço (`spaceId`).** O contêiner onde os documentos vivem se chama
 * Espaço. A plataforma ainda o chama de projeto (`projectId`); o SDK traduz
 * na ida e na volta, então nenhum cliente depende do nome antigo.
 *
 * Permissões: leitura `knowledge.documents.read.own|any`; upload
 * `knowledge.documents.upload` (e a flag `knowledge.creation` no presign);
 * exclusão `knowledge.documents.delete.own|any`; reprocessar
 * `knowledge.documents.process`. Upload num espaço exige papel EDITOR ou acima.
 */

export type ExtractionStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type IndexingStatus = 'NONE' | 'QUEUED' | 'PROCESSING' | 'COMPLETED' | 'FAILED';
export type ExtractionMethod = 'DIRECT' | 'OCR' | 'MULTIMODAL';

export interface AdaflowDocument {
  id: string;
  /** Espaço do documento; `null` em upload avulso (só da organização). */
  spaceId: string | null;
  organizationId: string;
  name: string;
  originalName: string;
  /** URL assinada de download (24 h); `null` se a assinatura falhar. */
  url: string | null;
  contentType: string;
  /** Tamanho em bytes. */
  size: number;
  extractionStatus: ExtractionStatus;
  extractionMethod: ExtractionMethod | null;
  /** 0 a 1. */
  extractionConfidence: number | null;
  indexingStatus: IndexingStatus;
  chunkCount: number;
  fileHash: string | null;
  processingTimeMs: number | null;
  /** Mensagem pt-BR da falha. */
  errorMessage: string | null;
  /** Ex.: `PARSE_FAILED`, `TYPE_MISMATCH`, `EMPTY_FILE`. */
  errorCode: string | null;
  createdAt: string;
  updatedAt: string;
  /** Só na listagem com `includeThumbnails` (vídeos). */
  thumbnailUrl?: string | null;
}

/** Forma da plataforma: igual, com `projectId` no lugar de `spaceId`. */
type PlatformDocument = Omit<AdaflowDocument, 'spaceId'> & { projectId: string | null };

function fromPlatform({ projectId, ...rest }: PlatformDocument): AdaflowDocument {
  return { ...rest, spaceId: projectId };
}

export interface PresignDocumentParams {
  fileName: string;
  contentType: string;
  /** Bytes; de 1 a 500 MB. */
  fileSize: number;
  /** Espaço de destino. Sem ele, o upload é avulso (só da organização). */
  spaceId?: string;
  /** Chamado pela plataforma ao fim da ingestão. */
  ingestWebhookUrl?: string;
}

export interface PresignedDocumentUpload {
  fileId: string;
  /** URL de PUT, válida por 15 min. */
  presignedUrl: string;
  /**
   * Content-Type que foi assinado. O PUT precisa enviar EXATAMENTE este
   * header, ou o storage responde 403 (SignatureDoesNotMatch).
   */
  contentType: string;
}

export interface ConfirmDocumentParams {
  spaceId?: string;
  /** Guarda só como anexo: sem extração nem indexação. */
  skipIndexing?: boolean;
}

export interface UploadDocumentFileParams extends Omit<PresignDocumentParams, 'fileSize'> {
  /** Conteúdo; o tamanho é derivado daqui. */
  data: Uint8Array | ArrayBuffer | Blob;
  skipIndexing?: boolean;
}

export interface ListDocumentsQuery {
  /** Obrigatório: a plataforma lista por espaço. */
  spaceId: string;
  status?: ExtractionStatus;
  /** Inclui `thumbnailUrl` nos vídeos (limite default passa a 100). */
  includeThumbnails?: boolean;
  /** 1 a 200. Sem limite e sem thumbnails, vem o espaço inteiro. */
  limit?: number;
  offset?: number;
}

export interface ImportFromProviderParams {
  /** Conexão (Drive, OneDrive...) da organização. */
  connectionId: string;
  externalFileId: string;
  fileName: string;
  contentType: string;
  spaceId?: string;
  repositoryId?: string;
  specialistId?: string;
}

export interface ImportFromProviderResult {
  fileId: string;
  fileName: string;
  contentType: string;
  size: number;
  extractionStatus: ExtractionStatus;
}

export interface DocumentThumbnail {
  /** URL assinada (24 h por padrão). */
  imageUrl: string;
  width: number;
  height: number;
  /** Vídeo: instante do frame. */
  atSeconds: number | null;
  /** PDF e imagem: página. */
  pageNumber: number;
}

export interface DocumentPageImage {
  id: string;
  /** Começa em 1. */
  pageNumber: number;
  width: number | null;
  height: number | null;
  sizeBytes: number | null;
  /** URL assinada (24 h). */
  imageUrl: string;
}

export interface TranscriptUtterance {
  index: number;
  startSeconds: number;
  endSeconds: number;
  text: string;
  speaker: string | null;
  confidence: number | null;
  timestampLabel: string;
}

export interface MediaFrame {
  index: number;
  atSeconds: number;
  timestampLabel: string;
  /** URL assinada (1 h). */
  imageUrl: string;
  description: string | null;
  width: number;
  height: number;
}

export interface DocumentMediaContent {
  file: {
    id: string;
    name: string;
    contentType: string;
    sizeBytes: number;
    extractionStatus: ExtractionStatus;
    /** URL assinada do arquivo original (24 h). */
    sourceUrl: string;
  };
  transcript: {
    hasContent: boolean;
    fullText: string;
    language: string | null;
    provider: string | null;
    speakerCount: number;
    durationSeconds: number;
    utterances: TranscriptUtterance[];
  };
  frames: { hasFrames: boolean; count: number; items: MediaFrame[] };
}

export interface WaitForDocumentOptions extends CallOptions {
  /** Intervalo entre consultas, em ms. Default: 2000. */
  intervalMs?: number;
  /** Desiste depois disso, em ms. Default: 10 min. */
  waitTimeoutMs?: number;
}

/** Tamanho máximo aceito pelo presign (500 MB). */
export const MAX_DOCUMENT_UPLOAD_BYTES = 500 * 1024 * 1024;

const BASE = '/v1/documents';
const TERMINAL: ReadonlySet<ExtractionStatus> = new Set(['COMPLETED', 'FAILED']);

function byteLength(data: UploadDocumentFileParams['data']): number {
  if (data instanceof Blob) return data.size;
  return data.byteLength;
}

/** Processamento terminou? Extração e indexação, a que se aplicar. */
export function isDocumentSettled(doc: AdaflowDocument): boolean {
  if (doc.extractionStatus === 'FAILED') return true;
  if (!TERMINAL.has(doc.extractionStatus)) return false;
  return doc.indexingStatus === 'NONE' || doc.indexingStatus === 'COMPLETED' || doc.indexingStatus === 'FAILED';
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export class DocumentsResource {
  constructor(
    private readonly http: HttpTransport,
    /** fetch comum, sem credencial: o PUT vai direto ao storage. */
    private readonly fetchImpl: typeof fetch,
  ) {}

  /** Passo 1: URL pré-assinada para o PUT. */
  async presign(params: PresignDocumentParams, options?: CallOptions): Promise<PresignedDocumentUpload> {
    const { spaceId, ...rest } = params;
    const res = await this.http.requestJson<PresignedDocumentUpload & { storageKey?: string }>(
      `${BASE}/presign`,
      { ...options, method: 'POST', body: { ...rest, projectId: spaceId } },
    );
    return { fileId: res.fileId, presignedUrl: res.presignedUrl, contentType: res.contentType };
  }

  /** Passo 3: confirma o upload e dispara extração e indexação. */
  async confirm(fileId: string, params: ConfirmDocumentParams = {}, options?: CallOptions): Promise<AdaflowDocument> {
    const doc = await this.http.requestJson<PlatformDocument>(`${BASE}/confirm`, {
      ...options,
      method: 'POST',
      body: { fileId, projectId: params.spaceId, skipIndexing: params.skipIndexing },
    });
    return fromPlatform(doc);
  }

  /**
   * Upload completo: presign → PUT no storage → confirm. Sem o confirm o
   * documento não existe para a busca, por isso é um método só. A extração
   * continua assíncrona depois do retorno; use `waitUntilProcessed`.
   */
  async upload(params: UploadDocumentFileParams, options?: CallOptions): Promise<AdaflowDocument> {
    const { data, skipIndexing, ...presignParams } = params;
    const fileSize = byteLength(data);
    if (fileSize === 0) throw new Error('Arquivo vazio: nada a enviar.');
    if (fileSize > MAX_DOCUMENT_UPLOAD_BYTES) {
      throw new Error(`Arquivo acima de ${MAX_DOCUMENT_UPLOAD_BYTES / 1024 / 1024} MB.`);
    }

    const presigned = await this.presign({ ...presignParams, fileSize }, options);
    const put = await this.fetchImpl(presigned.presignedUrl, {
      method: 'PUT',
      // O header assinado, não o informado: divergir dá 403 no storage.
      headers: { 'content-type': presigned.contentType },
      // Cast: Uint8Array<ArrayBufferLike> não satisfaz BodyInit no TS 5.9, mas é aceito em runtime.
      body: (data instanceof ArrayBuffer ? new Uint8Array(data) : data) as BodyInit,
      signal: options?.signal,
    });
    if (!put.ok) {
      throw new Error(
        `Falha no upload para o storage (HTTP ${put.status}). O documento NÃO foi confirmado — tente novamente.`,
      );
    }
    return this.confirm(presigned.fileId, { spaceId: presignParams.spaceId, skipIndexing }, options);
  }

  /** Importa um arquivo de uma conexão (Drive, OneDrive...) sem baixar no app. */
  async importFromProvider(params: ImportFromProviderParams, options?: CallOptions): Promise<ImportFromProviderResult> {
    const { spaceId, ...rest } = params;
    return this.http.requestJson<ImportFromProviderResult>(`${BASE}/import-from-provider`, {
      ...options,
      method: 'POST',
      body: { ...rest, projectId: spaceId },
    });
  }

  /** Documentos do espaço (paginação por `limit`/`offset`). */
  async list(query: ListDocumentsQuery, options?: CallOptions): Promise<AdaflowDocument[]> {
    const docs = await this.http.requestJson<PlatformDocument[]>(BASE, {
      ...options,
      query: {
        projectId: query.spaceId,
        status: query.status,
        includeThumbnails: query.includeThumbnails === undefined ? undefined : String(query.includeThumbnails),
        limit: query.limit,
        offset: query.offset,
      },
    });
    return docs.map(fromPlatform);
  }

  async get(id: string, options?: CallOptions): Promise<AdaflowDocument> {
    return fromPlatform(await this.http.requestJson<PlatformDocument>(`${BASE}/${id}`, options));
  }

  /**
   * Exclusão definitiva: arquivo, trechos indexados e imagens de página. Um
   * documento avulso ligado a repositório sai por `repositories`, não aqui.
   */
  async delete(id: string, options?: CallOptions): Promise<void> {
    const res = await this.http.request(`${BASE}/${id}`, { ...options, method: 'DELETE' });
    await res.body?.cancel().catch(() => undefined);
  }

  /** Refaz extração e indexação (consome créditos de ingestão). */
  async reprocess(id: string, options?: CallOptions): Promise<AdaflowDocument> {
    return fromPlatform(
      await this.http.requestJson<PlatformDocument>(`${BASE}/${id}/reprocess`, { ...options, method: 'POST' }),
    );
  }

  /** Refaz só a indexação, sobre o texto já extraído. */
  async reindex(id: string, options?: CallOptions): Promise<AdaflowDocument> {
    return fromPlatform(
      await this.http.requestJson<PlatformDocument>(`${BASE}/${id}/reindex`, { ...options, method: 'POST' }),
    );
  }

  /** Transcrição e frames de áudio e vídeo, com URL assinada do original. */
  async mediaContent(id: string, options?: CallOptions): Promise<DocumentMediaContent> {
    return this.http.requestJson<DocumentMediaContent>(`${BASE}/${id}/media-content`, options);
  }

  /** Miniatura (frame de vídeo ou página 1). `null` enquanto não há frame. */
  async thumbnail(id: string, options?: CallOptions): Promise<DocumentThumbnail | null> {
    const res = await this.http.request(`${BASE}/${id}/thumbnail`, options);
    if (res.status === 204) return null;
    return (await res.json()) as DocumentThumbnail;
  }

  /** Imagens das páginas renderizadas (PDF, Office), com URL assinada. */
  async pages(id: string, options?: CallOptions): Promise<DocumentPageImage[]> {
    return this.http.requestJson<DocumentPageImage[]>(`${BASE}/${id}/pages`, options);
  }

  /**
   * Consulta o documento até a extração e a indexação terminarem. A
   * plataforma não tem stream de progresso de documento; isto é polling.
   * Devolve o documento final, inclusive `FAILED` (olhe `errorCode`).
   */
  async waitUntilProcessed(id: string, options: WaitForDocumentOptions = {}): Promise<AdaflowDocument> {
    const { intervalMs = 2_000, waitTimeoutMs = 10 * 60_000, ...call } = options;
    const deadline = Date.now() + waitTimeoutMs;
    for (;;) {
      const doc = await this.get(id, call);
      if (isDocumentSettled(doc)) return doc;
      if (Date.now() + intervalMs > deadline) {
        throw new Error(`Documento ${id} ainda em processamento após ${waitTimeoutMs} ms.`);
      }
      await sleep(intervalMs, call.signal);
    }
  }
}
