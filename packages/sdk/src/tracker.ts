import { AdaflowApiError } from './errors.js';
import type { HttpTransport } from './http.js';
import {
  type AuditEventInput,
  type NormalizedAuditEvent,
  EVENTS_BATCH_MAX,
  buildEventsPayload,
  chunkBatch,
  computeBackoffMs,
  dedupeNew,
  normalizeEvent,
} from './tracker-core.js';

export interface TrackerOptions {
  /** Slug do app parceiro (mesmo valor em todos os eventos). */
  app: string;
  /** Eventos por flush (máx. 50 — teto do endpoint batch). Default: 50. */
  maxBatchSize?: number;
  /** Intervalo do flush automático. Default: 5000ms. 0 desliga o timer. */
  flushIntervalMs?: number;
  /** Teto da fila em memória — acima disso, drop-oldest com aviso. Default: 1000. */
  maxQueueSize?: number;
  /** Tentativas por lote em 429/5xx/rede. Default: 3. */
  maxRetries?: number;
  /** Notificação de eventos descartados/erros. Default: console.warn. */
  onError?: (error: unknown, dropped: AuditEventInput[]) => void;
}

const SEEN_IDS_MAX = 2000;

/**
 * Tracker buffered de eventos de governança (padrão analytics):
 * `track()` é síncrono (valida + enfileira); o envio acontece por flush
 * automático (N eventos ou intervalo), manual (`flush()`) ou final
 * (`close()`, com `keepalive` no browser).
 *
 * Resiliência: retry com backoff exponencial + Retry-After apenas em
 * 429/5xx/rede; 400 descarta o lote e reporta via `onError`; **404 desativa o
 * tracker** (ambiente sem o endpoint de ingestão — feature detection sem loop
 * de erro). Dedupe por eventId com janela dos últimos 2000 ids.
 *
 * 100% fail-soft: nenhum erro do tracker propaga para o app.
 */
export class AdaflowTracker {
  private queue: NormalizedAuditEvent[] = [];
  private readonly seen = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<void> = Promise.resolve();
  private disabled = false;
  private readonly options: Required<Omit<TrackerOptions, 'onError'>> & Pick<TrackerOptions, 'onError'>;
  private readonly unloadHandler: (() => void) | null = null;

  constructor(
    private readonly http: HttpTransport,
    options: TrackerOptions,
  ) {
    this.options = {
      app: options.app,
      maxBatchSize: Math.min(options.maxBatchSize ?? EVENTS_BATCH_MAX, EVENTS_BATCH_MAX),
      flushIntervalMs: options.flushIntervalMs ?? 5000,
      maxQueueSize: options.maxQueueSize ?? 1000,
      maxRetries: options.maxRetries ?? 3,
      onError: options.onError,
    };

    if (this.options.flushIntervalMs > 0) {
      this.timer = setInterval(() => void this.flush(), this.options.flushIntervalMs);
      // Em Node, o timer não deve segurar o processo vivo.
      (this.timer as { unref?: () => void }).unref?.();
    }

    if (typeof window !== 'undefined') {
      const handler = () => void this.flush(true);
      window.addEventListener('pagehide', handler);
      document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') void this.flush(true);
      });
      this.unloadHandler = handler;
    }
  }

  /** Valida, normaliza e enfileira. Erros de validação vão para onError (nunca lançam). */
  track(event: AuditEventInput): void {
    if (this.disabled) return;
    let normalized: NormalizedAuditEvent;
    try {
      normalized = normalizeEvent(event);
    } catch (err) {
      this.reportError(err, [event]);
      return;
    }

    this.queue.push(normalized);
    if (this.queue.length > this.options.maxQueueSize) {
      const dropped = this.queue.splice(0, this.queue.length - this.options.maxQueueSize);
      this.reportError(
        new Error(`Fila de tracking cheia — ${dropped.length} evento(s) descartado(s).`),
        dropped,
      );
    }
    if (this.queue.length >= this.options.maxBatchSize) void this.flush();
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Envia a fila. Flushes concorrentes são serializados. */
  flush(keepalive = false): Promise<void> {
    this.flushing = this.flushing.then(() => this.doFlush(keepalive));
    return this.flushing;
  }

  /** Flush final + desliga timer e listeners. Chame no shutdown/cleanup. */
  async close(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (this.unloadHandler && typeof window !== 'undefined') {
      window.removeEventListener('pagehide', this.unloadHandler);
    }
    await this.flush(typeof window !== 'undefined');
    this.disabled = true;
  }

  private async doFlush(keepalive: boolean): Promise<void> {
    if (this.disabled || this.queue.length === 0) return;

    const fresh = dedupeNew(this.queue, this.seen);
    this.queue = [];
    for (const event of fresh) {
      this.seen.add(event.eventId);
      if (this.seen.size > SEEN_IDS_MAX) {
        const first = this.seen.values().next().value;
        if (first !== undefined) this.seen.delete(first);
      }
    }

    for (const batch of chunkBatch(fresh, this.options.maxBatchSize)) {
      await this.sendBatch(batch, keepalive);
      if (this.disabled) return;
    }
  }

  private async sendBatch(batch: NormalizedAuditEvent[], keepalive: boolean): Promise<void> {
    for (let attempt = 0; attempt <= this.options.maxRetries; attempt++) {
      try {
        await this.http.request('/v1/audit/events/batch', {
          method: 'POST',
          body: buildEventsPayload(batch, this.options.app),
          keepalive,
        });
        return;
      } catch (err) {
        if (err instanceof AdaflowApiError) {
          if (err.status === 404) {
            // Ambiente sem o endpoint de ingestão — desativa de vez.
            this.disabled = true;
            this.reportError(
              new Error(
                'Trilha de auditoria indisponível neste ambiente do Adaflow — tracking desativado.',
              ),
              batch,
            );
            return;
          }
          if (err.status >= 400 && err.status < 500 && err.status !== 429) {
            // Payload rejeitado — retry não resolve.
            this.reportError(err, batch);
            return;
          }
        }
        if (attempt === this.options.maxRetries) {
          this.reportError(err, batch);
          return;
        }
        const retryAfter =
          err instanceof AdaflowApiError && err.isRateLimit
            ? readRetryAfter(err.body)
            : undefined;
        await sleep(computeBackoffMs(attempt, retryAfter));
      }
    }
  }

  private reportError(error: unknown, dropped: (AuditEventInput | NormalizedAuditEvent)[]): void {
    try {
      if (this.options.onError) {
        this.options.onError(error, dropped as AuditEventInput[]);
      } else if (typeof console !== 'undefined') {
        console.warn('[adaflow-tracker]', error);
      }
    } catch {
      // onError do app lançou — tracker permanece fail-soft.
    }
  }
}

function readRetryAfter(body: unknown): number | undefined {
  if (body && typeof body === 'object' && 'retryAfter' in body) {
    const value = (body as { retryAfter?: unknown }).retryAfter;
    return typeof value === 'number' ? value : undefined;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, ms);
    (t as { unref?: () => void }).unref?.();
  });
}
