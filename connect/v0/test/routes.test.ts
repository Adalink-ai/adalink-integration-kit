import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST as chatPOST } from '@/app/api/adaflow/chat/route';
import { POST as agentPOST } from '@/app/api/adaflow/agents/[agentId]/run/route';
import { GET as statusGET } from '@/app/api/adaflow/status/route';

const TOKEN = 'ada_teste_v0';
const SPECIALIST = '0190f7a2-4c1e-7b3d-9a2f-1c2d3e4f5a6b';
const AGENT = '0190f7a2-4c1e-7b3d-9a2f-aaaaaaaaaaaa';

let calls: Array<{ url: URL; init: RequestInit }>;

function mockGateway(handler: (url: URL, init: RequestInit) => Response) {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (input: string | URL | Request, init: RequestInit = {}) => {
      const url = new URL(input instanceof Request ? input.url : input.toString());
      calls.push({ url, init });
      return handler(url, init);
    }),
  );
}

function sse(chunks: string[], headers: Record<string, string> = {}): Response {
  const body = [
    ...chunks.map((c) => `data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { content: c }, finish_reason: null }] })}\n\n`),
    'data: [DONE]\n\n',
  ].join('');
  return new Response(body, { headers: { 'content-type': 'text/event-stream', ...headers } });
}

function post(body: unknown): Request {
  return new Request('http://app.test/api', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

function sentHeaders(i = 0): Headers {
  return new Headers(calls[i]?.init.headers);
}

beforeEach(() => {
  vi.stubEnv('ADAFLOW_APP_TOKEN', TOKEN);
  vi.stubEnv('ADAFLOW_BASE_URL', 'https://gw.test');
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('GET /api/adaflow/status', () => {
  it('diz se o token existe, sem expor o valor', async () => {
    const res = statusGET();
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({ configured: true });
    expect(text).not.toContain(TOKEN);

    vi.stubEnv('ADAFLOW_APP_TOKEN', '  ');
    expect(await statusGET().json()).toEqual({ configured: false });
  });
});

describe('POST /api/adaflow/chat', () => {
  it('conversa com o especialista em streaming e repassa o x-chat-id', async () => {
    mockGateway(() => sse(['Olá', ', tudo bem?'], { 'x-chat-id': 'chat-9' }));

    const res = await chatPOST(post({ specialistId: SPECIALIST, messages: [{ role: 'user', content: 'Oi' }] }));

    expect(res.status).toBe(200);
    expect(res.headers.get('x-chat-id')).toBe('chat-9');
    expect(await res.text()).toBe('Olá, tudo bem?');
    expect(calls[0]?.url.toString()).toBe('https://gw.test/v1/openai/chat/completions');
    expect(sentHeaders().get('x-ada-token')).toBe(TOKEN);
    expect(sentHeaders().get('x-ada-client')).toBe('v0');
    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({
      model: `assistant:${SPECIALIST}`,
      stream: true,
      messages: [{ role: 'user', content: 'Oi' }],
    });
  });

  it('usa o modelo padrão sem especialista e envia o chatId', async () => {
    mockGateway(() => sse(['ok']));
    const chatId = '0190f7a2-4c1e-7b3d-9a2f-bbbbbbbbbbbb';

    await chatPOST(post({ chatId, messages: [{ role: 'user', content: 'Oi' }] }));

    expect(JSON.parse(calls[0]?.init.body as string)).toMatchObject({ model: 'anthropic/claude-haiku-4.5', chat_id: chatId });
  });

  it('responde 503 not_configured sem token, sem chamar a API', async () => {
    vi.stubEnv('ADAFLOW_APP_TOKEN', '');
    mockGateway(() => sse(['x']));

    const res = await chatPOST(post({ messages: [{ role: 'user', content: 'Oi' }] }));

    expect(res.status).toBe(503);
    expect((await res.json()).error.code).toBe('not_configured');
    expect(calls).toHaveLength(0);
  });

  it.each([
    [{ messages: [] }],
    [{ messages: [{ role: 'tool', content: 'x' }] }],
    [{ messages: [{ role: 'user', content: 'x'.repeat(50_001) }] }],
    [{ specialistId: '../admin', messages: [{ role: 'user', content: 'x' }] }],
    [{ chatId: 'nao-uuid', messages: [{ role: 'user', content: 'x' }] }],
  ])('rejeita entrada inválida sem chamar a API: %j', async (body) => {
    mockGateway(() => sse(['x']));

    const res = await chatPOST(post(body));

    expect(res.status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it.each([
    [401, { message: 'Unauthorized' }, 'adaflow_auth'],
    [429, { error: { message: 'Saldo zerado', code: 'insufficient_quota', type: 'insufficient_quota' } }, 'insufficient_quota'],
    [503, { message: 'upstream down' }, 'adaflow_unavailable'],
  ])('traduz HTTP %i da Adaflow sem vazar o corpo técnico', async (status, payload, code) => {
    mockGateway(() => Response.json(payload, { status }));

    const res = await chatPOST(post({ messages: [{ role: 'user', content: 'Oi' }] }));
    const body = await res.json();

    expect(body.error.code).toBe(code);
    expect(JSON.stringify(body)).not.toContain('upstream down');
  });
});

describe('POST /api/adaflow/agents/:agentId/run', () => {
  const params = (agentId: string) => ({ params: Promise.resolve({ agentId }) });

  it('executa o agente e devolve o resultado e o threadId', async () => {
    mockGateway(() =>
      Response.json({ id: 'e1', agentId: AGENT, input: 'Resuma', output: 'Resumo pronto', threadId: 't1', status: 'completed' }),
    );

    const res = await agentPOST(post({ input: 'Resuma', threadId: 't0' }), params(AGENT));

    expect(await res.json()).toEqual({ id: 'e1', status: 'completed', output: 'Resumo pronto', threadId: 't1' });
    expect(calls[0]?.url.pathname).toBe(`/v1/autonomous-agents/${AGENT}/execute`);
    expect(JSON.parse(calls[0]?.init.body as string)).toEqual({ input: 'Resuma', threadId: 't0' });
  });

  it('marca falha do agente com mensagem amigável', async () => {
    mockGateway(() => Response.json({ id: 'e1', agentId: AGENT, input: 'x', output: '', status: 'failed', error: 'stack interna' }));

    const body = await (await agentPOST(post({ input: 'x' }), params(AGENT))).json();

    expect(body.status).toBe('failed');
    expect(body.error).toBe('O agente não conseguiu concluir a tarefa.');
    expect(JSON.stringify(body)).not.toContain('stack interna');
  });

  it('rejeita agentId que não é UUID e input vazio, sem chamar a API', async () => {
    mockGateway(() => Response.json({}));

    expect((await agentPOST(post({ input: 'x' }), params('../admin'))).status).toBe(400);
    expect((await agentPOST(post({ input: '   ' }), params(AGENT))).status).toBe(400);
    expect(calls).toHaveLength(0);
  });

  it('traduz 404 da Adaflow', async () => {
    mockGateway(() => Response.json({ message: 'Not Found' }, { status: 404 }));

    const res = await agentPOST(post({ input: 'x' }), params(AGENT));

    expect(res.status).toBe(404);
    expect((await res.json()).error.code).toBe('adaflow_not_found');
  });
});

describe('registry.json', () => {
  const registry = JSON.parse(readFileSync(new URL('../registry.json', import.meta.url), 'utf8')) as {
    items: Array<{ name: string; dependencies: string[]; files: Array<{ path: string }> }>;
  };

  it('cada bloco leva a lib do servidor, a rota de status e o aviso de configuração', () => {
    for (const item of registry.items) {
      const paths = item.files.map((f) => f.path);
      expect(paths, item.name).toEqual(
        expect.arrayContaining(['lib/adaflow-server.ts', 'app/api/adaflow/status/route.ts', 'components/adaflow-setup-notice.tsx']),
      );
      expect(item.dependencies).toEqual(expect.arrayContaining(['@adaflow/sdk', 'server-only']));
    }
  });

  it('nenhum arquivo do registry usa NEXT_PUBLIC_ para o token', () => {
    for (const item of registry.items) {
      for (const file of item.files) {
        const source = readFileSync(new URL(`../${file.path}`, import.meta.url), 'utf8');
        expect(source, file.path).not.toMatch(/NEXT_PUBLIC_ADAFLOW/);
      }
    }
  });
});
