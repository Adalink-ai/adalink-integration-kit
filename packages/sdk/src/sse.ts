/**
 * Parser de Server-Sent Events sobre uma Response do fetch.
 * Emite o payload de cada campo `data:` (linhas múltiplas são concatenadas
 * com \n, conforme a spec). Não interpreta o conteúdo — quem consome decide
 * se é JSON, `[DONE]`, etc.
 */
export async function* parseSse(res: Response): AsyncGenerator<string> {
  const body = res.body;
  if (!body) {
    throw new Error('Resposta SSE sem body — verifique o endpoint e o header Accept.');
  }

  const reader = body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = '';
  let dataLines: string[] = [];

  const flush = (): string | undefined => {
    if (dataLines.length === 0) return undefined;
    const payload = dataLines.join('\n');
    dataLines = [];
    return payload;
  };

  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;

      let newlineIndex: number;
      while ((newlineIndex = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, newlineIndex).replace(/\r$/, '');
        buffer = buffer.slice(newlineIndex + 1);

        if (line === '') {
          const payload = flush();
          if (payload !== undefined) yield payload;
        } else if (line.startsWith('data:')) {
          dataLines.push(line.slice(5).replace(/^ /, ''));
        }
        // demais campos (event:, id:, retry:, comentários ':') são ignorados
      }
    }
    // linha final sem \n terminador ainda está no buffer
    const residual = buffer.replace(/\r$/, '');
    if (residual.startsWith('data:')) {
      dataLines.push(residual.slice(5).replace(/^ /, ''));
    }
    const payload = flush();
    if (payload !== undefined) yield payload;
  } finally {
    reader.releaseLock();
  }
}
