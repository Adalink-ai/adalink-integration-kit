import { HttpTransport, type AdalinkClientOptions } from './http.js';
import { AgentsResource } from './resources/agents.js';
import { BillingResource } from './resources/billing.js';
import { ChatResource } from './resources/chat.js';
import { RepositoriesResource } from './resources/repositories.js';
import { SpecialistsResource } from './resources/specialists.js';

export type { AdalinkClientOptions, TokenProvider } from './http.js';
export { DEFAULT_BASE_URL } from './http.js';
export { AdalinkApiError } from './errors.js';
export { buildHandoffUrl, consumeSsoToken } from './sso.js';
export type { ConsumeSsoTokenOptions } from './sso.js';
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
 * Client oficial da plataforma Adalink/Adaflow.
 *
 * ```ts
 * import { AdalinkClient } from '@adalink/sdk';
 *
 * // Com usuário logado (preferido): JWT do SSO handoff
 * const client = new AdalinkClient({ jwt: () => sessionStorage.getItem('adalink:jwt')! });
 *
 * // Server-to-server: app token (enviado como x-ada-token)
 * const s2s = new AdalinkClient({ appToken: process.env.ADALINK_APP_TOKEN! });
 *
 * const { content } = await client.chat.create({
 *   model: 'assistant:<uuid-do-especialista>',
 *   messages: [{ role: 'user', content: 'Resuma o contrato.' }],
 * });
 * ```
 */
export class AdalinkClient {
  readonly chat: ChatResource;
  readonly agents: AgentsResource;
  readonly specialists: SpecialistsResource;
  readonly repositories: RepositoriesResource;
  readonly billing: BillingResource;

  constructor(options: AdalinkClientOptions) {
    const http = new HttpTransport(options);
    const fetchImpl = options.fetch ?? fetch;
    this.chat = new ChatResource(http);
    this.agents = new AgentsResource(http);
    this.specialists = new SpecialistsResource(http);
    this.repositories = new RepositoriesResource(http, fetchImpl);
    this.billing = new BillingResource(http);
  }
}
