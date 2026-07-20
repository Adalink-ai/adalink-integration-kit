import type { HttpTransport } from '../http.js';
import { AdaflowTracker, type TrackerOptions } from '../tracker.js';
import {
  type AuditEventInput,
  type AuditSeverity,
  buildEventsPayload,
  normalizeEvent,
} from '../tracker-core.js';

export interface TrackOptions {
  /** Slug do app parceiro de origem (ex.: 'meu-app-vendas'). */
  app: string;
}

export interface TrackResult {
  accepted: number;
  duplicated: number;
  rejected: Array<{ index: number; reason: string }>;
}

export interface AuditLogItem {
  id: string;
  action: string;
  /** Label pt-BR resolvido pelo backend (fallback: a própria action). */
  actionLabel?: string;
  resource: string;
  resourceId?: string | null;
  category?: string;
  severity: AuditSeverity;
  sourceService: string;
  /** Label pt-BR do módulo/app de origem (ex.: 'App: Meu App'). */
  sourceServiceLabel?: string;
  actorUserId?: string | null;
  actorUserName?: string | null;
  actorUserEmail?: string | null;
  organizationId?: string;
  metadata?: Record<string, unknown> | null;
  success?: boolean;
  createdAt: string;
  [key: string]: unknown;
}

export interface AuditLogsQuery {
  search?: string;
  category?: string;
  severity?: AuditSeverity;
  action?: string;
  resource?: string;
  resourceId?: string;
  actorUserId?: string;
  /** Filtre por app parceiro com `app:<slug>`. */
  sourceService?: string;
  startDate?: string;
  endDate?: string;
  success?: boolean;
  cursor?: string;
  pageSize?: number;
}

export interface AuditLogsPage {
  items: AuditLogItem[];
  /** Re-passe como `cursor` para a próxima página (null = fim). */
  nextCursor?: string | null;
  /** true quando alguma fonte do fan-out falhou — resultado incompleto. */
  partial?: boolean;
  failedSources?: string[];
  [key: string]: unknown;
}

export interface AuditStats {
  [key: string]: unknown;
}

export interface GovernanceOverviewQuery {
  period?: '24h' | '7d' | '30d' | 'custom';
  from?: string;
  to?: string;
  /** IANA (ex.: 'America/Sao_Paulo') — localiza o heatmap por hora. */
  timeZone?: string;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/**
 * Governança / Trilha de Auditoria.
 *
 * **Escrita** (`track`/`tracker`): registra os passos do usuário logado no
 * app parceiro — aparecem no módulo Governança do Adaflow identificados por
 * `App: <nome>`. Qualquer usuário autenticado pode registrar.
 *
 * **Leitura** (`listLogs`/`stats`/`userTimeline`/`governanceOverview`/
 * `exportLogs`): exige JWT de usuário com permissão `platform.audit.read`
 * (perfil admin). 403 → `err.isPermissionError`; mostre "Você não tem acesso
 * à Governança — fale com o administrador da organização."
 */
export class GovernanceResource {
  constructor(private readonly http: HttpTransport) {}

  /**
   * Envio imediato e awaitável (server-side, eventos críticos). Para tracking
   * de UI em volume, prefira `tracker()` (buffered, fail-soft).
   * Idempotente por `eventId` — reenvios contam em `duplicated`.
   */
  async track(event: AuditEventInput | AuditEventInput[], opts: TrackOptions): Promise<TrackResult> {
    const events = (Array.isArray(event) ? event : [event]).map((e) => normalizeEvent(e));
    return this.http.requestJson<TrackResult>('/v1/audit/events/batch', {
      method: 'POST',
      body: buildEventsPayload(events, opts.app),
    });
  }

  /** Tracker buffered (padrão analytics) — ver `AdaflowTracker`. */
  tracker(options: TrackerOptions): AdaflowTracker {
    return new AdaflowTracker(this.http, options);
  }

  async listLogs(query: AuditLogsQuery = {}): Promise<AuditLogsPage> {
    return this.http.requestJson<AuditLogsPage>('/v1/audit/logs', {
      query: query as Record<string, string | number | undefined>,
    });
  }

  async stats(query: { period?: string } = {}): Promise<AuditStats> {
    return this.http.requestJson<AuditStats>('/v1/audit/stats', { query });
  }

  /** Timeline de atividade de um usuário. Valida o UUID client-side (evita 400). */
  async userTimeline(
    userId: string,
    query: { period?: string; bucket?: string; from?: string; to?: string } = {},
  ): Promise<AuditLogsPage> {
    if (!UUID_REGEX.test(userId)) {
      throw new Error(`userId inválido: "${userId}" — a timeline exige um UUID.`);
    }
    return this.http.requestJson<AuditLogsPage>(`/v1/audit/users/${userId}/timeline`, { query });
  }

  /** Dashboard executivo (top users/actions/modules, heatmap, alertas). */
  async governanceOverview(query: GovernanceOverviewQuery = {}): Promise<AuditStats> {
    const timeZone =
      query.timeZone ??
      (typeof Intl !== 'undefined'
        ? Intl.DateTimeFormat().resolvedOptions().timeZone
        : undefined);
    return this.http.requestJson<AuditStats>('/v1/audit/governance/overview', {
      query: { ...query, timeZone },
    });
  }

  /**
   * Export CSV/NDJSON em streaming. Retorna a `Response` crua — no browser,
   * leia como Blob e dispare o download via object URL (nunca `<a href>` cru:
   * o endpoint exige o header Authorization).
   */
  async exportLogs(
    query: AuditLogsQuery & { format?: 'csv' | 'ndjson' } = {},
  ): Promise<Response> {
    return this.http.request('/v1/audit/logs/export', {
      query: query as Record<string, string | number | undefined>,
    });
  }
}
