import { describe, expect, it, vi } from 'vitest';
import { AdaflowApiError } from './errors.js';
import { AdaflowClient } from './index.js';

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
  const client = new AdaflowClient({
    authFetch: gateway as unknown as typeof fetch,
    baseUrl: 'https://gw.example.com',
    retry: false,
  });
  const call = (i: number) => gateway.mock.calls[i] as Call;
  return { client, gateway, call };
}

describe('repositories.list', () => {
  it('lista com busca e paginação, no formato items da plataforma', async () => {
    const pagina = { items: [{ id: 'r1', name: 'Carteira' }], total: 1, page: 1, limit: 20, totalPages: 1 };
    const { client, call } = setup(json(pagina));
    const r = await client.repositories.list({ search: 'Carteira', page: 1, limit: 20 });
    expect(r.items[0]?.name).toBe('Carteira');
    expect(r.totalPages).toBe(1);
    const url = new URL(call(0)[0]);
    expect(url.pathname).toBe('/v1/repositories');
    expect(url.searchParams.get('search')).toBe('Carteira');
    expect(url.searchParams.get('limit')).toBe('20');
  });
});

describe('repositories.listFiles', () => {
  it('devolve os arquivos com projectFileId e os campos de versão', async () => {
    const { client } = setup(json([{
      id: 'link-1', repositoryId: 'r1', projectFileId: 'pf-1', fileName: 'carteira.xlsx', contentType: 'x', size: 10,
      extractionStatus: 'COMPLETED', indexingStatus: 'COMPLETED', addedBy: 'u1', createdAt: '2026-10-17T00:00:00Z',
      fileHash: 'a'.repeat(64), fileUpdatedAt: '2026-10-17T00:01:00Z',
    }]));
    const [arquivo] = await client.repositories.listFiles('r1');
    expect(arquivo?.projectFileId).toBe('pf-1');
    expect(arquivo?.fileHash).toHaveLength(64);
  });
});

describe('repositories.removeFile', () => {
  it('faz DELETE no projectFileId e aceita 204 sem corpo', async () => {
    const { client, call } = setup(new Response(null, { status: 204 }));
    await expect(client.repositories.removeFile('r1', 'pf-1')).resolves.toBeUndefined();
    expect(call(0)[0]).toBe('https://gw.example.com/v1/repositories/r1/files/pf-1');
    expect(call(0)[1]?.method).toBe('DELETE');
  });

  it('propaga o erro da plataforma (404 = arquivo já fora do repositório)', async () => {
    const { client } = setup(json({ message: 'não encontrado' }, 404));
    const erro = await client.repositories.removeFile('r1', 'pf-x').catch((e) => e);
    expect(erro).toBeInstanceOf(AdaflowApiError);
    expect((erro as AdaflowApiError).status).toBe(404);
  });
});

describe('specialists.unlinkRepository', () => {
  it('faz DELETE do vínculo e aceita 204', async () => {
    const { client, call } = setup(new Response(null, { status: 204 }));
    await expect(client.specialists.unlinkRepository('s1', 'r1')).resolves.toBeUndefined();
    expect(call(0)[0]).toBe('https://gw.example.com/v1/specialists/s1/repositories/r1');
    expect(call(0)[1]?.method).toBe('DELETE');
  });

  it('propaga 403 (sem a permissão de compartilhar repositórios)', async () => {
    const { client } = setup(json({ message: 'proibido' }, 403));
    const erro = await client.specialists.unlinkRepository('s1', 'r1').catch((e) => e);
    expect(erro).toBeInstanceOf(AdaflowApiError);
    expect((erro as AdaflowApiError).status).toBe(403);
  });
});
