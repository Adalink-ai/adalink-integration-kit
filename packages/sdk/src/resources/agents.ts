import type { HttpTransport } from '../http.js';
import { parseSse } from '../sse.js';

export interface AutonomousAgent {
  id: string;
  name: string;
  description?: string;
  type?: string;
  model?: string;
  [key: string]: unknown;
}

export interface ExecuteAgentParams {
  /** Mensagem/comando para o agente (máx. 50.000 caracteres). */
  input: string;
  /** Reenvie o mesmo valor para manter contexto entre execuções. */
  threadId?: string;
}

export interface AgentExecution {
  id: string;
  agentId: string;
  input: string;
  output: string;
  threadId?: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'cancelled';
  error?: string | null;
}

export interface Paginated<T> {
  data: T[];
  total?: number;
  page?: number;
  limit?: number;
}

const BASE = '/v1/autonomous-agents';

/** Agentes autônomos (`/v1/autonomous-agents`). Requer permissão `autonomous-agents.execute` para executar. */
export class AgentsResource {
  constructor(private readonly http: HttpTransport) {}

  async list(query?: { page?: number; limit?: number; search?: string }): Promise<Paginated<AutonomousAgent>> {
    return this.http.requestJson<Paginated<AutonomousAgent>>(BASE, { query });
  }

  async get(agentId: string): Promise<AutonomousAgent> {
    return this.http.requestJson<AutonomousAgent>(`${BASE}/${agentId}`);
  }

  /** Execução síncrona — responde ao final. */
  async execute(agentId: string, params: ExecuteAgentParams): Promise<AgentExecution> {
    return this.http.requestJson<AgentExecution>(`${BASE}/${agentId}/execute`, {
      method: 'POST',
      body: params,
    });
  }

  /** Execução com streaming SSE — itere os chunks (JSON) conforme chegam. */
  async *stream(agentId: string, params: ExecuteAgentParams): AsyncGenerator<unknown> {
    const res = await this.http.request(`${BASE}/${agentId}/stream`, {
      query: { input: params.input, threadId: params.threadId },
      stream: true,
    });
    for await (const payload of parseSse(res)) {
      yield JSON.parse(payload) as unknown;
    }
  }
}
