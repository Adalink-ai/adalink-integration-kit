/**
 * Núcleo puro do tracking de governança — sem rede, timers ou DOM.
 * Tudo aqui é testável de forma determinística (deps `now`/`id` injetáveis).
 */

export type AuditSeverity = 'info' | 'warning' | 'critical';

export interface AuditEventInput {
  /** Ação no namespace reservado de apps parceiros: `app.<dominio>.<verbo>`. */
  action: string;
  /** Tipo do recurso afetado (ex.: 'Contrato'). */
  resource: string;
  /** UUID do recurso na plataforma — ids próprios do app vão em metadata. */
  resourceId?: string;
  /** Label pt-BR exibido no módulo Governança. */
  actionLabel?: string;
  category?: string;
  severity?: AuditSeverity;
  success?: boolean;
  /** Contexto adicional (máx. 4KB serializado; nunca PII/segredos). */
  metadata?: Record<string, unknown>;
  /** Quando ocorreu (default: agora). Janela aceita: -7 dias a +5 minutos. */
  occurredAt?: string | Date;
  /** Chave de idempotência — gerada automaticamente se omitida. */
  eventId?: string;
}

export interface NormalizedAuditEvent extends Omit<AuditEventInput, 'occurredAt' | 'eventId'> {
  eventId: string;
  occurredAt?: string;
}

export const ACTION_REGEX = /^app\.[a-z0-9_-]+(\.[a-z0-9_-]+){1,4}$/;
export const METADATA_MAX_BYTES = 4096;
export const EVENTS_BATCH_MAX = 50;

export function isValidAction(action: string): boolean {
  return ACTION_REGEX.test(action);
}

export function metadataByteSize(metadata: unknown): number {
  return new TextEncoder().encode(JSON.stringify(metadata)).length;
}

export interface NormalizeDeps {
  id?: () => string;
}

/**
 * Valida e normaliza um evento antes do envio. Lança `Error` com mensagem
 * pt-BR em payload inválido — melhor falhar no `track()` do que receber 400.
 */
export function normalizeEvent(input: AuditEventInput, deps: NormalizeDeps = {}): NormalizedAuditEvent {
  if (!isValidAction(input.action)) {
    throw new Error(
      `Ação inválida: "${input.action}". Use o formato app.<dominio>.<verbo> (lowercase, ex.: app.contrato.aprovado).`,
    );
  }
  if (!input.resource) {
    throw new Error('resource é obrigatório (ex.: "Contrato").');
  }
  if (input.metadata !== undefined && metadataByteSize(input.metadata) > METADATA_MAX_BYTES) {
    throw new Error(`metadata excede o limite de ${METADATA_MAX_BYTES} bytes.`);
  }

  const occurredAt =
    input.occurredAt instanceof Date ? input.occurredAt.toISOString() : input.occurredAt;

  return {
    ...input,
    occurredAt,
    eventId: input.eventId ?? (deps.id ?? generateId)(),
  };
}

/** Envelope do POST /v1/audit/events/batch — o `app` é carimbado por evento. */
export function buildEventsPayload(
  events: NormalizedAuditEvent[],
  app: string,
): { events: Array<NormalizedAuditEvent & { app: string }> } {
  return { events: events.map((event) => ({ ...event, app })) };
}

export function chunkBatch<T>(items: T[], max: number): T[][] {
  if (max <= 0) throw new Error('chunkBatch: max deve ser positivo.');
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += max) {
    chunks.push(items.slice(i, i + max));
  }
  return chunks;
}

export interface BackoffOptions {
  baseMs?: number;
  capMs?: number;
  /** Determinístico em teste: injete `random` fixo. */
  random?: () => number;
}

/**
 * Backoff exponencial com jitter. `retryAfterSec` (header Retry-After do 429)
 * prevalece sobre o cálculo exponencial.
 */
export function computeBackoffMs(
  attempt: number,
  retryAfterSec?: number,
  options: BackoffOptions = {},
): number {
  const { baseMs = 1000, capMs = 30_000, random = Math.random } = options;
  if (retryAfterSec !== undefined && retryAfterSec > 0) {
    return Math.min(retryAfterSec * 1000, capMs);
  }
  const exp = baseMs * 2 ** Math.max(0, attempt);
  const jitter = 0.5 + random() * 0.5;
  return Math.min(Math.round(exp * jitter), capMs);
}

/** Filtra eventos cujo eventId já foi visto, preservando a ordem. */
export function dedupeNew(
  events: NormalizedAuditEvent[],
  seen: ReadonlySet<string>,
): NormalizedAuditEvent[] {
  const batch = new Set<string>();
  return events.filter((event) => {
    if (seen.has(event.eventId) || batch.has(event.eventId)) return false;
    batch.add(event.eventId);
    return true;
  });
}

/** UUID v4 via crypto.randomUUID, com fallback puro para runtimes antigos. */
export function generateId(): string {
  const cryptoObj = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  let out = '';
  for (let i = 0; i < 36; i++) {
    if (i === 8 || i === 13 || i === 18 || i === 23) out += '-';
    else if (i === 14) out += '4';
    else if (i === 19) out += ((Math.random() * 4) | 8).toString(16);
    else out += ((Math.random() * 16) | 0).toString(16);
  }
  return out;
}
