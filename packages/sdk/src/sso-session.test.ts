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
