import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { describe, expect, it, vi } from 'vitest';
import { credentialsFromHeaders, createRemoteMcpHandler, type RemoteLogger } from './remote.js';
import { LOCAL_ONLY_TOOLS } from './server.js';

const GATEWAY = 'https://gw.test';
const MCP_URL = 'https://mcp.test/mcp';
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJ1MSJ9.c2ln';
const APP_TOKEN = 'ada_4Xk9mQzLpR2vNhYcTwJ8sBuA1dFgEoC6';

function silentLogger(): RemoteLogger & { info: ReturnType<typeof vi.fn>; error: ReturnType<typeof vi.fn> } {
  return { info: vi.fn(), error: vi.fn() };
}

/** API da Adaflow simulada: registra os headers recebidos e responde por rota. */
function fakeGateway(status = 200) {
  const calls: Array<{ path: string; headers: Headers }> = [];
  const fetchImpl = vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
    const url = new URL(input instanceof Request ? input.url : input.toString());
    calls.push({ path: url.pathname, headers: new Headers(init.headers) });
    if (status !== 200) {
      return new Response(JSON.stringify({ message: 'Unauthorized', statusCode: status }), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    }
    if (url.pathname === '/v1/specialists') {
      return Response.json({ items: [{ id: '0190f7a2-4c1e-7b3d-9a2f-1c2d3e4f5a6b', name: 'Jurídico' }], total: 1 });
    }
    return Response.json({ data: [] });
  });
  return { calls, fetchImpl };
}

/** Cliente MCP de verdade, com o fetch roteado direto para o handler. */
async function connect(headers: Record<string, string>, gatewayStatus = 200) {
  const gateway = fakeGateway(gatewayStatus);
  const logger = silentLogger();
  const handler = createRemoteMcpHandler({ baseUrl: GATEWAY, fetch: gateway.fetchImpl as unknown as typeof fetch, logger });
  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL), {
    requestInit: { headers },
    fetch: (input, init) => handler(new Request(input, init)),
  });
  const client = new Client({ name: 'test', version: '0.0.0' });
  await client.connect(transport);
  return { client, gateway, logger };
}

function text(result: Awaited<ReturnType<Client['callTool']>>): string {
  return (result.content as Array<{ text: string }>)[0]?.text ?? '';
}

describe('credentialsFromHeaders', () => {
  const h = (init: Record<string, string>) => new Headers(init);

  it.each([
    [{ 'x-ada-token': APP_TOKEN }, { appToken: APP_TOKEN }],
    [{ authorization: `Bearer ${APP_TOKEN}` }, { appToken: APP_TOKEN }],
    [{ authorization: `Bearer ${JWT}` }, { jwt: JWT }],
    [{ authorization: `bearer   ${JWT}  ` }, { jwt: JWT }],
    [{ 'x-ada-token': APP_TOKEN, authorization: `Bearer ${APP_TOKEN}` }, { appToken: APP_TOKEN }],
  ])('%j vira %j', (headers, expected) => {
    expect(credentialsFromHeaders(h(headers))).toEqual({ ok: true, credentials: expected });
  });

  it('recusa sem credencial (401) e com duas credenciais diferentes (400)', () => {
    expect(credentialsFromHeaders(h({}))).toMatchObject({ ok: false, status: 401 });
    expect(credentialsFromHeaders(h({ authorization: 'Basic abc' }))).toMatchObject({ ok: false, status: 401 });
    expect(credentialsFromHeaders(h({ 'x-ada-token': APP_TOKEN, authorization: `Bearer ${JWT}` }))).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe('createRemoteMcpHandler', () => {
  it('lista as tools sem as que leem o disco do servidor', async () => {
    const { client } = await connect({ 'x-ada-token': APP_TOKEN });

    const names = (await client.listTools()).tools.map((t) => t.name);

    expect(names).toContain('list_specialists');
    expect(names).toContain('chat');
    for (const local of LOCAL_ONLY_TOOLS) expect(names).not.toContain(local);
  });

  it('chama a API com o token de app em x-ada-token', async () => {
    const { client, gateway } = await connect({ 'x-ada-token': APP_TOKEN });

    const result = await client.callTool({ name: 'list_specialists', arguments: {} });

    expect(result.isError).toBeFalsy();
    expect(text(result)).toContain('Jurídico');
    const call = gateway.calls.find((c) => c.path === '/v1/specialists');
    expect(call?.headers.get('x-ada-token')).toBe(APP_TOKEN);
    expect(call?.headers.get('authorization')).toBeNull();
  });

  it('chama a API com o JWT do usuário em Authorization', async () => {
    const { client, gateway } = await connect({ authorization: `Bearer ${JWT}`, 'x-ada-client': 'v0' });

    await client.callTool({ name: 'list_specialists', arguments: {} });

    const call = gateway.calls.find((c) => c.path === '/v1/specialists');
    expect(call?.headers.get('authorization')).toBe(`Bearer ${JWT}`);
    expect(call?.headers.get('x-ada-token')).toBeNull();
    expect(call?.headers.get('x-ada-client')).toBe('v0');
  });

  it('isola as credenciais entre requisições (nada fica guardado)', async () => {
    const gateway = fakeGateway();
    const handler = createRemoteMcpHandler({ baseUrl: GATEWAY, fetch: gateway.fetchImpl as unknown as typeof fetch, logger: silentLogger() });
    const open = async (headers: Record<string, string>) => {
      const client = new Client({ name: 't', version: '0' });
      await client.connect(
        new StreamableHTTPClientTransport(new URL(MCP_URL), { requestInit: { headers }, fetch: (i, init) => handler(new Request(i, init)) }),
      );
      return client;
    };

    const a = await open({ 'x-ada-token': 'ada_orgA' });
    const b = await open({ 'x-ada-token': 'ada_orgB' });
    await a.callTool({ name: 'list_specialists', arguments: {} });
    await b.callTool({ name: 'list_specialists', arguments: {} });

    const tokens = gateway.calls.filter((c) => c.path === '/v1/specialists').map((c) => c.headers.get('x-ada-token'));
    expect(tokens).toEqual(['ada_orgA', 'ada_orgB']);
  });

  it('traduz 401 da API em erro de tool com dica da conexão remota', async () => {
    const { client } = await connect({ 'x-ada-token': 'ada_revogado' }, 401);

    const result = await client.callTool({ name: 'list_specialists', arguments: {} });

    expect(result.isError).toBe(true);
    expect(text(result)).toContain('conexão MCP');
    expect(text(result)).not.toContain('ADAFLOW_APP_TOKEN');
  });

  it('responde 401 com WWW-Authenticate sem credencial, sem chamar a API', async () => {
    const gateway = fakeGateway();
    const handler = createRemoteMcpHandler({ baseUrl: GATEWAY, fetch: gateway.fetchImpl as unknown as typeof fetch, logger: silentLogger() });

    const res = await handler(
      new Request(MCP_URL, {
        method: 'POST',
        headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
        body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
      }),
    );

    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toContain('Bearer');
    expect(res.headers.get('access-control-allow-origin')).toBe('*');
    expect(gateway.fetchImpl).not.toHaveBeenCalled();
  });

  it('responde 400 com duas credenciais diferentes', async () => {
    const handler = createRemoteMcpHandler({ logger: silentLogger() });
    const res = await handler(
      new Request(MCP_URL, { method: 'POST', headers: { 'x-ada-token': APP_TOKEN, authorization: `Bearer ${JWT}` }, body: '{}' }),
    );
    expect(res.status).toBe(400);
  });

  it('aceita só POST (sem sessão) e responde o preflight de CORS', async () => {
    const handler = createRemoteMcpHandler({ logger: silentLogger() });

    const get = await handler(new Request(MCP_URL, { headers: { 'x-ada-token': APP_TOKEN } }));
    expect(get.status).toBe(405);
    expect(get.headers.get('allow')).toBe('POST, OPTIONS');

    const options = await handler(new Request(MCP_URL, { method: 'OPTIONS' }));
    expect(options.status).toBe(204);
    expect(options.headers.get('access-control-allow-headers')).toContain('x-ada-token');
  });

  it('não registra o token nos logs', async () => {
    const { client, logger } = await connect({ 'x-ada-token': APP_TOKEN });
    await client.callTool({ name: 'list_specialists', arguments: {} });

    const logged = JSON.stringify([...logger.info.mock.calls, ...logger.error.mock.calls]);
    expect(logged).toContain('app_token');
    expect(logged).not.toContain(APP_TOKEN);
  });
});
