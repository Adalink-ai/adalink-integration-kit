import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHandler, type HandlerDeps } from '../base44/functions/adaflow/entry.ts';

const SPECIALIST = '0190f7a2-4c1e-7b3d-9a2f-1c2d3e4f5a6b';
const AGENT = '0190f7a2-4c1e-7b3d-9a2f-aaaaaaaaaaaa';

let secrets: Record<string, string>;

beforeEach(() => {
  secrets = { ADAFLOW_APP_TOKEN: 'tok_test' };
  Object.defineProperty(globalThis, 'Base44', {
    value: { secrets: { get: (name: string) => secrets[name] } },
    configurable: true,
  });
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  Reflect.deleteProperty(globalThis, 'Base44');
  vi.restoreAllMocks();
});

function setup(response: Response = Response.json({ ok: true }), user: { id: string } | null = { id: 'u1' }) {
  const fetch = vi.fn(async () => response);
  const deps: HandlerDeps = { fetch: fetch as unknown as typeof globalThis.fetch, currentUser: async () => user };
  return { handler: createHandler(deps), fetch };
}

function post(body: unknown): Request {
  return new Request('https://app.base44.app/functions/adaflow', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function upstreamCall(fetch: ReturnType<typeof vi.fn>): { url: URL; init: RequestInit & { headers: Record<string, string> } } {
  const [url, init] = fetch.mock.calls[0] as [URL, RequestInit & { headers: Record<string, string> }];
  return { url, init };
}

describe('Backend Function adaflow (Base44)', () => {
  it('lista especialistas com o token no header e sem expor o token na resposta', async () => {
    const { handler, fetch } = setup(Response.json({ items: [{ id: SPECIALIST, name: 'Jurídico' }] }));

    const res = await handler(post({ action: 'listSpecialists', limit: 10, search: 'jur' }));

    expect(res.status).toBe(200);
    const { url, init } = upstreamCall(fetch);
    expect(url.toString()).toBe('https://zeus.adalink.app/v1/specialists?limit=10&search=jur');
    expect(init.method).toBe('GET');
    expect(init.headers['x-ada-token']).toBe('tok_test');
    expect(init.headers['x-ada-client']).toBe('base44');
    const text = await res.text();
    expect(text).toContain('Jurídico');
    expect(text).not.toContain('tok_test');
  });

  it('usa ADAFLOW_BASE_URL para gateway private label', async () => {
    secrets.ADAFLOW_BASE_URL = 'https://api.cliente.com.br/';
    const { handler, fetch } = setup();

    await handler(post({ action: 'listModels' }));

    expect(upstreamCall(fetch).url.toString()).toBe('https://api.cliente.com.br/v1/openai/models');
  });

  it('converte specialistId em model assistant:<id> e repassa o x-chat-id', async () => {
    const upstream = Response.json({ id: 'c1', choices: [] }, { headers: { 'x-chat-id': 'chat-9' } });
    const { handler, fetch } = setup(upstream);

    const res = await handler(
      post({ action: 'chat', specialistId: SPECIALIST, messages: [{ role: 'user', content: 'Oi' }], maxTokens: 200 }),
    );

    expect(res.headers.get('x-chat-id')).toBe('chat-9');
    const { url, init } = upstreamCall(fetch);
    expect(url.pathname).toBe('/v1/openai/chat/completions');
    expect(JSON.parse(init.body as string)).toEqual({
      model: `assistant:${SPECIALIST}`,
      messages: [{ role: 'user', content: 'Oi' }],
      max_tokens: 200,
      stream: false,
    });
  });

  it('repassa o fluxo SSE do chat sem bufferizar', async () => {
    const sse = new Response('data: {"choices":[]}\n\ndata: [DONE]\n\n', {
      headers: { 'Content-Type': 'text/event-stream' },
    });
    const { handler, fetch } = setup(sse);

    const res = await handler(post({ action: 'chat', model: 'anthropic/claude-haiku-4.5', messages: [{ role: 'user', content: 'Oi' }], stream: true }));

    expect(res.headers.get('Content-Type')).toBe('text/event-stream');
    expect(upstreamCall(fetch).init.headers.Accept).toBe('text/event-stream');
    expect(await res.text()).toContain('[DONE]');
  });

  it('executa agente síncrono e em streaming', async () => {
    const sync = setup(Response.json({ id: 'e1', status: 'completed' }));
    await sync.handler(post({ action: 'runAgent', agentId: AGENT, input: 'Resuma', threadId: 't1' }));
    expect(upstreamCall(sync.fetch).url.pathname).toBe(`/v1/autonomous-agents/${AGENT}/execute`);
    expect(JSON.parse(upstreamCall(sync.fetch).init.body as string)).toEqual({ input: 'Resuma', threadId: 't1' });

    const streamed = setup(new Response('data: {}\n\n'));
    await streamed.handler(post({ action: 'runAgent', agentId: AGENT, input: 'Resuma', stream: true }));
    const { url, init } = upstreamCall(streamed.fetch);
    expect(url.pathname).toBe(`/v1/autonomous-agents/${AGENT}/stream`);
    expect(url.searchParams.get('input')).toBe('Resuma');
    expect(init.method).toBe('GET');
  });

  it('carimba o app da governança pelo secret, ignorando o que vem do navegador', async () => {
    secrets.ADAFLOW_APP_SLUG = 'portal-vendas';
    const { handler, fetch } = setup(Response.json({ accepted: 1, duplicated: 0, rejected: [] }));

    await handler(post({ action: 'trackEvents', events: [{ action: 'app.pedido.criado', resource: 'Pedido', app: 'forjado' }] }));

    const sent = JSON.parse(upstreamCall(fetch).init.body as string) as { events: Array<{ app: string; eventId: string }> };
    expect(sent.events[0]?.app).toBe('portal-vendas');
    expect(sent.events[0]?.eventId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('exige usuário logado, a menos que ADAFLOW_ALLOW_ANONYMOUS seja true', async () => {
    const anon = setup(undefined, null);
    const res = await anon.handler(post({ action: 'listModels' }));
    expect(res.status).toBe(401);
    expect(anon.fetch).not.toHaveBeenCalled();

    secrets.ADAFLOW_ALLOW_ANONYMOUS = 'true';
    const open = setup(undefined, null);
    expect((await open.handler(post({ action: 'listModels' }))).status).toBe(200);
  });

  it('responde 500 amigável quando falta o secret do token', async () => {
    delete secrets.ADAFLOW_APP_TOKEN;
    const { handler, fetch } = setup();

    const res = await handler(post({ action: 'listModels' }));

    expect(res.status).toBe(500);
    expect((await res.json()).error.code).toBe('not_configured');
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [{ action: 'apagarTudo' }, 'unknown_action'],
    [{ action: 'toString' }, 'unknown_action'],
    [{ action: 'runAgent', agentId: '../admin', input: 'x' }, 'invalid_request'],
    [{ action: 'chat', model: 'x', messages: [] }, 'invalid_request'],
    [{ action: 'chat', model: 'x', messages: [{ role: 'tool', content: 'x' }] }, 'invalid_request'],
    [{ action: 'runAgent', agentId: AGENT, input: 'x'.repeat(50_001) }, 'invalid_request'],
    [{ action: 'trackEvents', events: [{ action: 'pedido.criado', resource: 'Pedido' }] }, 'invalid_request'],
  ])('rejeita entrada inválida sem chamar a API: %j', async (body, code) => {
    const { handler, fetch } = setup();

    const res = await handler(post(body));

    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe(code);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('aceita só POST', async () => {
    const { handler } = setup();
    const res = await handler(new Request('https://app.base44.app/functions/adaflow'));
    expect(res.status).toBe(405);
  });

  it.each([
    [401, { message: 'Unauthorized' }, 'adaflow_auth'],
    [429, { error: { message: 'Saldo zerado', code: 'insufficient_quota' } }, 'insufficient_quota'],
    [429, { error: { message: 'slow down', code: 'rate_limit_exceeded' } }, 'rate_limited'],
    [503, { message: 'upstream down' }, 'adaflow_unavailable'],
  ])('traduz HTTP %i da API sem vazar o corpo técnico', async (status, payload, code) => {
    const { handler } = setup(Response.json(payload, { status }));

    const res = await handler(post({ action: 'listModels' }));
    const body = await res.json();

    expect(res.status).toBe(status);
    expect(body.error.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain('upstream down');
    expect(console.error).toHaveBeenCalled();
  });

  it('responde 502 amigável quando a rede falha', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const handler = createHandler({ fetch: fetch as unknown as typeof globalThis.fetch, currentUser: async () => ({ id: 'u1' }) });

    const res = await handler(post({ action: 'listModels' }));

    expect(res.status).toBe(502);
    expect((await res.json()).error.code).toBe('adaflow_unreachable');
  });
});
