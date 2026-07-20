import { errorFromResponse } from './errors.js';

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
  /** Base URL do API Gateway. Default: produção. */
  baseUrl?: string;
  /** Implementação de fetch (para testes ou ambientes sem fetch global). */
  fetch?: typeof fetch;
}

export const DEFAULT_BASE_URL = 'https://adalink-api-gateway.onrender.com';

async function resolveToken(provider: TokenProvider): Promise<string> {
  return typeof provider === 'function' ? provider() : provider;
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  query?: Record<string, string | number | undefined>;
  headers?: Record<string, string>;
  /** Aceita text/event-stream e retorna a Response sem consumir o body. */
  stream?: boolean;
  /** Request sobrevive ao unload da página (flush final do tracker no browser). */
  keepalive?: boolean;
}

/** Transporte HTTP interno do SDK — resolve credencial, monta URL e trata erros. */
export class HttpTransport {
  private readonly options: AdaflowClientOptions;
  readonly baseUrl: string;

  constructor(options: AdaflowClientOptions) {
    if (!options.jwt && !options.appToken) {
      throw new Error(
        'Informe uma credencial: jwt (usuário logado, preferido) ou appToken (server-to-server).',
      );
    }
    this.options = options;
    this.baseUrl = (options.baseUrl ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  }

  private get fetchImpl(): typeof fetch {
    return this.options.fetch ?? fetch;
  }

  /** Header de auth: JWT preferido; app token via x-ada-token como fallback. */
  async authHeaders(): Promise<Record<string, string>> {
    if (this.options.jwt) {
      return { authorization: `Bearer ${await resolveToken(this.options.jwt)}` };
    }
    return { 'x-ada-token': await resolveToken(this.options.appToken as TokenProvider) };
  }

  async request(path: string, opts: RequestOptions = {}): Promise<Response> {
    const url = new URL(this.baseUrl + path);
    for (const [key, value] of Object.entries(opts.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const headers: Record<string, string> = {
      ...(await this.authHeaders()),
      ...(opts.body !== undefined ? { 'content-type': 'application/json' } : {}),
      ...(opts.stream ? { accept: 'text/event-stream' } : {}),
      ...opts.headers,
    };

    const res = await this.fetchImpl(url.toString(), {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      ...(opts.keepalive ? { keepalive: true } : {}),
    });

    if (!res.ok) {
      throw await errorFromResponse(res);
    }
    return res;
  }

  async requestJson<T>(path: string, opts: RequestOptions = {}): Promise<T> {
    const res = await this.request(path, opts);
    return (await res.json()) as T;
  }
}
