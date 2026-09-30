/**
 * Catálogo de eventos da trilha e registro de acesso ao app.
 *
 * O admin do Adaflow precisa responder duas perguntas sobre um app parceiro:
 * quem acessou e que trilha a pessoa fez. Este módulo cobre as duas do lado do
 * app, sobre o `POST /v1/audit/events/batch`:
 *
 *  - `defineAuditEvents`: catálogo validado na definição (ação, recurso),
 *    com `eventId` determinístico para reenvios idempotentes;
 *  - `recordAppAccess`: registra a entrada da pessoa no app, assinado com o
 *    JWT dela. O SSO já registra o login do lado do Adaflow; este é o acesso
 *    ao app em si (registro duplicado aceito por ora).
 *
 * Autoria: ação de pessoa sempre com o JWT do usuário logado — a plataforma
 * deriva o autor da credencial, nunca do payload.
 */

import { AdaflowClient } from './index.js';
import type { AdaflowClientOptions } from './http.js';
import type { AdaflowIdentity } from './jwt-verifier.js';
import type { TrackResult } from './resources/governance.js';
import {
  type AuditEventInput,
  type AuditSeverity,
  isValidAction,
  METADATA_MAX_BYTES,
  metadataByteSize,
} from './tracker-core.js';

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Namespace UUID dos eventIds gerados pelo SDK (fixo: muda-lo quebra a idempotência). */
export const AUDIT_EVENT_NAMESPACE = '5b0d1f3e-8a2c-5d47-9e61-3c4f7a9b2e10';

function uuidToBytes(uuid: string): Uint8Array {
  const hex = uuid.replace(/-/g, '');
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  return bytes;
}

/**
 * UUID v5 (RFC 9562) de `name` no `namespace`. Mesmo nome, mesmo id: é o que
 * torna idempotente um evento reenviado (cron que repete, webhook duplicado).
 */
export async function uuidV5(name: string, namespace: string = AUDIT_EVENT_NAMESPACE): Promise<string> {
  if (!UUID_REGEX.test(namespace)) throw new Error(`Namespace UUID inválido: "${namespace}".`);
  const nameBytes = new TextEncoder().encode(name);
  const input = new Uint8Array(16 + nameBytes.length);
  input.set(uuidToBytes(namespace), 0);
  input.set(nameBytes, 16);
  const hash = new Uint8Array(await crypto.subtle.digest('SHA-1', input));
  hash[6] = (hash[6]! & 0x0f) | 0x50;
  hash[8] = (hash[8]! & 0x3f) | 0x80;
  const hex = Array.from(hash.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

/** Uma entrada do catálogo: o que a Governança mostra para esse momento. */
export interface AuditEventSpec {
  /** `app.<dominio>.<verbo>`, sem acento (ex.: `app.cotacao.aprovada`). */
  action: string;
  /** Texto pt-BR que o admin lê (ex.: 'Cotação aprovada'). */
  label: string;
  /** Tipo do recurso (ex.: 'Cotacao'). */
  resource: string;
  category?: string;
  severity?: AuditSeverity;
  /** Default: true. */
  success?: boolean;
}

export interface BuildAuditEventInput {
  /** Id do objeto do evento no app; também é a semente da idempotência. */
  subjectId: string;
  /**
   * Diferencia repetições legítimas do mesmo (evento, objeto) — ex.: exportar
   * a mesma cotação duas vezes. Sem ela, a segunda vira `duplicated`.
   */
  occurrence?: string;
  /** UUID do recurso NA PLATAFORMA; ids do app vão em `subjectId`/metadata. */
  resourceId?: string;
  /** Contexto operacional. Nunca PII, preços ou dados do cliente (máx. 4 KB). */
  metadata?: Record<string, unknown>;
  occurredAt?: string | Date;
}

export interface AuditCatalog<K extends string> {
  /** Monta o evento pronto para `governance.track` / `tracker.track`. */
  build(kind: K, input: BuildAuditEventInput): Promise<AuditEventInput>;
  readonly specs: Readonly<Record<K, AuditEventSpec>>;
}

/**
 * Define o catálogo de eventos do app. Valida tudo na definição — um evento
 * fora do contrato quebra no boot do app, não como 400 em produção.
 *
 * ```ts
 * const events = defineAuditEvents('amcor-rfqs', {
 *   quoteApproved: { action: 'app.cotacao.aprovada', label: 'Cotação aprovada', resource: 'Cotacao' },
 * });
 * await client.governance.track(await events.build('quoteApproved', { subjectId: quote.id }), { app });
 * ```
 *
 * `scope` entra na semente do `eventId`: use o slug do app, para dois apps
 * nunca gerarem o mesmo id.
 */
export function defineAuditEvents<K extends string>(
  scope: string,
  specs: Record<K, AuditEventSpec>,
): AuditCatalog<K> {
  if (!scope) throw new Error('defineAuditEvents: informe o scope (slug do app).');
  for (const [kind, spec] of Object.entries(specs) as Array<[string, AuditEventSpec]>) {
    if (!isValidAction(spec.action)) {
      throw new Error(
        `Evento "${kind}": ação inválida "${spec.action}". Use app.<dominio>.<verbo> (lowercase, sem acento).`,
      );
    }
    if (!spec.resource) throw new Error(`Evento "${kind}": resource é obrigatório.`);
    if (!spec.label) throw new Error(`Evento "${kind}": label é obrigatório.`);
    if (spec.label.length > 120) throw new Error(`Evento "${kind}": label acima de 120 caracteres.`);
  }

  return {
    specs,
    async build(kind, input) {
      const spec = specs[kind];
      if (!spec) throw new Error(`Evento desconhecido no catálogo: "${kind}".`);
      if (!input.subjectId) throw new Error(`Evento "${kind}": subjectId é obrigatório.`);
      const metadata = { subjectId: input.subjectId, ...input.metadata };
      if (metadataByteSize(metadata) > METADATA_MAX_BYTES) {
        throw new Error(`Evento "${kind}": metadata excede ${METADATA_MAX_BYTES} bytes.`);
      }
      const seed = [scope, kind, input.subjectId, input.occurrence].filter(Boolean).join(':');
      return {
        action: spec.action,
        actionLabel: spec.label,
        resource: spec.resource,
        category: spec.category,
        severity: spec.severity ?? 'info',
        success: spec.success ?? true,
        resourceId: input.resourceId,
        metadata,
        occurredAt: input.occurredAt,
        eventId: await uuidV5(seed),
      };
    },
  };
}

/** Ações de acesso que o SDK registra (categoria `acesso`). */
export const ACCESS_EVENTS = {
  granted: { action: 'app.acesso.login', label: 'Acesso ao aplicativo', severity: 'info', success: true },
  denied: { action: 'app.acesso.negado', label: 'Acesso ao aplicativo negado', severity: 'warning', success: false },
} as const satisfies Record<string, { action: string; label: string; severity: AuditSeverity; success: boolean }>;

export type AccessOutcome = keyof typeof ACCESS_EVENTS;

export interface AppAccessInput {
  /** JWT do Adaflow que a pessoa acabou de apresentar (já verificado). */
  token: string;
  /** Identidade devolvida por `createJwtVerifier().verify(token)`. */
  identity: AdaflowIdentity;
  /** Slug do app parceiro (o mesmo do `governance.track`). */
  app: string;
  /**
   * `granted`: entrou. `denied`: identidade válida, mas sem acesso local (ex.:
   * sem cadastro no app). Default: `granted`.
   */
  outcome?: AccessOutcome;
  /** Motivo curto do `denied` (ex.: 'sem_cadastro'). Nunca PII. */
  reason?: string;
  metadata?: Record<string, unknown>;
}

export type AppAccessResult = { ok: true; result: TrackResult } | { ok: false; error: unknown };

/** Evento de acesso, idempotente por sessão do Adaflow + emissão do token. */
export async function buildAccessEvent(input: Omit<AppAccessInput, 'token'>): Promise<AuditEventInput> {
  const outcome = input.outcome ?? 'granted';
  const spec = ACCESS_EVENTS[outcome];
  const { identity } = input;
  // Mesmo token trocado duas vezes (retry do callback) → mesmo eventId.
  const emission = identity.issuedAt?.getTime() ?? identity.expiresAt.getTime();
  const seed = ['acesso', input.app, outcome, identity.sessionId ?? identity.sub, emission].join(':');
  return {
    action: spec.action,
    actionLabel: spec.label,
    resource: 'Aplicativo',
    category: 'acesso',
    severity: spec.severity,
    success: spec.success,
    metadata: {
      ...input.metadata,
      ...(input.reason ? { reason: input.reason } : {}),
    },
    eventId: await uuidV5(seed),
  };
}

/**
 * Registra o acesso da pessoa ao app, assinado com o JWT dela (o autor na
 * trilha é ela). Chame logo depois de verificar o token no callback do SSO.
 *
 * Nunca lança: falha na trilha não pode impedir o login. Olhe `ok` para logar.
 */
export async function recordAppAccess(
  input: AppAccessInput,
  clientOptions: Omit<AdaflowClientOptions, 'jwt' | 'appToken' | 'authFetch'> = {},
): Promise<AppAccessResult> {
  try {
    const event = await buildAccessEvent(input);
    const client = new AdaflowClient({ ...clientOptions, jwt: input.token });
    const result = await client.governance.track(event, { app: input.app });
    return { ok: true, result };
  } catch (error) {
    return { ok: false, error };
  }
}
