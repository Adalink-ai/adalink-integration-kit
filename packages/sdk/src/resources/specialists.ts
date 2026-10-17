import type { HttpTransport } from '../http.js';

export interface Specialist {
  id: string;
  name: string;
  description?: string;
  slug?: string;
  [key: string]: unknown;
}

const BASE = '/v1/specialists';

/** Especialistas (`/v1/specialists`) — descoberta do UUID para o modo `assistant:<uuid>`. */
export class SpecialistsResource {
  constructor(private readonly http: HttpTransport) {}

  async list(query?: { page?: number; limit?: number; search?: string }): Promise<unknown> {
    return this.http.requestJson<unknown>(BASE, { query });
  }

  async get(specialistId: string): Promise<Specialist> {
    return this.http.requestJson<Specialist>(`${BASE}/${specialistId}`);
  }

  /**
   * Vincula um repositório de conhecimento ao especialista: os arquivos passam
   * a compor o RAG dele, no chat do Adaflow e nas chamadas `assistant:<uuid>`
   * via `/v1/openai` (que aplicam o `ragEnabled` do especialista).
   * `409` = já vinculado; `404` = repositório não visível (anti-IDOR).
   * Exige a permissão `knowledge.repositories.share`.
   */
  async linkRepository(specialistId: string, repositoryId: string): Promise<{ success: boolean }> {
    return this.http.requestJson<{ success: boolean }>(`${BASE}/${specialistId}/repositories`, {
      method: 'POST',
      body: { repositoryId },
    });
  }

  /** Desfaz o vínculo do repositório com o especialista (os arquivos saem do RAG dele). `404` = já não estava vinculado. */
  async unlinkRepository(specialistId: string, repositoryId: string): Promise<void> {
    await this.http.request(`${BASE}/${encodeURIComponent(specialistId)}/repositories/${encodeURIComponent(repositoryId)}`, { method: 'DELETE' });
  }

  /** Lista os repositórios vinculados ao especialista. */
  async repositories(specialistId: string): Promise<{ repositories: unknown[] }> {
    return this.http.requestJson<{ repositories: unknown[] }>(`${BASE}/${specialistId}/repositories`);
  }
}
