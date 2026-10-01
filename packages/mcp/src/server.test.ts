import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { AdaflowClient } from '@adaflow/sdk';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { describe, expect, it, vi } from 'vitest';
import { clientOptionsFromEnv, createAdaflowMcpServer, guessContentType, type ClientSource } from './server.js';

const BASE = 'https://gw.test';

type Handler = (url: URL, init: RequestInit) => Response | Promise<Response>;

function json(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    ...init,
    headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  });
}

function mockFetch(handler: Handler) {
  return vi.fn(async (input: string | URL | Request, init: RequestInit = {}) =>
    handler(new URL(input instanceof Request ? input.url : input.toString()), init),
  );
}

async function connect(source: ClientSource) {
  const server = createAdaflowMcpServer(source);
  const [clientT, serverT] = InMemoryTransport.createLinkedPair();
  await server.connect(serverT);
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(clientT);
  return client;
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  const first = (result.content as Array<{ type: string; text: string }>)[0];
  return first?.text ?? '';
}

describe('clientOptionsFromEnv', () => {
  it('prefere JWT ao app token e ignora valores vazios', () => {
    expect(clientOptionsFromEnv({ ADAFLOW_JWT: 'j', ADAFLOW_APP_TOKEN: 'a' })).toMatchObject({ jwt: 'j' });
    expect(clientOptionsFromEnv({ ADAFLOW_JWT: '  ', ADAFLOW_APP_TOKEN: 'a' })).toMatchObject({ appToken: 'a' });
    expect(clientOptionsFromEnv({ ADA_TOKEN: 'alias' })).toMatchObject({ appToken: 'alias' });
    const none = clientOptionsFromEnv({ ADAFLOW_BASE_URL: '' });
    expect(none).not.toHaveProperty('jwt');
    expect(none).not.toHaveProperty('appToken');
    expect(none.baseUrl).toBeUndefined();
  });
});

describe('guessContentType', () => {
  it('infere pela extensão, sem diferenciar caixa', () => {
    expect(guessContentType('contrato.PDF')).toBe('application/pdf');
    expect(guessContentType('x.unknown')).toBe('application/octet-stream');
  });
});

describe('servidor MCP', () => {
  it('expõe o catálogo de tools esperado', async () => {
    const client = await connect(() => {
      throw new Error('não deveria instanciar');
    });
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(
      [
        'billing',
        'chat',
        'create_repository',
        'execute_agent',
        'get_specialist',
        'governance_overview',
        'list_agents',
        'list_audit_logs',
        'list_models',
        'list_repository_files',
        'list_specialists',
        'upload_document',
      ].sort(),
    );
    expect(tools.find((t) => t.name === 'list_specialists')?.annotations?.readOnlyHint).toBe(true);
  });

  it('chat envia assistant:<uuid>, devolve conteúdo e chatId', async () => {
    const fetch = mockFetch(async (url, init) => {
      expect(url.pathname).toBe('/v1/openai/chat/completions');
      const body = JSON.parse(String(init.body)) as { model: string; messages: unknown[] };
      expect(body.model).toBe('assistant:abc');
      expect(body.messages).toEqual([{ role: 'user', content: 'Oi' }]);
      return json(
        {
          id: 'c1',
          object: 'chat.completion',
          created: 0,
          model: 'assistant:abc',
          choices: [{ index: 0, message: { role: 'assistant', content: 'Olá!' }, finish_reason: 'stop' }],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 },
        },
        { headers: { 'x-chat-id': 'chat-9' } },
      );
    });
    const client = await connect(new AdaflowClient({ appToken: 't', baseUrl: BASE, fetch, retry: false }));
    const result = await client.callTool({ name: 'chat', arguments: { model: 'assistant:abc', message: 'Oi' } });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toMatchObject({ content: 'Olá!', chatId: 'chat-9' });
  });

  it('upload_document faz presign → PUT → confirm com o arquivo local', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'adaflow-mcp-'));
    const file = join(dir, 'nota.md');
    writeFileSync(file, '# oi');
    const calls: string[] = [];
    const fetch = mockFetch(async (url, init) => {
      calls.push(`${init.method ?? 'GET'} ${url.host === 'storage.test' ? 'storage' : url.pathname}`);
      if (url.pathname.endsWith('/files/presign')) {
        const body = JSON.parse(String(init.body)) as Record<string, unknown>;
        expect(body).toEqual({ fileName: 'nota.md', contentType: 'text/markdown', fileSize: 4 });
        return json({ fileId: 'f1', presignedUrl: 'https://storage.test/up', storageKey: 'k' });
      }
      if (url.host === 'storage.test') return new Response(null, { status: 200 });
      return json({ ok: true });
    });
    const client = await connect(new AdaflowClient({ appToken: 't', baseUrl: BASE, fetch, retry: false }));
    const result = await client.callTool({
      name: 'upload_document',
      arguments: { repositoryId: 'r1', filePath: file },
    });
    expect(result.isError).toBeFalsy();
    expect(JSON.parse(text(result))).toMatchObject({ fileId: 'f1', bytes: 4 });
    expect(calls).toEqual(['POST /v1/repositories/r1/files/presign', 'PUT storage', 'POST /v1/repositories/r1/files/confirm']);
  });

  it('erro de API vira isError com dica de credencial', async () => {
    const fetch = mockFetch(async () =>
      json({ error: { message: 'Invalid token', type: 'auth', code: 'invalid_api_key' } }, { status: 401 }),
    );
    const client = await connect(new AdaflowClient({ appToken: 't', baseUrl: BASE, fetch, retry: false }));
    const result = await client.callTool({ name: 'billing', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/401/);
    expect(text(result)).toMatch(/ADAFLOW_APP_TOKEN/);
  });

  it('sem credencial, a tool explica o que falta em vez de derrubar o servidor', async () => {
    const client = await connect(() => new AdaflowClient(clientOptionsFromEnv({})));
    const result = await client.callTool({ name: 'list_models', arguments: {} });
    expect(result.isError).toBe(true);
    expect(text(result)).toMatch(/ADAFLOW_APP_TOKEN/);
  });
});
