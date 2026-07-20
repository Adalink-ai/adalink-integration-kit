/**
 * Tracking de governança do app (client-side).
 * Singleton do AdaflowClient apontando para o proxy /api/adaflow — o browser
 * nunca fala direto com o gateway (sem CORS, mesma origem do app).
 */
import { AdaflowClient, type AdaflowTracker, type AuditEventInput } from '@adaflow/sdk';
import { getJwt } from '@/lib/auth';

/** Slug deste app na trilha de auditoria (módulo Governança do Adaflow). */
export const APP_SOURCE = process.env.NEXT_PUBLIC_ADAFLOW_SOURCE ?? 'adaflow-starter';

let client: AdaflowClient | null = null;
let tracker: AdaflowTracker | null = null;

export function getTrackingClient(): AdaflowClient {
  if (!client) {
    client = new AdaflowClient({
      jwt: () => getJwt() ?? '',
      baseUrl: `${window.location.origin}/api/adaflow`,
    });
  }
  return client;
}

export function getTracker(): AdaflowTracker {
  if (!tracker) {
    tracker = getTrackingClient().governance.tracker({ app: APP_SOURCE });
  }
  return tracker;
}

/** Registra um passo de negócio do usuário (fail-soft, nunca lança). */
export function track(event: AuditEventInput): void {
  if (typeof window === 'undefined' || !getJwt()) return;
  getTracker().track(event);
}
