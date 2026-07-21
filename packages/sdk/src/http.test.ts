import { afterEach, describe, expect, it, vi } from 'vitest';
import { DEFAULT_BASE_URL, HttpTransport, resolveBaseUrl } from './http.js';

afterEach(() => {
  vi.unstubAllEnvs();
});

describe('resolveBaseUrl', () => {
  it('explícita tem precedência sobre a env', () => {
    vi.stubEnv('ADAFLOW_BASE_URL', 'https://env.example.com');
    expect(resolveBaseUrl('https://explicita.example.com/')).toBe('https://explicita.example.com');
  });

  it('cai na env ADAFLOW_BASE_URL (private label)', () => {
    vi.stubEnv('ADAFLOW_BASE_URL', 'https://api.cliente-privatelabel.com/');
    expect(resolveBaseUrl()).toBe('https://api.cliente-privatelabel.com');
  });

  it('sem nada, usa o default de produção', () => {
    expect(resolveBaseUrl()).toBe(DEFAULT_BASE_URL);
  });

  it('env vazia é ignorada', () => {
    vi.stubEnv('ADAFLOW_BASE_URL', '  ');
    expect(resolveBaseUrl()).toBe(DEFAULT_BASE_URL);
  });
});

describe('HttpTransport — credencial', () => {
  it('sem credencial nenhuma, lança erro claro', () => {
    expect(() => new HttpTransport()).toThrow(/ADAFLOW_APP_TOKEN/);
  });

  it('aceita app token via env ADAFLOW_APP_TOKEN (zero config)', async () => {
    vi.stubEnv('ADAFLOW_APP_TOKEN', 'token-do-ambiente');
    const transport = new HttpTransport();
    await expect(transport.authHeaders()).resolves.toEqual({
      'x-ada-token': 'token-do-ambiente',
    });
  });

  it('aceita o alias ADA_TOKEN', async () => {
    vi.stubEnv('ADA_TOKEN', 'alias-token');
    const transport = new HttpTransport();
    await expect(transport.authHeaders()).resolves.toEqual({ 'x-ada-token': 'alias-token' });
  });

  it('appToken explícito prevalece sobre a env', async () => {
    vi.stubEnv('ADAFLOW_APP_TOKEN', 'da-env');
    const transport = new HttpTransport({ appToken: 'explicito' });
    await expect(transport.authHeaders()).resolves.toEqual({ 'x-ada-token': 'explicito' });
  });

  it('jwt sempre prevalece sobre app token (auditoria no usuário real)', async () => {
    vi.stubEnv('ADAFLOW_APP_TOKEN', 'da-env');
    const transport = new HttpTransport({ jwt: 'meu-jwt' });
    await expect(transport.authHeaders()).resolves.toEqual({ authorization: 'Bearer meu-jwt' });
  });
});

describe('HttpTransport — binding do fetch (regressão browser)', () => {
  it('não lança Illegal invocation com fetch this-sensitive (como o do window)', async () => {
    // Simula o fetch do browser: exige this === globalThis/undefined-bound.
    function strictFetch(this: unknown): Promise<Response> {
      if (this !== globalThis && this !== undefined) {
        throw new TypeError("Failed to execute 'fetch' on 'Window': Illegal invocation");
      }
      return Promise.resolve(new Response('{}', { status: 200 }));
    }
    const transport = new HttpTransport({ jwt: 'j', fetch: strictFetch as typeof fetch });
    await expect(transport.request('/v1/ping')).resolves.toBeInstanceOf(Response);
  });
});
