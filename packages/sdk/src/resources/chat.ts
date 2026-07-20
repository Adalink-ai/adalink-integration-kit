import type { HttpTransport } from '../http.js';
import { parseSse } from '../sse.js';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatParams {
  /**
   * `<gatewayId>` do catálogo (ex.: `anthropic/claude-haiku-4.5`) para chamada
   * genérica, ou `assistant:<uuid>` para conversar com um especialista
   * (RAG, skills, conectores e governança do especialista valem).
   */
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxTokens?: number;
  /**
   * UUID de conversa para histórico server-side. Nos turnos seguintes envie o
   * `chatId` retornado (pode ser diferente do enviado — isolamento de tenant)
   * e apenas a mensagem nova.
   */
  chatId?: string;
}

export interface ChatCompletion {
  id: string;
  object: string;
  choices: Array<{
    index: number;
    message: { role: string; content: string };
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
}

export interface ChatCompletionChunk {
  id: string;
  object: string;
  choices: Array<{
    index: number;
    delta: { role?: string; content?: string };
    finish_reason: string | null;
  }>;
}

export interface ChatResult {
  completion: ChatCompletion;
  /** Conteúdo da primeira choice — atalho para o caso comum. */
  content: string;
  /** Id efetivo da conversa (header x-chat-id) — persista para o próximo turno. */
  chatId?: string;
}

export interface ChatStream extends AsyncIterable<ChatCompletionChunk> {
  /** Id efetivo da conversa (header x-chat-id) — persista para o próximo turno. */
  chatId?: string;
}

const CHAT_PATH = '/v1/openai/chat/completions';

function toBody(params: ChatParams, stream: boolean): Record<string, unknown> {
  return {
    model: params.model,
    messages: params.messages,
    temperature: params.temperature,
    max_tokens: params.maxTokens,
    chat_id: params.chatId,
    stream,
  };
}

/** Chat via API OpenAI-compatible (`/v1/openai`) — genérico ou especialista. */
export class ChatResource {
  constructor(private readonly http: HttpTransport) {}

  /** Completion não-stream. No M1 o campo `usage` vem zerado (billing é assíncrono). */
  async create(params: ChatParams): Promise<ChatResult> {
    const res = await this.http.request(CHAT_PATH, {
      method: 'POST',
      body: toBody(params, false),
    });
    const completion = (await res.json()) as ChatCompletion;
    return {
      completion,
      content: completion.choices[0]?.message.content ?? '',
      chatId: res.headers.get('x-chat-id') ?? undefined,
    };
  }

  /** Completion em streaming — itere os chunks; termina no `[DONE]`. */
  async stream(params: ChatParams): Promise<ChatStream> {
    const res = await this.http.request(CHAT_PATH, {
      method: 'POST',
      body: toBody(params, true),
      stream: true,
    });
    const chatId = res.headers.get('x-chat-id') ?? undefined;

    async function* iterate(): AsyncGenerator<ChatCompletionChunk> {
      for await (const payload of parseSse(res)) {
        if (payload === '[DONE]') return;
        yield JSON.parse(payload) as ChatCompletionChunk;
      }
    }

    const stream = iterate() as AsyncGenerator<ChatCompletionChunk> & { chatId?: string };
    stream.chatId = chatId;
    return stream;
  }

  /** Modelos do catálogo curado, no shape OpenAI. */
  async models(): Promise<Array<{ id: string; object: string; owned_by: string }>> {
    const body = await this.http.requestJson<{ data: Array<{ id: string; object: string; owned_by: string }> }>(
      '/v1/openai/models',
    );
    return body.data;
  }
}
