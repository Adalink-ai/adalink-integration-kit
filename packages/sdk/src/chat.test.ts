import { describe, expect, it, vi } from 'vitest';
import { HttpTransport } from './http.js';
import { ChatResource } from './resources/chat.js';

function sseResponse(events: string[]): Response {
  const encoder = new TextEncoder();
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const event of events) controller.enqueue(encoder.encode(`data: ${event}\n\n`));
      controller.close();
    },
  });
  return new Response(body, {
    headers: { 'content-type': 'text/event-stream', 'x-chat-id': 'chat-efetivo' },
  });
}

function chatWith(response: Response) {
  const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) => response);
  const chat = new ChatResource(
    new HttpTransport({ appToken: 'token', fetch: fetchMock as unknown as typeof fetch }),
  );
  const sentBody = () => JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
  return { chat, sentBody };
}

describe('ChatResource.stream — include_usage', () => {
  it('envia stream_options.include_usage e entrega o chunk final de usage', async () => {
    const usage = { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 };
    const { chat, sentBody } = chatWith(
      sseResponse([
        JSON.stringify({ id: 'c', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: 'oi' }, finish_reason: 'stop' }] }),
        JSON.stringify({ id: 'c', object: 'chat.completion.chunk', choices: [], usage }),
        '[DONE]',
      ]),
    );

    const stream = await chat.stream({
      model: 'anthropic/claude-haiku-4.5',
      messages: [{ role: 'user', content: 'oi' }],
      includeUsage: true,
    });
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);

    expect(sentBody()).toMatchObject({ stream: true, stream_options: { include_usage: true } });
    expect(chunks.at(-1)).toMatchObject({ choices: [], usage });
    expect(stream.chatId).toBe('chat-efetivo');
  });

  it('sem includeUsage, não envia stream_options', async () => {
    const { chat, sentBody } = chatWith(sseResponse(['[DONE]']));

    const stream = await chat.stream({
      model: 'anthropic/claude-haiku-4.5',
      messages: [{ role: 'user', content: 'oi' }],
    });
    for await (const _ of stream) {
      // drena
    }

    expect(sentBody()).not.toHaveProperty('stream_options');
  });

  it('create() nunca envia stream_options, mesmo com includeUsage', async () => {
    const { chat, sentBody } = chatWith(
      Response.json({ id: 'c', object: 'chat.completion', choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }] }),
    );

    const result = await chat.create({
      model: 'anthropic/claude-haiku-4.5',
      messages: [{ role: 'user', content: 'oi' }],
      includeUsage: true,
    });

    expect(result.content).toBe('ok');
    expect(sentBody()).toMatchObject({ stream: false });
    expect(sentBody()).not.toHaveProperty('stream_options');
  });
});
