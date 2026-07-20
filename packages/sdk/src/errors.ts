/**
 * Erro de API da Adalink. Normaliza os dois envelopes de erro da plataforma:
 * o envelope OpenAI (`{ error: { message, type, code } }`, usado em /v1/openai)
 * e o envelope padrão do gateway (`{ message, error, statusCode }`).
 */
export class AdalinkApiError extends Error {
  /** Status HTTP da resposta. */
  readonly status: number;
  /** Código estável quando disponível (ex.: `invalid_api_key`, `model_not_found`, `insufficient_quota`). */
  readonly code?: string;
  /** Corpo bruto da resposta, para diagnóstico. */
  readonly body?: unknown;

  constructor(message: string, status: number, code?: string, body?: unknown) {
    super(message);
    this.name = 'AdalinkApiError';
    this.status = status;
    this.code = code;
    this.body = body;
  }

  /** Credencial inválida/expirada — com JWT, refaça o SSO handoff. */
  get isAuthError(): boolean {
    return this.status === 401;
  }

  /** Saldo de créditos insuficiente — condição do tenant, trate como aviso informativo. */
  get isInsufficientQuota(): boolean {
    return this.code === 'insufficient_quota';
  }

  /** Rate-limit — aplique backoff e tente de novo. */
  get isRateLimit(): boolean {
    return this.status === 429 && this.code !== 'insufficient_quota';
  }
}

interface OpenAiEnvelope {
  error?: { message?: string; code?: string };
}

interface GatewayEnvelope {
  message?: string | string[];
  error?: string;
  code?: string;
}

/** Constrói um AdalinkApiError a partir de uma Response não-2xx. */
export async function errorFromResponse(res: Response): Promise<AdalinkApiError> {
  let body: unknown;
  let message = `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    body = await res.json();
    const openai = body as OpenAiEnvelope;
    const gateway = body as GatewayEnvelope;
    if (openai.error?.message) {
      message = openai.error.message;
      code = openai.error.code;
    } else if (gateway.message) {
      message = Array.isArray(gateway.message) ? gateway.message.join('; ') : gateway.message;
      code = gateway.code ?? gateway.error;
    }
  } catch {
    // corpo não-JSON (ex.: HTML de proxy) — mantém o fallback HTTP <status>
  }
  return new AdalinkApiError(message, res.status, code, body);
}
