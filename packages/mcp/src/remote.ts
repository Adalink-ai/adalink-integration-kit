/**
 * Servidor MCP remoto do Adaflow (Streamable HTTP, sem sessão).
 *
 * Um único endpoint atende qualquer organização: a credencial chega em cada
 * requisição e vira um `AdaflowClient` só daquela requisição. Nada é guardado
 * entre chamadas, então dá para rodar em função serverless (Vercel).
 *
 * Credencial, uma por requisição:
 *   - `x-ada-token: ada_...`               token de app (servidor a servidor)
 *   - `Authorization: Bearer ada_...`      token de app, para clientes MCP que só
 *                                          oferecem o campo Bearer
 *   - `Authorization: Bearer <jwt>`        JWT do usuário logado (preferido: ações
 *                                          ficam auditadas no usuário real)
 *
 * Mandar `x-ada-token` junto com um JWT no Bearer é ambíguo e responde 400,
 * em vez de escolher uma das duas em silêncio.
 *
 * O gateway da Adaflow vem da configuração do servidor (`baseUrl`), nunca da
 * requisição: aceitar o destino do cliente faria o servidor enviar tokens para
 * qualquer host.
 */
import { AdaflowClient } from '@adaflow/sdk';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import { createAdaflowMcpServer } from './server.js';

/** Prefixo de todo token de app emitido pelo gateway (`generateSecureToken('ada_', 32)`). */
export const APP_TOKEN_PREFIX = 'ada_';

export type RemoteCredentials = { jwt: string } | { appToken: string };

export type CredentialsResult =
  | { ok: true; credentials: RemoteCredentials }
  | { ok: false; status: 400 | 401; message: string };

function bearer(headers: Headers): string | undefined {
  const raw = headers.get('authorization')?.trim();
  if (!raw) return undefined;
  const match = /^Bearer\s+(.+)$/i.exec(raw);
  return match?.[1]?.trim() || undefined;
}

/** Extrai a credencial dos headers, sem validar no gateway (quem valida é a API). */
export function credentialsFromHeaders(headers: Headers): CredentialsResult {
  const adaToken = headers.get('x-ada-token')?.trim() || undefined;
  const bearerToken = bearer(headers);

  if (adaToken && bearerToken && bearerToken !== adaToken) {
    return {
      ok: false,
      status: 400,
      message: 'Envie só uma credencial: x-ada-token (token de app) ou Authorization: Bearer (JWT ou token de app).',
    };
  }
  if (adaToken) return { ok: true, credentials: { appToken: adaToken } };
  if (bearerToken) {
    return {
      ok: true,
      credentials: bearerToken.startsWith(APP_TOKEN_PREFIX) ? { appToken: bearerToken } : { jwt: bearerToken },
    };
  }
  return {
    ok: false,
    status: 401,
    message:
      'Credencial ausente. Envie o token de app da Adaflow em x-ada-token (ou Authorization: Bearer ada_...) ' +
      'ou o JWT do usuário em Authorization: Bearer.',
  };
}

export interface RemoteLogger {
  info(event: Record<string, unknown>): void;
  error(event: Record<string, unknown>): void;
}

const consoleLogger: RemoteLogger = {
  info: (event) => console.log(JSON.stringify(event)),
  error: (event) => console.error(JSON.stringify(event)),
};

export interface RemoteMcpHandlerOptions {
  /** Gateway da Adaflow. Vazio = `ADAFLOW_BASE_URL` do ambiente ou produção (regra do SDK). */
  baseUrl?: string;
  /** `fetch` usado para chamar a API (testes). */
  fetch?: typeof fetch;
  logger?: RemoteLogger;
}

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Accept, Authorization, x-ada-token, x-ada-client, mcp-protocol-version, mcp-session-id, last-event-id',
  'Access-Control-Expose-Headers': 'mcp-session-id, mcp-protocol-version',
  'Access-Control-Max-Age': '86400',
};

function withCors(res: Response): Response {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

function jsonRpcError(status: number, message: string, extraHeaders: Record<string, string> = {}): Response {
  return new Response(JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message }, id: null }), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders },
  });
}

/**
 * Handler Web padrão (`Request` → `Response`) do MCP remoto. Serve no Vercel,
 * em Workers ou em qualquer runtime com Fetch API.
 */
export function createRemoteMcpHandler(options: RemoteMcpHandlerOptions = {}): (req: Request) => Promise<Response> {
  const logger = options.logger ?? consoleLogger;

  return async (req) => {
    const correlationId = req.headers.get('x-correlation-id') ?? crypto.randomUUID();

    if (req.method === 'OPTIONS') return withCors(new Response(null, { status: 204 }));
    if (req.method !== 'POST') {
      // Sem sessão: não há stream GET de notificações nem DELETE de sessão.
      return withCors(jsonRpcError(405, 'Método não suportado. Este servidor MCP aceita só POST.', { Allow: 'POST, OPTIONS' }));
    }

    const auth = credentialsFromHeaders(req.headers);
    if (!auth.ok) {
      logger.info({ msg: 'adaflow-mcp.rejected', correlationId, status: auth.status });
      return withCors(
        jsonRpcError(auth.status, auth.message, auth.status === 401 ? { 'WWW-Authenticate': 'Bearer realm="adaflow"' } : {}),
      );
    }

    const startedAt = Date.now();
    const authType = 'jwt' in auth.credentials ? 'jwt' : 'app_token';
    try {
      const client = new AdaflowClient({
        ...auth.credentials,
        baseUrl: options.baseUrl,
        client: req.headers.get('x-ada-client')?.trim() || undefined,
        fetch: options.fetch,
      });
      const server = createAdaflowMcpServer(client, { remote: true });
      const transport = new WebStandardStreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
      await server.connect(transport);
      const res = await transport.handleRequest(req);
      logger.info({ msg: 'adaflow-mcp.request', correlationId, authType, status: res.status, durationMs: Date.now() - startedAt });
      return withCors(res);
    } catch (err) {
      logger.error({
        msg: 'adaflow-mcp.failed',
        correlationId,
        authType,
        error: err instanceof Error ? `${err.name}: ${err.message}` : String(err),
      });
      return withCors(jsonRpcError(500, 'Erro interno no servidor MCP da Adaflow. Tente de novo em instantes.'));
    }
  };
}
