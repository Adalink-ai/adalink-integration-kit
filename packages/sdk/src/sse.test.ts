import { describe, expect, it } from 'vitest';
import { parseSse } from './sse.js';

function sseResponse(chunks: string[]): Response {
  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  });
  return new Response(stream, { headers: { 'content-type': 'text/event-stream' } });
}

async function collect(res: Response): Promise<string[]> {
  const out: string[] = [];
  for await (const payload of parseSse(res)) out.push(payload);
  return out;
}

describe('parseSse', () => {
  it('emite cada payload data: separado por linha em branco', async () => {
    const res = sseResponse(['data: um\n\ndata: dois\n\n']);
    expect(await collect(res)).toEqual(['um', 'dois']);
  });

  it('junta eventos quebrados no meio por chunks do transporte', async () => {
    const res = sseResponse(['data: {"a"', ':1}\n', '\n', 'data: [DONE]\n\n']);
    expect(await collect(res)).toEqual(['{"a":1}', '[DONE]']);
  });

  it('concatena múltiplas linhas data: do mesmo evento com \\n', async () => {
    const res = sseResponse(['data: linha1\ndata: linha2\n\n']);
    expect(await collect(res)).toEqual(['linha1\nlinha2']);
  });

  it('ignora comentários e campos que não são data:', async () => {
    const res = sseResponse([': ping\nevent: message\nid: 7\ndata: ok\n\n']);
    expect(await collect(res)).toEqual(['ok']);
  });

  it('emite evento final mesmo sem linha em branco terminadora', async () => {
    const res = sseResponse(['data: fim']);
    expect(await collect(res)).toEqual(['fim']);
  });

  it('suporta CRLF', async () => {
    const res = sseResponse(['data: um\r\n\r\n']);
    expect(await collect(res)).toEqual(['um']);
  });
});
