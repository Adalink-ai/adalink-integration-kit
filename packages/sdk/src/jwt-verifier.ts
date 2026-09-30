/**
 * Verificação server-side do JWT emitido pelo Adaflow (o IdP do app).
 *
 * O Adaflow assina com EdDSA (Ed25519) e publica as chaves públicas num JWKS.
 * Aqui só se VALIDA a identidade — assinatura, validade e, opcionalmente,
 * issuer e audience. Permissão continua local: o token prova quem é a pessoa,
 * nunca o que ela pode fazer no app.
 *
 * Sem dependência de runtime: usa WebCrypto (`crypto.subtle`), disponível no
 * Node ≥ 18.17 e em runtimes edge.
 */

import { resolveBaseUrl } from './http.js';

/** Caminho do JWKS no gateway do Adaflow (igual em todos os ambientes). */
export const JWKS_PATH = '/v1/auth/jwks';

/** Identidade extraída de um JWT válido do Adaflow. */
export interface AdaflowIdentity {
  /** Id do usuário na plataforma. */
  sub: string;
  /** E-mail em minúsculas; `undefined` se o token não trouxer. */
  email?: string;
  name?: string;
  /** Organização ativa na sessão do Adaflow. */
  organizationId?: string;
  role?: string;
  /** Sessão do Adaflow que emitiu o token. */
  sessionId?: string;
  issuedAt?: Date;
  expiresAt: Date;
  /** Payload completo, para claims que o SDK não tipa. */
  claims: Record<string, unknown>;
}

export type AdaflowTokenErrorCode =
  | 'malformed'
  | 'unsupported_alg'
  | 'unknown_key'
  | 'invalid_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'invalid_issuer'
  | 'invalid_audience'
  | 'jwks_unavailable';

/** Token recusado. `code` diz o motivo sem expor o token. */
export class AdaflowTokenError extends Error {
  readonly code: AdaflowTokenErrorCode;

  constructor(code: AdaflowTokenErrorCode, message: string) {
    super(message);
    this.name = 'AdaflowTokenError';
    this.code = code;
  }
}

export interface JwtVerifierOptions {
  /**
   * URL do JWKS. Default: `<baseUrl>/v1/auth/jwks`, com o `baseUrl` resolvido
   * como no client (explícito → env `ADAFLOW_BASE_URL` → produção). Informe
   * só quando o JWKS não estiver no gateway (ex.: env `ADAFLOW_JWKS_URL`).
   */
  jwksUrl?: string;
  /** Base do gateway do ambiente (ex.: `https://adaflow.adalink.ai`). */
  baseUrl?: string;
  /** Issuer esperado (`iss`). Sem ele, o issuer não é conferido. */
  issuer?: string;
  /** Audience esperada (`aud`). Sem ela, a audience não é conferida. */
  audience?: string;
  /** Folga de relógio em segundos para `exp`/`nbf`. Default: 5. */
  clockToleranceSec?: number;
  /** Quanto tempo o JWKS fica em cache, em ms. Default: 10 min. */
  cacheTtlMs?: number;
  /**
   * Intervalo mínimo, em ms, entre buscas forçadas por `kid` desconhecido.
   * Impede que tokens forjados com `kid` aleatório virem rajada no JWKS.
   * Default: 30 s.
   */
  refetchCooldownMs?: number;
  fetch?: typeof fetch;
  /** Relógio injetável (testes). */
  now?: () => number;
}

interface Jwk {
  kty?: string;
  crv?: string;
  x?: string;
  kid?: string;
  alg?: string;
  use?: string;
}

const DEFAULT_CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_REFETCH_COOLDOWN_MS = 30 * 1000;
const DEFAULT_CLOCK_TOLERANCE_SEC = 5;

function base64UrlToBytes(input: string): Uint8Array<ArrayBuffer> {
  const base64 = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function decodeJsonSegment(segment: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(new TextDecoder().decode(base64UrlToBytes(segment)));
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // cai no erro abaixo
  }
  throw new AdaflowTokenError('malformed', 'Token malformado.');
}

const str = (value: unknown): string | undefined =>
  typeof value === 'string' && value.length > 0 ? value : undefined;

const epoch = (value: unknown): number | undefined =>
  typeof value === 'number' && Number.isFinite(value) ? value : undefined;

/** Verificador com cache de JWKS. Crie um por processo e reutilize. */
export interface JwtVerifier {
  verify(token: string): Promise<AdaflowIdentity>;
}

/** URL efetiva do JWKS: explícita → `<baseUrl resolvido>/v1/auth/jwks`. */
export function resolveJwksUrl(options: Pick<JwtVerifierOptions, 'jwksUrl' | 'baseUrl'> = {}): string {
  if (options.jwksUrl) return options.jwksUrl;
  const base = resolveBaseUrl(options.baseUrl);
  if (!/^https?:\/\//.test(base)) {
    // O verificador roda no servidor: base relativa (mesma origem) não serve.
    throw new Error('createJwtVerifier: baseUrl precisa ser absoluta, ou informe jwksUrl.');
  }
  return base + JWKS_PATH;
}

export function createJwtVerifier(options: JwtVerifierOptions = {}): JwtVerifier {
  const jwksUrl = resolveJwksUrl(options);
  const cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  const cooldownMs = options.refetchCooldownMs ?? DEFAULT_REFETCH_COOLDOWN_MS;
  const toleranceSec = options.clockToleranceSec ?? DEFAULT_CLOCK_TOLERANCE_SEC;
  const now = options.now ?? Date.now;
  const fetchImpl = (options.fetch ?? fetch).bind(globalThis);

  let keys = new Map<string, Promise<CryptoKey>>();
  let fetchedAt = -Infinity;
  let inflight: Promise<void> | null = null;

  async function loadJwks(): Promise<void> {
    let res: Response;
    try {
      res = await fetchImpl(jwksUrl, { headers: { accept: 'application/json' } });
    } catch {
      throw new AdaflowTokenError('jwks_unavailable', 'JWKS do Adaflow indisponível.');
    }
    if (!res.ok) {
      throw new AdaflowTokenError('jwks_unavailable', `JWKS do Adaflow respondeu HTTP ${res.status}.`);
    }
    const body = (await res.json().catch(() => null)) as { keys?: Jwk[] } | null;
    const next = new Map<string, Promise<CryptoKey>>();
    for (const jwk of body?.keys ?? []) {
      // Só Ed25519: qualquer outra chave publicada é ignorada, então um token
      // com outro algoritmo nunca encontra chave para verificar.
      if (jwk.kty !== 'OKP' || jwk.crv !== 'Ed25519' || !jwk.x) continue;
      const key = crypto.subtle.importKey(
        'jwk',
        { kty: 'OKP', crv: 'Ed25519', x: jwk.x },
        { name: 'Ed25519' },
        false,
        ['verify'],
      );
      key.catch(() => undefined);
      next.set(jwk.kid ?? '', key);
    }
    keys = next;
    fetchedAt = now();
  }

  function refresh(): Promise<void> {
    inflight ??= loadJwks().finally(() => {
      inflight = null;
    });
    return inflight;
  }

  async function keyFor(kid: string): Promise<CryptoKey> {
    if (now() - fetchedAt > cacheTtlMs) await refresh();
    let key = keys.get(kid);
    if (!key && now() - fetchedAt > cooldownMs) {
      // Rotação de chave: o kid novo ainda não está no cache.
      await refresh();
      key = keys.get(kid);
    }
    if (!key) throw new AdaflowTokenError('unknown_key', 'Chave do token não publicada no JWKS.');
    try {
      return await key;
    } catch {
      throw new AdaflowTokenError('unknown_key', 'Chave do JWKS inválida.');
    }
  }

  async function verify(token: string): Promise<AdaflowIdentity> {
    const parts = typeof token === 'string' ? token.split('.') : [];
    if (parts.length !== 3 || parts.some((p) => p.length === 0)) {
      throw new AdaflowTokenError('malformed', 'Token malformado.');
    }
    const [headerSegment, payloadSegment, signatureSegment] = parts as [string, string, string];
    const header = decodeJsonSegment(headerSegment);

    // Algoritmo fixo: sem isso, um token HS256 assinado com segredo adivinhável
    // passaria (ataque de confusão de algoritmo).
    if (header.alg !== 'EdDSA') {
      throw new AdaflowTokenError('unsupported_alg', 'Algoritmo do token não aceito (esperado EdDSA).');
    }

    const key = await keyFor(str(header.kid) ?? '');
    let signature: Uint8Array<ArrayBuffer>;
    try {
      signature = base64UrlToBytes(signatureSegment);
    } catch {
      throw new AdaflowTokenError('malformed', 'Token malformado.');
    }
    const signed = new TextEncoder().encode(`${headerSegment}.${payloadSegment}`);
    const valid = await crypto.subtle.verify({ name: 'Ed25519' }, key, signature, signed);
    if (!valid) throw new AdaflowTokenError('invalid_signature', 'Assinatura do token inválida.');

    const claims = decodeJsonSegment(payloadSegment);
    const nowSec = now() / 1000;
    const exp = epoch(claims.exp);
    if (exp === undefined || nowSec > exp + toleranceSec) {
      throw new AdaflowTokenError('expired', 'Token expirado.');
    }
    const nbf = epoch(claims.nbf);
    if (nbf !== undefined && nowSec < nbf - toleranceSec) {
      throw new AdaflowTokenError('not_yet_valid', 'Token ainda não é válido.');
    }
    if (options.issuer !== undefined && claims.iss !== options.issuer) {
      throw new AdaflowTokenError('invalid_issuer', 'Issuer do token não confere.');
    }
    if (options.audience !== undefined) {
      const aud = claims.aud;
      const audiences = Array.isArray(aud) ? aud : [aud];
      if (!audiences.includes(options.audience)) {
        throw new AdaflowTokenError('invalid_audience', 'Audience do token não confere.');
      }
    }

    const sub = str(claims.sub);
    if (!sub) throw new AdaflowTokenError('malformed', 'Token sem sub.');
    const iat = epoch(claims.iat);
    return {
      sub,
      email: str(claims.email)?.toLowerCase(),
      name: str(claims.name),
      organizationId: str(claims.organizationId),
      role: str(claims.role),
      sessionId: str(claims.sessionId),
      issuedAt: iat !== undefined ? new Date(iat * 1000) : undefined,
      expiresAt: new Date(exp * 1000),
      claims,
    };
  }

  return { verify };
}
