/**
 * Tracking automático de sessão (browser-only, como `sso.ts`).
 * Espelha o comportamento do frontend nativo do Adaflow:
 *  - sessionId em sessionStorage (sobrevive a reload; morre ao fechar a aba)
 *  - heartbeat a cada 60s SÓ com a aba visível (visibilitychange start/stop)
 *  - `pagehide` → session-end com fetch keepalive (sendBeacon não carrega o
 *    header Authorization — o JWT vive em sessionStorage, não em cookie)
 *  - 100% fail-soft: telemetria nunca quebra a navegação do app
 */
import type { AdaflowClient } from './index.js';
import { generateId } from './tracker-core.js';

const SESSION_ID_KEY = 'adaflow:telemetry-session-id';
const HEARTBEAT_INTERVAL_MS = 60_000;

export interface SessionTrackingOptions {
  /** Intervalo do heartbeat (default 60s — teto do servidor: 90s). */
  heartbeatIntervalMs?: number;
}

export interface SessionTrackingHandle {
  readonly sessionId: string;
  /** Registra uma page-view (chame no route-change do SPA). Fail-soft. */
  pageView(path?: string): void;
  /** Finaliza a sessão e remove timers/listeners. Retorne no cleanup do useEffect. */
  stop(): Promise<void>;
}

export function startSessionTracking(
  client: AdaflowClient,
  options: SessionTrackingOptions = {},
): SessionTrackingHandle {
  if (typeof window === 'undefined') {
    throw new Error('startSessionTracking só funciona em browser (window indisponível).');
  }

  const intervalMs = options.heartbeatIntervalMs ?? HEARTBEAT_INTERVAL_MS;

  let sessionId = sessionStorage.getItem(SESSION_ID_KEY);
  if (!sessionId) {
    sessionId = generateId();
    sessionStorage.setItem(SESSION_ID_KEY, sessionId);
  }

  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  const pendingViews: { route: string; viewedAt: string }[] = [];

  const beat = () => {
    client.telemetry.heartbeat({ sessionId: sessionId! }).catch(() => undefined);
    if (pendingViews.length > 0) {
      const views = pendingViews.splice(0, pendingViews.length);
      client.telemetry.pageViews({ sessionId: sessionId!, views }).catch(() => undefined);
    }
  };

  const start = () => {
    if (timer || stopped) return;
    beat();
    timer = setInterval(beat, intervalMs);
  };

  const pause = () => {
    if (timer) clearInterval(timer);
    timer = null;
  };

  const onVisibility = () => {
    if (document.visibilityState === 'visible') start();
    else pause();
  };

  const onPageHide = () => {
    pause();
    client.telemetry
      .sessionEnd({ sessionId: sessionId!, reason: 'beacon' }, { keepalive: true })
      .catch(() => undefined);
  };

  document.addEventListener('visibilitychange', onVisibility);
  window.addEventListener('pagehide', onPageHide);
  if (document.visibilityState === 'visible') start();

  return {
    sessionId,
    pageView(path?: string): void {
      pendingViews.push({
        route: path ?? window.location.pathname,
        viewedAt: new Date().toISOString(),
      });
    },
    async stop(): Promise<void> {
      if (stopped) return;
      stopped = true;
      pause();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('pagehide', onPageHide);
      await client.telemetry
        .sessionEnd({ sessionId: sessionId!, reason: 'logout' })
        .catch(() => undefined);
    },
  };
}
