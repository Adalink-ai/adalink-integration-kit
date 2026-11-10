/**
 * Chat com um especialista ou modelo da Adaflow, em streaming.
 *
 * POST { specialistId? | model?, messages, chatId? }
 *   -> text/plain com o texto da resposta, pedaço a pedaço.
 *      Header x-chat-id: id da conversa; reenvie como chatId com só a
 *      mensagem nova para continuar.
 */
import type { ChatMessage } from '@adaflow/sdk';
import {
  adaflowErrorResponse,
  errorResponse,
  getAdaflowClient,
  isUuid,
  notConfiguredResponse,
} from '@/lib/adaflow-server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const DEFAULT_MODEL = 'anthropic/claude-haiku-4.5';
const MAX_MESSAGES = 100;
const MAX_CONTENT_CHARS = 50_000;
const ROLES = new Set(['system', 'user', 'assistant']);

interface ChatBody {
  specialistId?: unknown;
  model?: unknown;
  messages?: unknown;
  chatId?: unknown;
}

function parseMessages(value: unknown): ChatMessage[] | null {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_MESSAGES) return null;
  const messages: ChatMessage[] = [];
  for (const item of value) {
    const m = item as { role?: unknown; content?: unknown };
    if (typeof m?.role !== 'string' || !ROLES.has(m.role)) return null;
    if (typeof m.content !== 'string' || m.content.length > MAX_CONTENT_CHARS) return null;
    messages.push({ role: m.role as ChatMessage['role'], content: m.content });
  }
  return messages;
}

export async function POST(req: Request) {
  const client = getAdaflowClient();
  if (!client) return notConfiguredResponse();

  const body = (await req.json().catch(() => null)) as ChatBody | null;
  if (!body) return errorResponse(400, 'invalid_request', 'O corpo da requisição deve ser JSON.');

  const messages = parseMessages(body.messages);
  if (!messages) {
    return errorResponse(
      400,
      'invalid_request',
      `Envie de 1 a ${MAX_MESSAGES} mensagens, cada uma com role (system, user ou assistant) e content em texto.`,
    );
  }
  if (body.specialistId !== undefined && !isUuid(body.specialistId)) {
    return errorResponse(400, 'invalid_request', 'specialistId deve ser um UUID.');
  }
  if (body.chatId !== undefined && !isUuid(body.chatId)) {
    return errorResponse(400, 'invalid_request', 'chatId deve ser um UUID.');
  }
  if (body.model !== undefined && typeof body.model !== 'string') {
    return errorResponse(400, 'invalid_request', 'model deve ser texto.');
  }

  const model = body.specialistId ? `assistant:${body.specialistId}` : ((body.model as string | undefined) ?? DEFAULT_MODEL);

  try {
    const stream = await client.chat.stream({ model, messages, chatId: body.chatId as string | undefined });
    const encoder = new TextEncoder();
    const text = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta.content;
            if (delta) controller.enqueue(encoder.encode(delta));
          }
          controller.close();
        } catch (err) {
          console.error('[adaflow] chat: stream interrompido', err);
          controller.error(err);
        }
      },
    });
    return new Response(text, {
      headers: {
        'Content-Type': 'text/plain; charset=utf-8',
        'Cache-Control': 'no-cache',
        ...(stream.chatId ? { 'x-chat-id': stream.chatId } : {}),
      },
    });
  } catch (err) {
    return adaflowErrorResponse(err, 'chat');
  }
}
