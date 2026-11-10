/**
 * Adaflow no servidor (route handlers do Next.js).
 *
 * O token da Adaflow só é lido aqui, no servidor. Nunca o exponha com o
 * prefixo NEXT_PUBLIC_ nem o envie ao navegador.
 *
 * Variáveis do projeto (no v0: Vars; na Vercel: Environment Variables):
 *   ADAFLOW_APP_TOKEN  obrigatório. Token de app criado na Adaflow (ada_...).
 *   ADAFLOW_BASE_URL   opcional. Gateway private label; vazio = produção.
 */
import 'server-only';
import { AdaflowApiError, AdaflowClient } from '@adaflow/sdk';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

function appToken(): string | undefined {
  const value = process.env.ADAFLOW_APP_TOKEN?.trim();
  return value ? value : undefined;
}

/** A integração está configurada? Os componentes usam isso para mostrar o aviso de configuração. */
export function isAdaflowConfigured(): boolean {
  return appToken() !== undefined;
}

/** Cliente da Adaflow com o token de app do projeto, ou `null` se faltar a variável. */
export function getAdaflowClient(): AdaflowClient | null {
  const token = appToken();
  if (!token) return null;
  return new AdaflowClient({
    appToken: token,
    baseUrl: process.env.ADAFLOW_BASE_URL?.trim() || undefined,
    client: 'v0',
  });
}

export interface AdaflowErrorBody {
  error: { code: string; message: string };
}

export function errorResponse(status: number, code: string, message: string, headers: HeadersInit = {}): Response {
  return Response.json({ error: { code, message } } satisfies AdaflowErrorBody, { status, headers });
}

export function notConfiguredResponse(): Response {
  return errorResponse(
    503,
    'not_configured',
    'A integração com a Adaflow não está configurada. Adicione a variável ADAFLOW_APP_TOKEN ao projeto.',
  );
}

/**
 * Converte qualquer falha em resposta com mensagem amigável. O detalhe
 * técnico vai só para o log do servidor.
 */
export function adaflowErrorResponse(err: unknown, context: string): Response {
  if (err instanceof AdaflowApiError) {
    console.error(`[adaflow] ${context}`, { status: err.status, code: err.code, message: err.message });
    if (err.isInsufficientQuota) {
      return errorResponse(429, 'insufficient_quota', 'A organização está sem créditos na Adaflow.');
    }
    if (err.isAuthError) {
      return errorResponse(
        401,
        'adaflow_auth',
        'O token da Adaflow é inválido ou foi revogado. Atualize a variável ADAFLOW_APP_TOKEN.',
      );
    }
    if (err.isPermissionError) {
      return errorResponse(403, 'adaflow_forbidden', 'O token da Adaflow não tem permissão para esta ação.');
    }
    if (err.status === 404) return errorResponse(404, 'adaflow_not_found', 'Recurso não encontrado na Adaflow.');
    if (err.isRateLimit) {
      return errorResponse(429, 'rate_limited', 'Muitas requisições à Adaflow. Tente de novo em instantes.');
    }
    if (err.status >= 500) {
      return errorResponse(502, 'adaflow_unavailable', 'A Adaflow está indisponível no momento. Tente de novo em instantes.');
    }
    return errorResponse(err.status, err.code ?? 'adaflow_error', 'A Adaflow recusou a requisição.');
  }
  console.error(`[adaflow] ${context}`, err);
  return errorResponse(502, 'adaflow_unreachable', 'Não foi possível falar com a Adaflow. Tente de novo em instantes.');
}
