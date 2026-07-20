import type { HttpTransport } from '../http.js';
import { chunkBatch } from '../tracker-core.js';

export interface PageView {
  path: string;
  occurredAt?: string;
  [key: string]: unknown;
}

const PAGE_VIEWS_BATCH_MAX = 50;

/**
 * Telemetria de sessão (`/v1/telemetry`) — HTTP cru sobre as APIs existentes
 * da plataforma. Para tracking automático no browser use o helper
 * `startSessionTracking` (heartbeat, visibilitychange, pagehide).
 *
 * O servidor é autoritativo no cálculo de tempo ativo — o heartbeat envia
 * apenas o `sessionId`.
 */
export class TelemetryResource {
  constructor(private readonly http: HttpTransport) {}

  /** Ping de sessão ativa (~60s; teto do servidor: 90s). */
  async heartbeat(params: { sessionId: string }): Promise<void> {
    await this.http.request('/v1/telemetry/heartbeat', {
      method: 'POST',
      body: { sessionId: params.sessionId },
    });
  }

  /** Registra page-views (chunking automático em lotes de 50). */
  async pageViews(params: { sessionId: string; views: PageView[] }): Promise<void> {
    for (const chunk of chunkBatch(params.views, PAGE_VIEWS_BATCH_MAX)) {
      await this.http.request('/v1/telemetry/page-view', {
        method: 'POST',
        body: { sessionId: params.sessionId, views: chunk },
      });
    }
  }

  /** Finaliza a sessão. `keepalive` para o disparo no pagehide. */
  async sessionEnd(
    params: { sessionId: string; reason?: string },
    opts: { keepalive?: boolean } = {},
  ): Promise<void> {
    await this.http.request('/v1/telemetry/session-end', {
      method: 'POST',
      body: { sessionId: params.sessionId, reason: params.reason ?? 'beacon' },
      keepalive: opts.keepalive,
    });
  }
}
