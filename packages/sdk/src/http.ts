import { errorFromResponse } from './errors.js';
import { computeBackoffMs } from './tracker-core.js';

/** Fornecedor de token: valor fixo ou função (sincrona/assíncrona) para renovação. */
export type TokenProvider = string | (() => string | Promise<string>);

export interface AdaflowClientOptions {
  /**
   * JWT do usuário logado (obtido via SSO handoff). PREFERIDO sempre que há
   * usuário no fluxo — a ação fica auditada no usuário real. Aceita função
   * para renovação (chamada a cada request).
   */
  jwt?: TokenProvider;
  /**
   * App token do Adaflow (server-to-server). Enviado como `x-ada-token`.
   * Ignorado quando `jwt` também é informado — a plataforma prioriza o
   * x-ada-token quando ambos os headers chegam, então o SDK envia só um.
   */
  appToken?: TokenProvider;
  /**
   * Base URL do API Gateway. Resolução: valor explícito → env
   * `ADAFLOW_BASE_URL` → default de produção. Clientes private label com API
   * customizada só precisam setar a env — sem mudança de código.
   */
  baseUrl?: string;
  /**
   * Implementação de fetch (para testes ou ambientes sem fetch global). Também
   * é a usada no upload para URLs pré-assinadas, fora do gateway.
   */
  fetch?: typeof fetch;
  /**
   * `fetch` que JÁ autentica as chamadas ao gateway (ex.: o `auth.fetch` de
   * uma sessão por cookie, que injeta o Bearer e renova em 401). Com ele o SDK
   * não envia credencial própria, então não combine com `jwt` nem `appToken`.
   * Só é usado nas chamadas ao gateway: uploads para URLs pré-assinadas seguem
   * no `fetch` comum, para o Bearer não vazar para o storage.
   */
  authFetch?: typeof fetch;
  /**
   * Identifica o produto que chama (header `x-ada-client`, ex.: `ada-one`). O
   * gateway atribui o uso a esse cliente; valor fora da allowlist vira `unknown`.
   */
  client?: string;
  /**
   * Tempo máximo, em ms, até a resposta chegar. Sem default: chamadas longas
   * (execução de agente, chat não-stream) não são cortadas sem pedido. Em
   * stream, o prazo vale só até os headers; o corpo segue enquanto durar.
   */
  timeoutMs?: number;
  /**
   * Retry de GET em erro de rede e 502/503/504, com backoff exponencial e
   * jitter. `false` desliga. Nunca repete 401 (quem renova é a credencial) nem
   * métodos não idempotentes.
   */
  retry?: RetryOptions | false;
}

export interface RetryOptions {
  /** Tentativas extras além da primeira. Default: 2. */
  retries?: number;
  /** Base do backoff em ms. Default: 300. */
  baseMs?: number;
}

/** Opções por chamada, aceitas pelos métodos dos recursos. */
export interface CallOptions {
  /** Cancela a chamada (ex.: o `signal` do TanStack Query). */
  signal?: AbortSignal;
  /** Sobrepõe o `timeoutMs` do client nesta chamada. */
  timeoutMs?: number;
}

export const DEFAULT_BASE_URL = 'https://adalink-api-gateway.onrender.com';

/** Leitura segura de env — em browser/bundlers `process` pode não existir. */
function envVar(name: string): string | undefined {
  const proc = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process;
  const value = proc?.env?.[name];
  return value && value.trim().length > 0 ? value : undefined;
}

/**
 * Base URL efetiva: explícita → env ADAFLOW_BASE_URL → default de produção.
 * `''` ou um caminho (`/api`) valem para chamadas na mesma origem, no browser.
 */
export function resolveBaseUrl(explicit?: string): string {
  return (explicit ?? envVar('ADAFLOW_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/$/, '');
}

/** App token do ambiente: ADAFLOW_APP_TOKEN (canônica) ou ADA_TOKEN (alias). */
export function resolveEnvAppToken(): string | undefined {
  return envVar('ADAFLOW_APP_TOKEN') ?? envVar('ADA_TOKEN');
}

async function resolveToken(provider: TokenProvider): Promise<string> {
  return typeof provider === 'function' ? provider() : provider;
}

export interface RequestOptions extends CallOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  /** Aceita text/event-stream e retorna a Response sem consumir o body. */
  stream?: boolean;
  /** Request sobrevive ao unload da página (flush final do tracker no browser). */
  keepalive?: boolean;
}

const RETRYABLE_STATUS = new Set([502, 503, 504]);
const DEFAULT_RETRIES = 2;
const DEFAULT_RETRY_BASE_MS = 300;
const RETRY_CAP_MS = 5_000;

/** Monta a URL; aceita base relativa (mesma origem) além da absoluta. */
export function buildUrl(
  baseUrl: string,
  path: string,
  query?: Record<string, string | number | undefined>,
): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query ?? {})) {
    if (value !== undefined) params.set(key, String(value));
  }
  const search = params.toString();
  return `${baseUrl}${path}${search ? `?${search}` : ''}`;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason);
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason);
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

function retryAfterSec(res: Response): number | undefined {
  const raw = Number(res.headers.get('retry-after'));
  return Number.isFinite(raw) && raw > 0 ? raw : undefined;
}

/** Transporte HTTP interno do SDK — resolve credencial, monta URL e trata erros. */
export class HttpTransport {
  private readonly options: AdaflowClientOptions;
  readonly baseUrl: string;

  constructor(options: AdaflowClientOptions = {}) {
    if (options.authFetch) {
      if (options.jwt || options.appToken) {
        throw new Error(
          'authFetch já autentica as chamadas: não combine com jwt nem appToken ' +
            '(o Bearer seria enviado duas vezes e o 401 teria dois donos).',
        );
      }
      this.options = { ...options };
    } else {
      const appToken = options.appToken ?? resolveEnvAppToken();
      if (!options.jwt && !appToken) {
        throw new Error(
          'Informe uma credencial: jwt (usuário logado, preferido), appToken (server-to-server) ' +
            'ou authFetch (fetch já autenticado) — ou defina ADAFLOW_APP_TOKEN no ambiente.',
        );
      }
      this.options = { ...options, appToken };
    }
    this.baseUrl = resolveBaseUrl(options.baseUrl);
  }

  private get fetchImpl(): typeof fetch {
    // bind(globalThis): o fetch do browser exige `this === window` — invocado
    // como método do transport lançaria "TypeError: Illegal invocation".
    return (this.options.authFetch ?? this.options.fetch ?? fetch).bind(globalThis);
  }

  /**
   * Header de auth: JWT preferido; app token via x-ada-token como fallback.
   * Vazio com `authFetch`, que injeta a credencial por conta própria.
   */
  async authHeaders(): Promise<Record<string, string>> {
    if (this.options.authFetch) return {};
    if (this.options.jwt) {
      return { authorization: `Bearer ${await resolveToken(this.options.jwt)}` };
    }
    return { 'x-ada-token': await resolveToken(this.options.appToken as TokenProvider) };
  }

  async request(path: string, opts: RequestOptions = {}): Promise<Response> {
    const method = (opts.method ?? 'GET').toUpperCase();
    const retry = this.options.retry;
    const retries = method === 'GET' && retry !== false ? (retry?.retries ?? DEFAULT_RETRIES) : 0;
    const baseMs = (retry || undefined)?.baseMs ?? DEFAULT_RETRY_BASE_MS;

    for (let attempt = 0; ; attempt++) {
      let res: Response;
      try {
        res = await this.send(path, method, opts);
      } catch (err) {
        // Abort do chamador ou timeout não se repete; só falha de rede.
        if (attempt < retries && !opts.signal?.aborted && err instanceof TypeError) {
          await sleep(computeBackoffMs(attempt, undefined, { baseMs, capMs: RETRY_CAP_MS }), opts.signal);
          continue;
        }
        throw err;
      }

      if (res.ok) return res;
      if (attempt < retries && RETRYABLE_STATUS.has(res.status)) {
        await res.body?.cancel().catch(() => undefined);
        await sleep(
          computeBackoffMs(attempt, retryAfterSec(res), { baseMs, capMs: RETRY_CAP_MS }),
          opts.signal,
        );
        continue;
      }
      throw await errorFromResponse(res);
    }
  }

  /** Uma tentativa: monta a request, aplica signal e timeout até os headers. */
  private async send(path: string, method: string, opts: RequestOptions): Promise<Response> {
    const headers: Record<string, string> = {
      ...(await this.authHeaders()),
      ...(this.options.client ? { 'x-ada-client': this.options.client } : {}),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.stream ? { accept: 'text/event-stream' } : {}),
      ...opts.headers,
    };

    const timeoutMs = opts.timeoutMs ?? this.options.timeoutMs;
    const controller = new AbortController();
    const onAbort = () => controller.abort(opts.signal?.reason);
    if (opts.signal?.aborted) onAbort();
    else opts.signal?.addEventListener('abort', onAbort, { once: true });
    const timer =
      timeoutMs !== undefined && timeoutMs > 0
        ? setTimeout(
            () => controller.abort(new DOMException(`Sem resposta em ${timeoutMs} ms`, 'TimeoutError')),
            timeoutMs,
          )
        : undefined;

    try {
      if (controller.signal.aborted) throw controller.signal.reason;
      return await this.fetchImpl(buildUrl(this.baseUrl, path, opts.query), {
        method,
        headers,
        body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
        signal: controller.signal,
        ...(opts.keepalive ? { keepalive: true } : {}),
      });
    } finally {
      // O prazo cobre só a chegada da resposta; o signal do chamador continua
      // valendo para o corpo (stream) pelo controller encadeado.
      if (timer !== undefined) clearTimeout(timer);
    }
  }

  async requestJson<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.request(path, opts);
    return (await res.json()) as T;
  }
}
