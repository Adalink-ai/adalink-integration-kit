import { afterEach, describe, expect, it, vi } from 'vitest';
import { AdaflowApiError } from './errors.js';
import { HttpTransport, buildUrl, resolveBaseUrl } from './http.js';
import { AdaflowClient } from './index.js';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

type FetchArgs = [string, RequestInit | undefined];

function mockFetch(...responses: Array<Response | Error>) {
  const queue = [...responses];
  return vi.fn(async (_url: string, _init?: RequestInit): Promise<Response> => {
    const next = queue.shift();
    if (!next) throw new Error('fetch chamado mais vezes que o esperado');
    if (next instanceof Error) throw next;
    return next;
  });
}

const headersOf = (call: FetchArgs | undefined) => (call?.[1]?.headers ?? {}) as Record<string, string>;

describe('authFetch — fetch já autenticado', () => {
  it('dispensa jwt e appToken e não envia credencial própria', async () => {
    const authFetch = mockFetch(json({ ok: true }));
    const transport = new HttpTransport({ authFetch: authFetch as typeof fetch, baseUrl: '' });

    await transport.requestJson('/v1/projects');

    const headers = headersOf(authFetch.mock.calls[0] as FetchArgs);
    expect(headers.authorization).toBeUndefined();
    expect(headers['x-ada-token']).toBeUndefined();
  });

  it('ignora o ADAFLOW_APP_TOKEN do ambiente', async () => {
    vi.stubEnv('ADAFLOW_APP_TOKEN', 'da-env');
    const transport = new HttpTransport({ authFetch: mockFetch() as typeof fetch });
    await expect(transport.authHeaders()).resolves.toEqual({});
  });

  it('recusa combinar com jwt ou appToken', () => {
    const authFetch = mockFetch() as typeof fetch;
    expect(() => new HttpTransport({ authFetch, jwt: 'j' })).toThrow(/authFetch/);
    expect(() => new HttpTransport({ authFetch, appToken: 't' })).toThrow(/authFetch/);
  });

  it('upload para a URL pré-assinada usa o fetch comum, sem o Bearer do host', async () => {
    const authFetch = mockFetch(
      json({ fileId: 'f1', presignedUrl: 'https://storage.example.com/put' }),
      json({ ok: true }),
    );
    const plainFetch = mockFetch(new Response(null, { status: 200 }));
    const client = new AdaflowClient({
      authFetch: authFetch as typeof fetch,
      fetch: plainFetch as typeof fetch,
      baseUrl: 'https://gw.example.com',
    });

    await client.repositories.uploadDocument('r1', {
      fileName: 'a.txt',
      contentType: 'text/plain',
      data: new Uint8Array([1, 2, 3]),
    });

    expect(plainFetch).toHaveBeenCalledTimes(1);
    expect(plainFetch.mock.calls[0]?.[0]).toBe('https://storage.example.com/put');
    expect(authFetch.mock.calls.map((c) => c[0])).toEqual([
      'https://gw.example.com/v1/repositories/r1/files/presign',
      'https://gw.example.com/v1/repositories/r1/files/confirm',
    ]);
  });
});

describe('x-ada-client', () => {
  it('envia o header quando `client` é informado', async () => {
    const fetchMock = mockFetch(json({}));
    const transport = new HttpTransport({ jwt: 'j', client: 'ada-one', fetch: fetchMock as typeof fetch });
    await transport.request('/v1/ping');
    expect(headersOf(fetchMock.mock.calls[0] as FetchArgs)['x-ada-client']).toBe('ada-one');
  });

  it('não envia o header sem `client`', async () => {
    const fetchMock = mockFetch(json({}));
    const transport = new HttpTransport({ jwt: 'j', fetch: fetchMock as typeof fetch });
    await transport.request('/v1/ping');
    expect(headersOf(fetchMock.mock.calls[0] as FetchArgs)['x-ada-client']).toBeUndefined();
  });
});

describe('baseUrl na mesma origem', () => {
  it("'' é mantido (não cai no default de produção)", () => {
    expect(resolveBaseUrl('')).toBe('');
  });

  it('monta URL relativa com query', () => {
    expect(buildUrl('', '/v1/projects', { page: 2, search: 'a b', skip: undefined })).toBe(
      '/v1/projects?page=2&search=a+b',
    );
    expect(buildUrl('/api', '/v1/x')).toBe('/api/v1/x');
  });

  it('request com base relativa chega ao fetch como caminho', async () => {
    const fetchMock = mockFetch(json({}));
    const transport = new HttpTransport({ jwt: 'j', baseUrl: '', fetch: fetchMock as typeof fetch });
    await transport.request('/v1/users/me', { query: { a: 1 } });
    expect(fetchMock.mock.calls[0]?.[0]).toBe('/v1/users/me?a=1');
  });
});

describe('retry de GET', () => {
  it('repete GET em 503 e devolve a resposta boa', async () => {
    const fetchMock = mockFetch(json({}, 503), json({ ok: 1 }));
    const transport = new HttpTransport({ jwt: 'j', fetch: fetchMock as typeof fetch, retry: { baseMs: 1 } });
    await expect(transport.requestJson('/v1/x')).resolves.toEqual({ ok: 1 });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('repete GET em erro de rede', async () => {
    const fetchMock = mockFetch(new TypeError('fetch failed'), json({ ok: 1 }));
    const transport = new HttpTransport({ jwt: 'j', fetch: fetchMock as typeof fetch, retry: { baseMs: 1 } });
    await expect(transport.requestJson('/v1/x')).resolves.toEqual({ ok: 1 });
  });

  it('desiste depois das tentativas e lança AdaflowApiError', async () => {
    const fetchMock = mockFetch(json({}, 502), json({}, 502), json({ message: 'fora' }, 502));
    const transport = new HttpTransport({ jwt: 'j', fetch: fetchMock as typeof fetch, retry: { baseMs: 1 } });
    await expect(transport.request('/v1/x')).rejects.toMatchObject({ status: 502, message: 'fora' });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it('nunca repete 401', async () => {
    const fetchMock = mockFetch(json({ message: 'expirado' }, 401));
    const transport = new HttpTransport({ jwt: 'j', fetch: fetchMock as typeof fetch, retry: { baseMs: 1 } });
    await expect(transport.request('/v1/x')).rejects.toBeInstanceOf(AdaflowApiError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('nunca repete POST', async () => {
    const fetchMock = mockFetch(json({}, 503));
    const transport = new HttpTransport({ jwt: 'j', fetch: fetchMock as typeof fetch, retry: { baseMs: 1 } });
    await expect(transport.request('/v1/x', { method: 'POST', body: {} })).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('retry: false desliga', async () => {
    const fetchMock = mockFetch(json({}, 503));
    const transport = new HttpTransport({ jwt: 'j', fetch: fetchMock as typeof fetch, retry: false });
    await expect(transport.request('/v1/x')).rejects.toMatchObject({ status: 503 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('signal e timeout', () => {
  /** fetch que só resolve quando o signal aborta, como o real. */
  const hangingFetch = vi.fn(
    (_url: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        if (init?.signal?.aborted) return reject(init.signal.reason);
        init?.signal?.addEventListener('abort', () => reject(init.signal?.reason));
      }),
  );

  it('abort do chamador cancela e não repete', async () => {
    hangingFetch.mockClear();
    const transport = new HttpTransport({ jwt: 'j', fetch: hangingFetch as typeof fetch });
    const controller = new AbortController();
    const pending = transport.request('/v1/x', { signal: controller.signal });
    controller.abort(new DOMException('cancelado', 'AbortError'));
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(hangingFetch.mock.calls.length).toBeLessThanOrEqual(1);
  });

  it('timeoutMs do client corta a espera pela resposta', async () => {
    const transport = new HttpTransport({ jwt: 'j', fetch: hangingFetch as typeof fetch, timeoutMs: 10 });
    await expect(transport.request('/v1/x')).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('timeoutMs por chamada sobrepõe o do client', async () => {
    const transport = new HttpTransport({ jwt: 'j', fetch: hangingFetch as typeof fetch, timeoutMs: 60_000 });
    await expect(transport.request('/v1/x', { timeoutMs: 10 })).rejects.toMatchObject({ name: 'TimeoutError' });
  });

  it('o prazo não corta o corpo depois que os headers chegam', async () => {
    vi.useFakeTimers();
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return json({});
    });
    const transport = new HttpTransport({ jwt: 'j', fetch: fetchMock as typeof fetch, timeoutMs: 10 });
    await transport.request('/v1/stream', { stream: true });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(signal?.aborted).toBe(false);
  });

  it('o signal do chamador continua valendo para o corpo', async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      signal = init?.signal ?? undefined;
      return json({});
    });
    const transport = new HttpTransport({ jwt: 'j', fetch: fetchMock as typeof fetch });
    const controller = new AbortController();
    await transport.request('/v1/stream', { stream: true, signal: controller.signal });
    controller.abort();
    expect(signal?.aborted).toBe(true);
  });

  it('chat.create repassa o signal', async () => {
    const fetchMock = mockFetch(json({ choices: [{ message: { content: 'oi' } }] }));
    const client = new AdaflowClient({ jwt: 'j', fetch: fetchMock as typeof fetch });
    const controller = new AbortController();
    await client.chat.create({ model: 'm', messages: [] }, { signal: controller.signal });
    controller.abort();
    expect(fetchMock.mock.calls[0]?.[1]?.signal?.aborted).toBe(true);
  });
});
