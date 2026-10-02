import { HttpTransport, type AdaflowClientOptions } from './http.js';
import { AgentsResource } from './resources/agents.js';
import { BillingResource } from './resources/billing.js';
import { ChatResource } from './resources/chat.js';
import { DocumentsResource } from './resources/documents.js';
import { GovernanceResource } from './resources/governance.js';
import { RepositoriesResource } from './resources/repositories.js';
import { SpecialistsResource } from './resources/specialists.js';
import { TelemetryResource } from './resources/telemetry.js';

export type { AdaflowClientOptions, CallOptions, RetryOptions, TokenProvider } from './http.js';
export { DEFAULT_BASE_URL, resolveBaseUrl } from './http.js';
export { AdaflowApiError } from './errors.js';
export { buildHandoffUrl, consumeSsoToken } from './sso.js';
export type { ConsumeSsoTokenOptions } from './sso.js';
export { createSsoSession, readJwtExpMs } from './sso-session.js';
export type { SsoSession, SsoSessionOptions } from './sso-session.js';
export { createJwtVerifier, AdaflowTokenError } from './jwt-verifier.js';
export type {
  AdaflowIdentity,
  AdaflowTokenErrorCode,
  JwtVerifier,
  JwtVerifierOptions,
} from './jwt-verifier.js';
export {
  ACCESS_EVENTS,
  AUDIT_EVENT_NAMESPACE,
  buildAccessEvent,
  defineAuditEvents,
  recordAppAccess,
  uuidV5,
} from './audit-catalog.js';
export type {
  AccessOutcome,
  AppAccessInput,
  AppAccessResult,
  AuditCatalog,
  AuditEventSpec,
  BuildAuditEventInput,
} from './audit-catalog.js';
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
  ChatUsage,
} from './resources/chat.js';
export type {
  AutonomousAgent,
  ExecuteAgentParams,
  AgentExecution,
  Paginated,
} from './resources/agents.js';
export type { Specialist } from './resources/specialists.js';
export { isDocumentSettled, MAX_DOCUMENT_UPLOAD_BYTES } from './resources/documents.js';
export type {
  AdaflowDocument,
  ConfirmDocumentParams,
  DocumentMediaContent,
  DocumentPageImage,
  DocumentThumbnail,
  ExtractionMethod,
  ExtractionStatus,
  ImportFromProviderParams,
  ImportFromProviderResult,
  IndexingStatus,
  ListDocumentsQuery,
  MediaFrame,
  PresignDocumentParams,
  PresignedDocumentUpload,
  TranscriptUtterance,
  UploadDocumentFileParams,
  WaitForDocumentOptions,
} from './resources/documents.js';
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
  readonly documents: DocumentsResource;
  readonly billing: BillingResource;
  readonly governance: GovernanceResource;
  readonly telemetry: TelemetryResource;

  constructor(options: AdaflowClientOptions = {}) {
    const http = new HttpTransport(options);
    // bind(globalThis): fetch do browser exige this === window (Illegal invocation)
    const fetchImpl = (options.fetch ?? fetch).bind(globalThis);
    this.chat = new ChatResource(http);
    this.agents = new AgentsResource(http);
    this.specialists = new SpecialistsResource(http);
    this.repositories = new RepositoriesResource(http, fetchImpl);
    this.documents = new DocumentsResource(http, fetchImpl);
    this.billing = new BillingResource(http);
    this.governance = new GovernanceResource(http);
    this.telemetry = new TelemetryResource(http);
  }
}
