/**
 * Proxy do chat genérico: recebe o histórico do browser (com o JWT do usuário
 * no Authorization) e repassa ao Adaflow via @adaflow/sdk, devolvendo os
 * deltas de texto em streaming. O `x-chat-id` retornado permite continuar a
 * conversa server-side enviando só a mensagem nova nos próximos turnos.
 */
import { AdaflowApiError, AdaflowClient, type ChatMessage } from '@adaflow/sdk';
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const MODEL = process.env.ADAFLOW_MODEL ?? 'anthropic/claude-haiku-4.5';

interface ChatRequestBody {
  messages?: ChatMessage[];
  chatId?: string;
}

export async function POST(req: NextRequest) {
  const auth = req.headers.get('authorization');
  const jwt = auth?.startsWith('Bearer ') ? auth.slice(7) : undefined;
  if (!jwt) {
    return Response.json(
      { message: 'Sessão ausente — entre com o Adaflow para conversar.' },
      { status: 401 },
    );
  }

  const body = (await req.json().catch(() => ({}))) as ChatRequestBody;
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return Response.json({ message: 'Envie ao menos uma mensagem.' }, { status: 400 });
  }

  const client = new AdaflowClient({ jwt, baseUrl: process.env.ADAFLOW_BASE_URL });

  try {
    const stream = await client.chat.stream({
      model: MODEL,
      messages: body.messages,
      chatId: body.chatId,
    });

    const encoder = new TextEncoder();
    const responseBody = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const chunk of stream) {
            const delta = chunk.choices[0]?.delta.content;
            if (delta) controller.enqueue(encoder.encode(delta));
          }
          controller.close();
        } catch (err) {
          console.error('[api/chat] stream interrompido', err);
          controller.error(err);
        }
      },
    });

    return new Response(responseBody, {
      headers: {
        'content-type': 'text/plain; charset=utf-8',
        ...(stream.chatId ? { 'x-chat-id': stream.chatId } : {}),
      },
    });
  } catch (err) {
    if (err instanceof AdaflowApiError) {
      // Log técnico completo no servidor; mensagem amigável pt-BR para a UI.
      console.error('[api/chat] erro da plataforma', err.status, err.code, err.message);
      const message = err.isInsufficientQuota
        ? 'A organização está sem saldo de créditos — fale com o administrador.'
        : err.isAuthError
          ? 'Sessão expirada — entre novamente com o Adaflow.'
          : err.isRateLimit
            ? 'Muitas requisições no momento — aguarde alguns segundos e tente de novo.'
            : 'Não foi possível falar com a plataforma agora. Tente novamente.';
      return Response.json({ message, code: err.code }, { status: err.status });
    }
    console.error('[api/chat] erro inesperado', err);
    return Response.json({ message: 'Erro inesperado no servidor.' }, { status: 500 });
  }
}
