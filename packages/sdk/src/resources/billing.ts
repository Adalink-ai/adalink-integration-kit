import type { HttpTransport } from '../http.js';

/** Consumo e saldo (`/v1/usage`, `/v1/wallet`). */
export class BillingResource {
  constructor(private readonly http: HttpTransport) {}

  /** Eventos de consumo da organização (turnos de chat têm `metadata.source: 'openai-compat'`). */
  async usage(query?: { page?: number; limit?: number }): Promise<unknown> {
    return this.http.requestJson<unknown>('/v1/usage', { query });
  }

  /** Saldo da wallet da organização. */
  async wallet(): Promise<unknown> {
    return this.http.requestJson<unknown>('/v1/wallet');
  }
}
