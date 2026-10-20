import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSsoSession, readJwtExpMs, type SsoSessionOptions } from './sso-session.js';

const ADAFLOW = 'https://adaflow.test';
const HANDOFF = `${ADAFLOW}/sso/handoff?redirect-url=`;

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b64({ alg: 'none', typ: 'JWT' })}.${b64(payload)}.assinatura`;
}

class FakeStorage {
  private map = new Map<string, string>();
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  setItem(key: string, value: string): void {
    this.map.set(key, String(value));
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
}

/** Stub mínimo de browser: registra navegações em vez de navegar. */
function stubBrowser(href = 'https://app.test/painel') {
  const navigations: string[] = [];
  const url = new URL(href);
  const win = {
    location: {
      origin: url.origin,
      pathname: url.pathname,
      search: url.search,
      hash: url.hash,
      set href(value: string) {
        navigations.push(value);
      },
    },
    history: { replaceState: vi.fn() },
  };
  vi.stubGlobal('window', win);
  vi.stubGlobal('sessionStorage', new FakeStorage());
  return { navigations, window: win };
}

function makeSession(overrides: Partial<SsoSessionOptions> = {}) {
  return createSsoSession({ adaflowUrl: ADAFLOW, ...overrides });
}

/** A promise ainda está pendente? (resolve marcador se nada chegar antes) */
async function isPending(p: Promise<unknown>): Promise<boolean> {
  const marker = Symbol('pending');
  const winner = await Promise.race([p, Promise.resolve(marker)]);
  return winner === marker;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-08-20T12:00:00Z'));
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('readJwtExpMs', () => {
  it('lê exp em ms; null sem exp ou em token ilegível', () => {
    expect(readJwtExpMs(makeJwt({ exp: 1_755_000_000 }))).toBe(1_755_000_000_000);
    expect(readJwtExpMs(makeJwt({ sub: 'u1' }))).toBeNull();
    expect(readJwtExpMs('nao-e-jwt')).toBeNull();
    expect(readJwtExpMs('a.@@@@.c')).toBeNull();
  });
});

describe('login / completeLogin', () => {
  it('login redireciona ao handoff com o callback resolvido contra a origin', () => {
    const { navigations } = stubBrowser();
    makeSession().login();
    expect(navigations[0]).toBe(
      `${HANDOFF}${encodeURIComponent('https://app.test/auth/callback')}`,
    );
  });

  it('completeLogin consome o fragment, salva o token e notifica assinantes', () => {
    const { window: win } = stubBrowser('https://app.test/auth/callback#sso_token=tok-1');
    const session = makeSession();
    const listener = vi.fn();
    session.subscribe(listener);

    expect(session.completeLogin()).toBe('tok-1');
    expect(session.getJwt()).toBe('tok-1');
    expect(listener).toHaveBeenCalled();
    expect(win.history.replaceState).toHaveBeenCalled(); // fragment fora do histórico
  });

  it('completeLogin NÃO desarma a guarda de retry (lição do loop)', async () => {
    stubBrowser('https://app.test/auth/callback#sso_token=tok-novo');
    sessionStorage.setItem('adaflow:jwt:renewed-at', String(Date.now() - 1000));
    const onSessionLost = vi.fn();
    const session = makeSession({ onSessionLost });
    session.completeLogin();

    // Token novo ainda toma 401 dentro do cooldown → tela de login, sem loop.
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const res = await session.fetch('/api/coisas');
    expect(res.status).toBe(401);
    expect(onSessionLost).toHaveBeenCalledOnce();
  });
});

describe('fetch — anexa Authorization', () => {
  it('anexa Bearer do token corrente e preserva Authorization explícito', async () => {
    stubBrowser();
    sessionStorage.setItem('adaflow:jwt', makeJwt({ exp: Date.now() / 1000 + 3600 }));
    const fetchMock = vi.fn().mockResolvedValue(new Response('{}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession();

    await session.fetch('/api/coisas');
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit).headers);
    expect(headers.get('authorization')).toMatch(/^Bearer ey/);

    await session.fetch('/api/outra', { headers: { authorization: 'Bearer explicito' } });
    const headers2 = new Headers((fetchMock.mock.calls[1]?.[1] as RequestInit).headers);
    expect(headers2.get('authorization')).toBe('Bearer explicito');
  });
});

describe('fetch — 401 e a guarda de cooldown', () => {
  it('primeiro 401 renova via handoff e deixa a promise pendente', async () => {
    const { navigations } = stubBrowser();
    sessionStorage.setItem('adaflow:jwt', 'tok-vivo-mas-rejeitado');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const session = makeSession();

    const p = session.fetch('/api/coisas');
    await expect(isPending(p)).resolves.toBe(true);
    expect(navigations).toHaveLength(1);
    expect(navigations[0]).toContain('/sso/handoff');
    expect(session.getJwt()).toBeNull(); // token morto não fica para trás
  });

  it('401 dentro do cooldown NÃO redireciona: limpa a sessão e entrega o 401', async () => {
    const { navigations } = stubBrowser();
    // Documento pós-handoff: token novo salvo e guarda armada há 5s.
    sessionStorage.setItem('adaflow:jwt', 'tok-novo');
    sessionStorage.setItem('adaflow:jwt:renewed-at', String(Date.now() - 5_000));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const onSessionLost = vi.fn();
    const session = makeSession({ onSessionLost });

    const res = await session.fetch('/api/coisas');
    expect(res.status).toBe(401);
    expect(navigations).toHaveLength(0);
    expect(onSessionLost).toHaveBeenCalledOnce();
    expect(session.getJwt()).toBeNull();
  });

  it('um 200 no meio NÃO rearma a guarda (a causa do loop infinito)', async () => {
    const { navigations } = stubBrowser();
    sessionStorage.setItem('adaflow:jwt', 'tok-novo');
    sessionStorage.setItem('adaflow:jwt:renewed-at', String(Date.now() - 5_000));
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const onSessionLost = vi.fn();
    const session = makeSession({ onSessionLost });

    await session.fetch('/api/que-deu-certo');
    const res = await session.fetch('/api/que-deu-401');
    expect(res.status).toBe(401);
    expect(navigations).toHaveLength(0); // nada de segundo handoff
    expect(onSessionLost).toHaveBeenCalledOnce();
  });

  it('após o cooldown, um novo 401 volta a renovar transparentemente', async () => {
    const { navigations } = stubBrowser();
    sessionStorage.setItem('adaflow:jwt', 'tok');
    sessionStorage.setItem('adaflow:jwt:renewed-at', String(Date.now() - 61_000));
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const session = makeSession();

    const p = session.fetch('/api/coisas');
    await expect(isPending(p)).resolves.toBe(true);
    expect(navigations).toHaveLength(1);
  });
});

describe('fetch — 401 amarrado ao token e single-flight', () => {
  it('401 atrasado de token antigo é ignorado (não derruba a sessão nova)', async () => {
    const { navigations } = stubBrowser();
    sessionStorage.setItem('adaflow:jwt', 'tok-antigo');
    let resolve401!: (r: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn().mockReturnValue(new Promise<Response>((r) => (resolve401 = r))),
    );
    const onSessionLost = vi.fn();
    const session = makeSession({ onSessionLost });

    const p = session.fetch('/api/lenta');
    // Enquanto a request voava, o handoff salvou um token novo.
    sessionStorage.setItem('adaflow:jwt', 'tok-novo');
    resolve401(new Response(null, { status: 401 }));

    const res = await p;
    expect(res.status).toBe(401); // resposta entregue, sem efeitos colaterais
    expect(navigations).toHaveLength(0);
    expect(onSessionLost).not.toHaveBeenCalled();
    expect(session.getJwt()).toBe('tok-novo');
  });

  it('vários 401 concorrentes geram UM redirect (single-flight)', async () => {
    const { navigations } = stubBrowser();
    sessionStorage.setItem('adaflow:jwt', 'tok');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(null, { status: 401 })));
    const session = makeSession();

    const p1 = session.fetch('/api/a');
    const p2 = session.fetch('/api/b');
    await expect(isPending(p1)).resolves.toBe(true);
    await expect(isPending(p2)).resolves.toBe(true);
    expect(navigations).toHaveLength(1);
  });
});

describe('fetch — renovação proativa por exp', () => {
  it('token expirado nem vai ao gateway: renova direto', async () => {
    const { navigations } = stubBrowser();
    sessionStorage.setItem('adaflow:jwt', makeJwt({ exp: Date.now() / 1000 - 60 }));
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const session = makeSession();

    const p = session.fetch('/api/coisas');
    await expect(isPending(p)).resolves.toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(navigations).toHaveLength(1);
  });

  it('expirado + cooldown: segue sem Authorization e o app recebe o 401 real', async () => {
    const { navigations } = stubBrowser();
    sessionStorage.setItem('adaflow:jwt', makeJwt({ exp: Date.now() / 1000 - 60 }));
    sessionStorage.setItem('adaflow:jwt:renewed-at', String(Date.now() - 5_000));
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 401 }));
    vi.stubGlobal('fetch', fetchMock);
    const onSessionLost = vi.fn();
    const session = makeSession({ onSessionLost });

    const res = await session.fetch('/api/coisas');
    expect(res.status).toBe(401);
    expect(navigations).toHaveLength(0);
    expect(onSessionLost).toHaveBeenCalledOnce();
    const headers = new Headers((fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.headers);
    expect(headers.get('authorization')).toBeNull();
  });
});

describe('isAuthenticated / logout / SSR', () => {
  it('isAuthenticated reflete presença e exp do token', () => {
    stubBrowser();
    const session = makeSession();
    expect(session.isAuthenticated()).toBe(false);
    sessionStorage.setItem('adaflow:jwt', makeJwt({ exp: Date.now() / 1000 + 3600 }));
    expect(session.isAuthenticated()).toBe(true);
    sessionStorage.setItem('adaflow:jwt', makeJwt({ exp: Date.now() / 1000 - 1 }));
    expect(session.isAuthenticated()).toBe(false);
  });

  it('logout limpa o token e notifica', () => {
    stubBrowser();
    sessionStorage.setItem('adaflow:jwt', 'tok');
    const session = makeSession();
    const listener = vi.fn();
    session.subscribe(listener);
    session.logout();
    expect(session.getJwt()).toBeNull();
    expect(listener).toHaveBeenCalled();
  });

  it('fora do browser, tudo é inerte: sem sessão e sem redirect', () => {
    const session = makeSession();
    expect(session.getJwt()).toBeNull();
    expect(session.isAuthenticated()).toBe(false);
    expect(() => session.login()).not.toThrow();
    expect(session.completeLogin()).toBeNull();
    expect(session.handleUnauthorized('tok')).toBe(false);
  });
});

describe('sessão de 7 dias (authUrl + sso_code)', () => {
  const AUTH = 'https://gw.test';
  const vivo = () => makeJwt({ exp: Date.now() / 1000 + 900 });
  const vencido = () => makeJwt({ exp: Date.now() / 1000 - 10 });

  /** fetch falso que roteia por URL: auth do gateway x API do app. */
  function routeFetch(handlers: {
    exchange?: () => Response;
    token?: () => Response;
    signOut?: () => Response;
    api?: (init?: RequestInit) => Response;
  }) {
    const mock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === `${AUTH}/v1/auth/partner/handoff/exchange`) return handlers.exchange?.() ?? new Response(null, { status: 404 });
      if (url === `${AUTH}/v1/auth/token`) return handlers.token?.() ?? new Response(null, { status: 404 });
      if (url === `${AUTH}/v1/auth/sign-out`) return handlers.signOut?.() ?? new Response('{}');
      return handlers.api?.(init) ?? new Response('{}');
    });
    vi.stubGlobal('fetch', mock);
    return mock;
  }

  const authOf = (init?: RequestInit) => new Headers(init?.headers).get('authorization');

  it('completeLogin troca o sso_code pela sessão, sem cookie', async () => {
    stubBrowser('https://app.test/auth/callback#sso_token=tok-1&sso_code=cod-1');
    const fetchMock = routeFetch({ exchange: () => Response.json({ token: 'sess-7d' }) });
    const session = makeSession({ authUrl: `${AUTH}/` });

    expect(session.completeLogin()).toBe('tok-1');
    await session.fetch('/api/x');

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AUTH}/v1/auth/partner/handoff/exchange`);
    expect(init.credentials).toBe('omit');
    expect(JSON.parse(String(init.body))).toEqual({ code: 'cod-1' });
    expect(sessionStorage.getItem('adaflow:jwt:session')).toBe('sess-7d');
  });

  it('JWT vencido é renovado em /v1/auth/token, sem redirect', async () => {
    const { navigations } = stubBrowser();
    sessionStorage.setItem('adaflow:jwt', vencido());
    sessionStorage.setItem('adaflow:jwt:session', 'sess-7d');
    const novo = vivo();
    const fetchMock = routeFetch({ token: () => Response.json({ token: novo }) });
    const session = makeSession({ authUrl: AUTH });

    const res = await session.fetch('/api/x');
    expect(res.status).toBe(200);
    expect(navigations).toHaveLength(0);
    expect(session.getJwt()).toBe(novo);
    const tokenCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/v1/auth/token'));
    expect(authOf(tokenCall?.[1] as RequestInit)).toBe('Bearer sess-7d');
    expect(authOf(fetchMock.mock.calls.at(-1)?.[1] as RequestInit)).toBe(`Bearer ${novo}`);
  });

  it('várias requests vencidas juntas geram UMA renovação (single-flight)', async () => {
    stubBrowser();
    sessionStorage.setItem('adaflow:jwt', vencido());
    sessionStorage.setItem('adaflow:jwt:session', 'sess-7d');
    const fetchMock = routeFetch({ token: () => Response.json({ token: vivo() }) });
    const session = makeSession({ authUrl: AUTH });

    await Promise.all([session.fetch('/a'), session.fetch('/b'), session.fetch('/c')]);
    expect(fetchMock.mock.calls.filter(([u]) => String(u).endsWith('/v1/auth/token'))).toHaveLength(1);
  });

  it('401 da API com JWT ainda "válido": renova e reenvia uma vez', async () => {
    const { navigations } = stubBrowser();
    sessionStorage.setItem('adaflow:jwt', vivo());
    sessionStorage.setItem('adaflow:jwt:session', 'sess-7d');
    const novo = vivo().replace('assinatura', 'nova');
    let apiCalls = 0;
    routeFetch({
      token: () => Response.json({ token: novo }),
      api: () => new Response(null, { status: ++apiCalls === 1 ? 401 : 200 }),
    });
    const session = makeSession({ authUrl: AUTH });

    const res = await session.fetch('/api/x', { method: 'POST', body: '{}' });
    expect(res.status).toBe(200);
    expect(apiCalls).toBe(2);
    expect(navigations).toHaveLength(0);
  });

  it('sessão de 7 dias recusada (401): descarta e cai no handoff de sempre', async () => {
    const { navigations } = stubBrowser();
    sessionStorage.setItem('adaflow:jwt', vencido());
    sessionStorage.setItem('adaflow:jwt:session', 'sess-vencida');
    routeFetch({ token: () => new Response(null, { status: 401 }) });
    const session = makeSession({ authUrl: AUTH });

    const p = session.fetch('/api/x');
    await expect(isPending(p)).resolves.toBe(true);
    expect(navigations[0]).toContain('/sso/handoff');
    expect(sessionStorage.getItem('adaflow:jwt:session')).toBeNull();
  });

  it('erro de rede na renovação não derruba a sessão de 7 dias', async () => {
    stubBrowser();
    sessionStorage.setItem('adaflow:jwt', vencido());
    sessionStorage.setItem('adaflow:jwt:session', 'sess-7d');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('rede')));
    const session = makeSession({ authUrl: AUTH });

    await expect(session.refresh()).resolves.toBeNull();
    expect(sessionStorage.getItem('adaflow:jwt:session')).toBe('sess-7d');
  });

  it('sem sso_code (Adaflow antigo) ou sem authUrl: comportamento da 0.6', async () => {
    stubBrowser('https://app.test/auth/callback#sso_token=tok-1');
    const fetchMock = routeFetch({});
    const session = makeSession({ authUrl: AUTH });
    session.completeLogin();
    await session.fetch('/api/x');
    expect(fetchMock.mock.calls.some(([u]) => String(u).includes('/v1/auth/'))).toBe(false);

    stubBrowser('https://app.test/auth/callback#sso_token=tok-2&sso_code=c');
    const fetch2 = routeFetch({});
    makeSession().completeLogin();
    expect(fetch2).not.toHaveBeenCalled();
    await expect(makeSession().refresh()).resolves.toBeNull();
  });

  it('login novo descarta a sessão de 7 dias anterior', () => {
    stubBrowser('https://app.test/auth/callback#sso_token=tok-novo');
    sessionStorage.setItem('adaflow:jwt:session', 'sess-de-outro-usuario');
    makeSession({ authUrl: AUTH }).completeLogin();
    expect(sessionStorage.getItem('adaflow:jwt:session')).toBeNull();
  });

  it('logout encerra a sessão de 7 dias no servidor (melhor esforço)', () => {
    stubBrowser();
    sessionStorage.setItem('adaflow:jwt', vivo());
    sessionStorage.setItem('adaflow:jwt:session', 'sess-7d');
    const fetchMock = routeFetch({});
    makeSession({ authUrl: AUTH }).logout();

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(`${AUTH}/v1/auth/sign-out`);
    expect(authOf(init)).toBe('Bearer sess-7d');
    expect(sessionStorage.getItem('adaflow:jwt:session')).toBeNull();
    expect(sessionStorage.getItem('adaflow:jwt')).toBeNull();
  });

  it('isAuthenticated: JWT vencido com sessão de 7 dias ainda conta', () => {
    stubBrowser();
    sessionStorage.setItem('adaflow:jwt', vencido());
    expect(makeSession({ authUrl: AUTH }).isAuthenticated()).toBe(false);
    sessionStorage.setItem('adaflow:jwt:session', 'sess-7d');
    expect(makeSession({ authUrl: AUTH }).isAuthenticated()).toBe(true);
  });
});
