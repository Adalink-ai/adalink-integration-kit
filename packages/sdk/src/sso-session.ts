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
 */

import { buildHandoffUrl, consumeSsoToken } from './sso.js';

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
  /** Descarta o token local. A sessão no Adaflow continua viva. */
  logout(): void;
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
  const cooldownMs = options.retryCooldownMs ?? DEFAULT_RETRY_COOLDOWN_MS;
  const leewayMs = options.expiryLeewayMs ?? DEFAULT_EXPIRY_LEEWAY_MS;

  const listeners = new Set<() => void>();
  // Single-flight deste documento: depois que um redirect de renovação
  // começou, nada mais tenta outro.
  let redirecting = false;

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

  const sessionLost = (): void => {
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

  const sessionFetch = async (
    input: RequestInfo | URL,
    init?: RequestInit,
  ): Promise<Response> => {
    if (!isBrowser()) return fetch(input, init);

    let jwt = getJwt();

    // Renovação proativa: token comprovadamente expirado não vai ao gateway.
    if (jwt) {
      const expMs = readJwtExpMs(jwt);
      if (expMs !== null && Date.now() >= expMs - leewayMs) {
        if (tryAutoRenew() !== 'refused') return pendingForever();
        sessionLost();
        jwt = null; // segue sem Authorization; o chamador recebe o 401 real
      }
    }

    let next = init;
    if (jwt) {
      const headers = new Headers(
        init?.headers ?? (input instanceof Request ? input.headers : undefined),
      );
      // Um Authorization explícito do call site tem prioridade.
      if (!headers.has('authorization')) headers.set('authorization', `Bearer ${jwt}`);
      next = { ...init, headers };
    }

    const res = await fetch(input, next);
    if (res.status === 401 && handleUnauthorized(jwt)) return pendingForever();
    return res;
  };

  return {
    getJwt,
    isAuthenticated(): boolean {
      const jwt = getJwt();
      if (!jwt) return false;
      const expMs = readJwtExpMs(jwt);
      return expMs === null || Date.now() < expMs;
    },
    login(): void {
      if (!isBrowser()) return;
      redirectToHandoff();
    },
    completeLogin(): string | null {
      if (!isBrowser()) return null;
      const token = consumeSsoToken();
      if (token) {
        storageSet(storageKey, token);
        notify();
      }
      return token;
    },
    logout(): void {
      if (!isBrowser()) return;
      clearJwt();
    },
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
