import { HttpTransport, type AdaflowClientOptions } from './http.js';
import { AgentsResource } from './resources/agents.js';
import { BillingResource } from './resources/billing.js';
import { ChatResource } from './resources/chat.js';
import { GovernanceResource } from './resources/governance.js';
import { RepositoriesResource } from './resources/repositories.js';
import { SpecialistsResource } from './resources/specialists.js';
import { TelemetryResource } from './resources/telemetry.js';

export type { AdaflowClientOptions, TokenProvider } from './http.js';
export { DEFAULT_BASE_URL, resolveBaseUrl } from './http.js';
export { AdaflowApiError } from './errors.js';
export { buildHandoffUrl, consumeSsoToken } from './sso.js';
export type { ConsumeSsoTokenOptions } from './sso.js';
export { AdaflowTracker } from './tracker.js';
export type { TrackerOptions } from './tracker.js';
export type { AuditEventInput, AuditSeverity } from './tracker-core.js';
export { startSessionTracking } from './session-tracking.js';
export type { SessionTrackingHandle, SessionTrackingOptions } from './session-tracking.js';
export type {
  AuditLogItem,
  AuditLogsPage,
  AuditLogsQuery,
  AuditStats,
  GovernanceOverviewQuery,
  TrackOptions,
  TrackResult,
} from './resources/governance.js';
export type { PageView } from './resources/telemetry.js';
export type {
  ChatMessage,
  ChatParams,
  ChatCompletion,
  ChatCompletionChunk,
  ChatResult,
  ChatStream,
} from './resources/chat.js';
export type {
  AutonomousAgent,
  ExecuteAgentParams,
  AgentExecution,
  Paginated,
} from './resources/agents.js';
export type { Specialist } from './resources/specialists.js';
export type {
  CreateRepositoryParams,
  Repository,
  RepositoryVisibility,
  PresignResult,
  UploadDocumentParams,
} from './resources/repositories.js';

/**
 * Client oficial da plataforma Adaflow.
 *
 * ```ts
 * import { AdaflowClient } from '@adaflow/sdk';
 *
 * // Com usuário logado (preferido): JWT do SSO handoff
 * const client = new AdaflowClient({ jwt: () => sessionStorage.getItem('adaflow:jwt')! });
 *
 * // Server-to-server: app token (enviado como x-ada-token)
 * const s2s = new AdaflowClient({ appToken: process.env.ADAFLOW_APP_TOKEN! });
 *
 * const { content } = await client.chat.create({
 *   model: 'assistant:<uuid-do-especialista>',
 *   messages: [{ role: 'user', content: 'Resuma o contrato.' }],
 * });
 * ```
 */
export class AdaflowClient {
  readonly chat: ChatResource;
  readonly agents: AgentsResource;
  readonly specialists: SpecialistsResource;
  readonly repositories: RepositoriesResource;
  readonly billing: BillingResource;
  readonly governance: GovernanceResource;
  readonly telemetry: TelemetryResource;

  constructor(options: AdaflowClientOptions = {}) {
    const http = new HttpTransport(options);
    const fetchImpl = options.fetch ?? fetch;
    this.chat = new ChatResource(http);
    this.agents = new AgentsResource(http);
    this.specialists = new SpecialistsResource(http);
    this.repositories = new RepositoriesResource(http, fetchImpl);
    this.billing = new BillingResource(http);
    this.governance = new GovernanceResource(http);
    this.telemetry = new TelemetryResource(http);
  }
}
