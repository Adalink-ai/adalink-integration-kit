/**
 * Sessão SSO gerenciada (lado browser do app integrado).
 *
 * `buildHandoffUrl`/`consumeSsoToken` cobrem as PONTAS do fluxo; o miolo —
 * guardar o token, anexar nas chamadas, renovar em 401 e NÃO entrar em loop
 * de redirect — era reimplementado à mão em cada app, e é fácil errar. Este
 * helper encapsula a máquina de estados inteira, com três defesas aprendidas
 * em produção (o loop "indo e voltando toda hora" do Adara):
 *
 * 1. **Guarda temporal (cooldown)** — no máximo UM handoff automático por
 *    janela de tempo. Uma guarda liberada por "alguma chamada deu 200" é
 *    rearmável: dashboards fazem dezenas de chamadas em paralelo e respostas
 *    200/401 chegam misturadas (cache de validação por instância no servidor
 *    do app, instabilidade do gateway) — cada 200 liberaria a guarda e o 401
 *    seguinte dispararia outro redirect, infinitamente. Nenhuma resposta
 *    individual consegue rearmar uma guarda por tempo.
 *
 * 2. **401 amarrado ao token** — só reage ao 401 se o token DAQUELA request
 *    ainda for o corrente. Requests em voo com o token antigo respondem 401
 *    atrasado depois de o handoff já ter salvo um token novo; reagir a elas
 *    derrubaria a sessão recém-renovada e realimentaria o ciclo.
 *
 * 3. **Single-flight** — iniciado um redirect de renovação, os demais 401 do
 *    mesmo documento são ignorados: a página já está indo embora.
 *
 * O `exp` do JWT é lido SEM validar assinatura — aqui ele decide apenas "vale
 * a pena mandar esta request ou renovar antes"; quem autoriza de verdade é
 * sempre o gateway. Ver seção 1 do guia de apps integrados.
 *
 * **Renovação sem redirect (0.7).** O JWT vale 15 minutos. Com `authUrl`, o
 * `completeLogin()` troca o `#sso_code` do handoff por uma sessão de 7 dias
 * (`POST /v1/auth/partner/handoff/exchange`) e, daí em diante, o JWT vencido
 * é renovado em `GET /v1/auth/token` sem sair da página. O redirect ao
 * handoff (com as três defesas) só acontece quando essa renovação é recusada
 * — sessão de 7 dias vencida ou encerrada — ou quando não há `authUrl`/código.
 */

import { buildHandoffUrl, consumeSsoFragment } from './sso.js';

export interface SsoSessionOptions {
  /** Base URL do Adaflow (Identity Provider), ex.: `https://adaflow.adalink.ai`. */
  adaflowUrl: string;
  /**
   * URL da página que chama `completeLogin()` — caminho relativo à origin do
   * app ou URL absoluta. Default: `/auth/callback`.
   */
  callbackUrl?: string;
  /** Chave do `sessionStorage` onde o JWT vive. Default: `adaflow:jwt`. */
  storageKey?: string;
  /**
   * Base onde ficam as rotas `/v1/auth/*`: o gateway do Adaflow ou um proxy
   * do próprio app que as repasse. Com ela, a sessão troca o `#sso_code` por
   * uma sessão de 7 dias e renova o JWT sem redirect. Sem ela, o
   * comportamento é o da 0.6 (refaz o handoff a cada expiração).
   */
  authUrl?: string;
  /**
   * Janela em que um SEGUNDO handoff automático é recusado (ms). Default:
   * 60 000. Renovação legítima por expiração acontece em escala de horas;
   * dois 401 "verdadeiros" no mesmo minuto significam o gateway rejeitando o
   * token — aí a saída é `onSessionLost`, não outro redirect.
   */
  retryCooldownMs?: number;
  /**
   * Antecedência com que um token prestes a expirar já é tratado como
   * expirado (ms). Default: 30 000. Evita mandar ao gateway uma request
   * condenada — e, pior, uma que instâncias do servidor do app com validação
   * em cache ainda "aceitariam", gerando o padrão misto 200/401.
   */
  expiryLeewayMs?: number;
  /**
   * Chamado quando a renovação automática foi recusada (cooldown) e a sessão
   * foi limpa — mostre a tela de login. NÃO redirecione daqui para o handoff:
   * isso recriaria o loop que a guarda existe para impedir.
   */
  onSessionLost?: () => void;
}

export interface SsoSession {
  /** JWT corrente, ou `null` (sempre `null` fora do browser). */
  getJwt(): string | null;
  /** Há token e ele não está expirado (não prova que o gateway o aceita). */
  isAuthenticated(): boolean;
  /**
   * Redireciona ao handoff — login iniciado PELO USUÁRIO (botão "Entrar").
   * Não passa pela guarda de cooldown: gesto explícito nunca é loop.
   */
  login(): void;
  /**
   * Na página de callback: consome o `#sso_token`, salva e limpa a URL.
   * Retorna o token, ou `null` se o fragment não o traz. NÃO libera a guarda
   * de retry — token novo que ainda toma 401 precisa encontrá-la armada.
   */
  completeLogin(): string | null;
  /**
   * Descarta os tokens locais e encerra a sessão de 7 dias do app (melhor
   * esforço). A sessão do usuário no Adaflow continua viva.
   */
  logout(): void;
  /**
   * Renova o JWT pela sessão de 7 dias, sem redirect. Devolve o JWT novo ou
   * `null` (sem `authUrl`, sem sessão, ou sessão recusada). Útil para quem
   * usa interceptor próprio em vez de `session.fetch`.
   */
  refresh(): Promise<string | null>;
  /**
   * `fetch` com a sessão embutida: anexa `Authorization`, renova
   * proativamente token expirado e trata 401 com as três defesas acima.
   * Quando um redirect de renovação começa, a promise fica pendente para
   * sempre — o documento está morrendo, resolver com um 401 sintético só
   * pintaria erro na UI um instante antes da navegação.
   */
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
  /**
   * Tratamento de 401 para quem NÃO usa `session.fetch` (ex.: interceptor
   * próprio). Passe o token com que a request foi enviada. Retorna `true` se
   * um redirect de renovação está em curso (pare de processar a resposta) e
   * `false` se a resposta deve seguir para o app (tela de login).
   */
  handleUnauthorized(jwtUsed: string | null): boolean;
  /**
   * Assina mudanças de sessão (login/logout no MESMO documento — o evento
   * `storage` do browser só dispara em outras abas). Compatível com
   * `useSyncExternalStore(subscribe, getJwt, () => null)`.
   */
  subscribe(listener: () => void): () => void;
}

const DEFAULT_STORAGE_KEY = 'adaflow:jwt';
const DEFAULT_RETRY_COOLDOWN_MS = 60_000;
const DEFAULT_EXPIRY_LEEWAY_MS = 30_000;
const EXCHANGE_PATH = '/v1/auth/partner/handoff/exchange';
const TOKEN_PATH = '/v1/auth/token';
const SIGN_OUT_PATH = '/v1/auth/sign-out';

/**
 * Lê o `exp` do payload do JWT em milissegundos de epoch, ou `null` se o
 * token não é um JWT legível ou não traz `exp` numérico. NÃO valida
 * assinatura — uso exclusivo para decidir renovação proativa.
 */
export function readJwtExpMs(jwt: string): number | null {
  const segment = jwt.split('.')[1];
  if (!segment) return null;
  try {
    const b64 = segment.replace(/-/g, '+').replace(/_/g, '/');
    const padded = b64 + '='.repeat((4 - (b64.length % 4)) % 4);
    let json: string;
    if (typeof atob === 'function') {
      const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
      json = new TextDecoder().decode(bytes);
    } else {
      json = Buffer.from(padded, 'base64').toString('utf8');
    }
    const exp = (JSON.parse(json) as { exp?: unknown }).exp;
    return typeof exp === 'number' && Number.isFinite(exp) ? exp * 1000 : null;
  } catch {
    return null;
  }
}

type RenewAttempt = 'started' | 'in-flight' | 'refused';

/** Cria a sessão SSO gerenciada. Uma instância por documento é o esperado. */
export function createSsoSession(options: SsoSessionOptions): SsoSession {
  const storageKey = options.storageKey ?? DEFAULT_STORAGE_KEY;
  // Timestamp do último handoff AUTOMÁTICO. O valor fica no sessionStorage
  // (não em memória) porque o redirect destrói o documento — a guarda precisa
  // sobreviver à ida e volta do handoff.
  const retryKey = `${storageKey}:renewed-at`;
  // Token da sessão de 7 dias (`sso-app`). Vive no sessionStorage como o JWT:
  // some ao fechar a aba e não é enviado a lugar nenhum além de `authUrl`.
  const sessionKey = `${storageKey}:session`;
  const authBase = options.authUrl ? options.authUrl.replace(/\/$/, '') : null;
  const cooldownMs = options.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS;
  const leewayMs = options.expiryLeewayMs ?? DEFAULT_EXPIRY_LEEWAY_MS;

  const listeners = new Set<() => void>();
  // Single-flight deste documento: depois que um redirect de renovação
  // começou, nada mais tenta outro.
  let redirecting = false;
  // Single-flight da troca do código e da renovação do JWT: dezenas de
  // requests vencendo juntas geram UMA chamada a `/v1/auth/token`.
  let exchangeInFlight: Promise<void> | null = null;
  let refreshInFlight: Promise<string | null> | null = null;

  const isBrowser = (): boolean => typeof window !== 'undefined';
  const notify = (): void => {
    listeners.forEach((l) => l());
  };

  // sessionStorage pode lançar (modo privado antigo, iframe com storage
  // bloqueado) — nunca deixar isso derrubar o app.
  const storageGet = (key: string): string | null => {
    try {
      return sessionStorage.getItem(key);
    } catch {
      return null;
    }
  };
  const storageSet = (key: string, value: string): boolean => {
    try {
      sessionStorage.setItem(key, value);
      return true;
    } catch {
      return false;
    }
  };
  const storageRemove = (key: string): void => {
    try {
      sessionStorage.removeItem(key);
    } catch {
      /* já não está lá para efeitos práticos */
    }
  };

  const getJwt = (): string | null => (isBrowser() ? storageGet(storageKey) : null);

  const clearJwt = (): void => {
    storageRemove(storageKey);
    notify();
  };

  const redirectToHandoff = (): void => {
    redirecting = true;
    const callback = new URL(options.callbackUrl ?? '/auth/callback', window.location.origin);
    window.location.href = buildHandoffUrl(options.adaflowUrl, callback.toString());
  };

  const tryAutoRenew = (): RenewAttempt => {
    if (!isBrowser()) return 'refused';
    if (redirecting) return 'in-flight';
    const last = Number(storageGet(retryKey) ?? 0);
    if (Date.now() - last < cooldownMs) return 'refused';
    // Sem storage não há onde armar a guarda — renovar às cegas arriscaria o
    // loop; melhor cair na tela de login.
    if (!storageSet(retryKey, String(Date.now()))) return 'refused';
    clearJwt();
    redirectToHandoff();
    return 'started';
  };

  const saveJwt = (jwt: string): void => {
    storageSet(storageKey, jwt);
    notify();
  };

  /** Troca o `#sso_code` pela sessão de 7 dias. Falha = segue só com o JWT. */
  const exchangeCode = async (code: string): Promise<void> => {
    if (!authBase) return;
    try {
      const res = await fetch(`${authBase}${EXCHANGE_PATH}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ code }),
        credentials: 'omit',
      });
      if (!res.ok) return;
      const body = (await res.json()) as { token?: unknown };
      if (typeof body.token === 'string' && body.token.length > 0) {
        storageSet(sessionKey, body.token);
      }
    } catch {
      /* rede: o app segue com o JWT de 15 min e o handoff de sempre */
    }
  };

  const refreshJwt = (): Promise<string | null> => {
    if (!isBrowser() || !authBase) return Promise.resolve(null);
    if (refreshInFlight) return refreshInFlight;
    const sessionToken = storageGet(sessionKey);
    if (!sessionToken) return Promise.resolve(null);

    refreshInFlight = (async () => {
      try {
        const res = await fetch(`${authBase}${TOKEN_PATH}`, {
          headers: { authorization: `Bearer ${sessionToken}` },
          credentials: 'omit',
        });
        // Sessão de 7 dias vencida ou encerrada: descarta e deixa o handoff
        // (com as defesas de loop) assumir.
        if (res.status === 401 || res.status === 403) {
          storageRemove(sessionKey);
          return null;
        }
        if (!res.ok) return null;
        const body = (await res.json()) as { token?: unknown };
        if (typeof body.token !== 'string' || body.token.length === 0) return null;
        saveJwt(body.token);
        return body.token;
      } catch {
        return null;
      } finally {
        refreshInFlight = null;
      }
    })();
    return refreshInFlight;
  };

  const sessionLost = (): void => {
    storageRemove(sessionKey);
    clearJwt();
    options.onSessionLost?.();
  };

  const handleUnauthorized = (jwtUsed: string | null): boolean => {
    // 401 de request que saiu SEM token não é sessão morta (a tela de login
    // já está no ar); 401 de token que não é mais o corrente é eco atrasado
    // de um ciclo anterior. Nos dois casos, só interessa se um redirect já
    // está em curso.
    if (!jwtUsed || getJwt() !== jwtUsed) return redirecting;
    if (tryAutoRenew() === 'refused') {
      sessionLost();
      return false;
    }
    return true;
  };

  // Documento navegando para o handoff: a promise fica pendente de propósito.
  const pendingForever = (): Promise<Response> => new Promise<Response>(() => {});

  // Request com corpo em stream não pode ser reenviada depois do 401.
  const canReplay = (input: RequestInfo | URL, init?: RequestInit): boolean =>
    !(typeof Request !== 'undefined' && input instanceof Request) &&
    !(typeof ReadableStream !== 'undefined' && init?.body instanceof ReadableStream);

  const withJwt = (
    input: RequestInfo | URL,
    init: RequestInit | undefined,
    jwt: string | null,
  ): RequestInit | undefined => {
    if (!jwt) return init;
    const headers = new Headers(
      init?.headers ?? (input instanceof Request ? input.headers : undefined),
    );
    // Um Authorization explícito do call site tem prioridade.
    if (!headers.has('authorization')) headers.set('authorization', `Bearer ${jwt}`);
    return { ...init, headers };
  };

  const sessionFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (!isBrowser()) return fetch(input, init);

    // Logo após o callback, a troca do código ainda pode estar em voo.
    if (exchangeInFlight) await exchangeInFlight;

    let jwt = getJwt();

    // Renovação proativa: token comprovadamente expirado não vai ao gateway.
    if (jwt) {
      const expMs = readJwtExpMs(jwt);
      if (expMs !== null && Date.now() >= expMs - leewayMs) {
        const renewed = await refreshJwt();
        if (renewed) {
          jwt = renewed;
        } else {
          if (tryAutoRenew() !== 'refused') return pendingForever();
          sessionLost();
          jwt = null; // segue sem Authorization; o chamador recebe o 401 real
        }
      }
    }

    const res = await fetch(input, withJwt(input, init, jwt));
    if (res.status !== 401) return res;

    // 401 com a sessão de 7 dias: tenta o JWT corrente (outra request já pode
    // ter renovado) ou renova agora, e reenvia UMA vez.
    if (jwt && authBase && canReplay(input, init)) {
      const current = getJwt();
      const renewed = current && current !== jwt ? current : current === jwt ? await refreshJwt() : null;
      if (renewed && renewed !== jwt) {
        const retry = await fetch(input, withJwt(input, init, renewed));
        if (retry.status === 401 && handleUnauthorized(renewed)) return pendingForever();
        return retry;
      }
    }

    if (handleUnauthorized(jwt)) return pendingForever();
    return res;
  };

  return {
    getJwt,
    isAuthenticated(): boolean {
      const jwt = getJwt();
      if (!jwt) return false;
      // JWT vencido com sessão de 7 dias ainda é sessão: o próximo fetch renova.
      if (storageGet(sessionKey)) return true;
      const expMs = readJwtExpMs(jwt);
      return expMs === null || Date.now() < expMs;
    },
    login(): void {
      if (!isBrowser()) return;
      redirectToHandoff();
    },
    completeLogin(): string | null {
      if (!isBrowser()) return null;
      const fragment = consumeSsoFragment();
      if (!fragment) return null;
      // Login novo: a sessão de 7 dias anterior pode ser de outro usuário.
      storageRemove(sessionKey);
      saveJwt(fragment.token);
      if (fragment.code && authBase) {
        exchangeInFlight = exchangeCode(fragment.code).finally(() => {
          exchangeInFlight = null;
        });
      }
      return fragment.token;
    },
    logout(): void {
      if (!isBrowser()) return;
      const sessionToken = storageGet(sessionKey);
      storageRemove(sessionKey);
      clearJwt();
      if (sessionToken && authBase) {
        // Melhor esforço: a sessão de 7 dias também vence sozinha.
        fetch(`${authBase}${SIGN_OUT_PATH}`, {
          method: 'POST',
          headers: { authorization: `Bearer ${sessionToken}`, 'content-type': 'application/json' },
          body: '{}',
          credentials: 'omit',
        }).catch(() => undefined);
      }
    },
    refresh: refreshJwt,
    fetch: sessionFetch,
    handleUnauthorized,
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
