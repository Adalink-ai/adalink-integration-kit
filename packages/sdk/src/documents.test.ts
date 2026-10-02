import { describe, expect, it, vi } from 'vitest';
import { AdaflowClient } from './index.js';
import { isDocumentSettled, type AdaflowDocument } from './resources/documents.js';

const platformDoc = (extra: Record<string, unknown> = {}) => ({
  id: 'd1',
  projectId: 's1',
  organizationId: 'o1',
  name: 'a.pdf',
  originalName: 'a.pdf',
  url: null,
  contentType: 'application/pdf',
  size: 3,
  extractionStatus: 'PROCESSING',
  extractionMethod: null,
  extractionConfidence: null,
  indexingStatus: 'QUEUED',
  chunkCount: 0,
  fileHash: null,
  processingTimeMs: null,
  errorMessage: null,
  errorCode: null,
  createdAt: '2026-09-30T00:00:00Z',
  updatedAt: '2026-09-30T00:00:00Z',
  ...extra,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

type Call = [string, RequestInit | undefined];

function setup(...responses: Response[]) {
  const queue = [...responses];
  const gateway = vi.fn(async (_url: string, _init?: RequestInit) => {
    const next = queue.shift();
    if (!next) throw new Error('chamada inesperada ao gateway');
    return next;
  });
  const storage = vi.fn(async (_url: string, _init?: RequestInit) => new Response(null, { status: 200 }));
  const client = new AdaflowClient({
    authFetch: gateway as unknown as typeof fetch,
    fetch: storage as unknown as typeof fetch,
    baseUrl: 'https://gw.example.com',
    retry: false,
  });
  const body = (i: number) => JSON.parse(String((gateway.mock.calls[i] as Call)[1]?.body));
  const url = (i: number) => (gateway.mock.calls[i] as Call)[0];
  return { client, gateway, storage, body, url };
}

describe('documents — espaço (spaceId ↔ projectId)', () => {
  it('list envia projectId e devolve spaceId', async () => {
    const { client, url } = setup(json([platformDoc()]));
    const docs = await client.documents.list({ spaceId: 's1', status: 'COMPLETED', includeThumbnails: true, limit: 10 });
    expect(url(0)).toBe(
      'https://gw.example.com/v1/documents?projectId=s1&status=COMPLETED&includeThumbnails=true&limit=10',
    );
    expect(docs[0]?.spaceId).toBe('s1');
    expect(docs[0]).not.toHaveProperty('projectId');
  });

  it('get converte projectId nulo (upload avulso)', async () => {
    const { client } = setup(json(platformDoc({ projectId: null })));
    await expect(client.documents.get('d1')).resolves.toMatchObject({ id: 'd1', spaceId: null });
  });
});

describe('documents.upload', () => {
  it('presign → PUT com o content-type assinado, sem Bearer → confirm', async () => {
    const { client, gateway, storage, body, url } = setup(
      json({ fileId: 'f1', presignedUrl: 'https://r2.example.com/put', storageKey: 'k', contentType: 'application/pdf' }, 201),
      json(platformDoc({ id: 'f1' })),
    );

    const doc = await client.documents.upload({
      spaceId: 's1',
      fileName: 'a.pdf',
      contentType: 'application/pdf; charset=binary',
      data: new Uint8Array([1, 2, 3]),
      skipIndexing: true,
    });

    expect(url(0)).toBe('https://gw.example.com/v1/documents/presign');
    expect(body(0)).toEqual({
      fileName: 'a.pdf',
      contentType: 'application/pdf; charset=binary',
      fileSize: 3,
      projectId: 's1',
    });
    const [putUrl, putInit] = storage.mock.calls[0] as Call;
    expect(putUrl).toBe('https://r2.example.com/put');
    expect(putInit?.method).toBe('PUT');
    expect(putInit?.headers).toEqual({ 'content-type': 'application/pdf' });
    expect(url(1)).toBe('https://gw.example.com/v1/documents/confirm');
    expect(body(1)).toEqual({ fileId: 'f1', projectId: 's1', skipIndexing: true });
    expect(gateway).toHaveBeenCalledTimes(2);
    expect(doc.spaceId).toBe('s1');
  });

  it('falha no PUT não confirma', async () => {
    const { client, gateway, storage } = setup(
      json({ fileId: 'f1', presignedUrl: 'https://r2.example.com/put', contentType: 'text/plain' }, 201),
    );
    storage.mockResolvedValueOnce(new Response(null, { status: 403 }));
    await expect(
      client.documents.upload({ fileName: 'a.txt', contentType: 'text/plain', data: new Uint8Array([1]) }),
    ).rejects.toThrow(/NÃO foi confirmado/);
    expect(gateway).toHaveBeenCalledTimes(1);
  });

  it('recusa arquivo vazio antes de chamar a plataforma', async () => {
    const { client, gateway } = setup();
    await expect(
      client.documents.upload({ fileName: 'a.txt', contentType: 'text/plain', data: new Uint8Array() }),
    ).rejects.toThrow(/vazio/);
    expect(gateway).not.toHaveBeenCalled();
  });
});

describe('documents — respostas sem corpo e mídia', () => {
  it('delete aceita 204', async () => {
    const { client, gateway } = setup(new Response(null, { status: 204 }));
    await expect(client.documents.delete('d1')).resolves.toBeUndefined();
    expect((gateway.mock.calls[0] as Call)[1]?.method).toBe('DELETE');
  });

  it('thumbnail devolve null em 204 e o objeto em 200', async () => {
    const thumb = { imageUrl: 'https://x/t.jpg', width: 1, height: 1, atSeconds: null, pageNumber: 1 };
    const { client } = setup(new Response(null, { status: 204 }), json(thumb));
    await expect(client.documents.thumbnail('d1')).resolves.toBeNull();
    await expect(client.documents.thumbnail('d1')).resolves.toEqual(thumb);
  });

  it('importFromProvider traduz spaceId', async () => {
    const { client, body } = setup(
      json({ fileId: 'f', fileName: 'x', contentType: 'text/plain', size: 1, extractionStatus: 'PENDING' }, 201),
    );
    await client.documents.importFromProvider({
      connectionId: 'c',
      externalFileId: 'e',
      fileName: 'x',
      contentType: 'text/plain',
      spaceId: 's1',
    });
    expect(body(0)).toEqual({ connectionId: 'c', externalFileId: 'e', fileName: 'x', contentType: 'text/plain', projectId: 's1' });
  });
});

describe('documents.waitUntilProcessed', () => {
  it('consulta até extração e indexação terminarem', async () => {
    const { client, gateway } = setup(
      json(platformDoc()),
      json(platformDoc({ extractionStatus: 'COMPLETED', indexingStatus: 'PROCESSING' })),
      json(platformDoc({ extractionStatus: 'COMPLETED', indexingStatus: 'COMPLETED', chunkCount: 4 })),
    );
    const doc = await client.documents.waitUntilProcessed('d1', { intervalMs: 1 });
    expect(doc.chunkCount).toBe(4);
    expect(gateway).toHaveBeenCalledTimes(3);
  });

  it('para em FAILED e devolve o documento', async () => {
    const { client } = setup(json(platformDoc({ extractionStatus: 'FAILED', errorCode: 'PARSE_FAILED' })));
    await expect(client.documents.waitUntilProcessed('d1', { intervalMs: 1 })).resolves.toMatchObject({
      errorCode: 'PARSE_FAILED',
    });
  });

  it('desiste no prazo', async () => {
    const { client } = setup(json(platformDoc()), json(platformDoc()), json(platformDoc()));
    await expect(client.documents.waitUntilProcessed('d1', { intervalMs: 5, waitTimeoutMs: 8 })).rejects.toThrow(
      /ainda em processamento/,
    );
  });

  it('isDocumentSettled: anexo sem indexação conta como pronto', () => {
    const base = { extractionStatus: 'COMPLETED', indexingStatus: 'NONE' } as AdaflowDocument;
    expect(isDocumentSettled(base)).toBe(true);
    expect(isDocumentSettled({ ...base, indexingStatus: 'QUEUED' })).toBe(false);
  });
});
