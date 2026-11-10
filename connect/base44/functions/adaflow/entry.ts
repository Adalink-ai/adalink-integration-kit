/**
 * Adaflow Connect: Backend Function da Base44.
 *
 * Proxy fino entre o app Base44 e a API da Adaflow. O token da Adaflow fica
 * nos Secrets do app e só é lido aqui, no servidor; o navegador nunca o vê.
 *
 * Secrets do app:
 *   ADAFLOW_APP_TOKEN        obrigatório. Token de app criado no painel da Adaflow.
 *   ADAFLOW_BASE_URL         opcional. Gateway private label; vazio = produção.
 *   ADAFLOW_APP_SLUG         opcional. Nome do app na trilha de governança (default: base44-app).
 *   ADAFLOW_ALLOW_ANONYMOUS  opcional. "true" libera visitantes sem login (cuidado: consome créditos).
 *
 * Uso no frontend (sempre POST, JSON com `action`):
 *   const res = await base44.functions.fetch('/adaflow', {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ action: 'chat', specialistId, messages, stream: true }),
 *   });
 *
 * Ações: listSpecialists, listAgents, listModels, listRepositories, chat,
 * runAgent e trackEvents. Os parâmetros de cada uma estão em `ACTIONS` abaixo.
 *
 * Arquivo único de propósito: dá para colar no editor de funções da Base44 sem
 * o CLI. Fonte: https://github.com/Adalink-ai/adalink-integration-kit/tree/main/connect
 */
import { createClientFromRequest } from 'npm:@base44/sdk@0.8.59';

const DEFAULT_BASE_URL = 'https://zeus.adalink.app';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTION_RE = /^app\.[a-z0-9_-]+(\.[a-z0-9_-]+){1,4}$/;
const MAX_INPUT_CHARS = 50_000;
const MAX_EVENTS = 50;

type Json = Record<string, unknown>;

/** Erro de validação ou de configuração, com mensagem segura para o usuário. */
class ConnectError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

/** Secret do app: bridge da Base44 (runtime atual) ou env do Deno (runtime antigo). */
function secret(name: string): string | undefined {
  const g = globalThis as {
    Base44?: { secrets?: { get(n: string): string | undefined } };
    Deno?: { env: { get(n: string): string | undefined } };
  };
  const value = g.Base44?.secrets?.get(name) ?? g.Deno?.env.get(name);
  return value && value.trim() ? value.trim() : undefined;
}

function json(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', ...headers },
  });
}

function fail(status: number, code: string, message: string): Response {
  return json({ error: { code, message } }, status);
}

function str(body: Json, key: string, required = true): string | undefined {
  const value = body[key];
  if (value === undefined || value === null || value === '') {
    if (required) throw new ConnectError(400, 'invalid_request', `Campo obrigatório: ${key}.`);
    return undefined;
  }
  if (typeof value !== 'string') throw new ConnectError(400, 'invalid_request', `${key} deve ser texto.`);
  return value;
}

function uuid(body: Json, key: string): string {
  const value = str(body, key) as string;
  if (!UUID_RE.test(value)) throw new ConnectError(400, 'invalid_request', `${key} deve ser um UUID.`);
  return value;
}

function int(body: Json, key: string): number | undefined {
  const value = body[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new ConnectError(400, 'invalid_request', `${key} deve ser um inteiro positivo.`);
  }
  return value;
}

function pageQuery(body: Json): Record<string, string | number | undefined> {
  return { page: int(body, 'page'), limit: int(body, 'limit'), search: str(body, 'search', false) };
}

interface Upstream {
  method: 'GET' | 'POST';
  path: string;
  query?: Record<string, string | number | undefined>;
  body?: unknown;
  stream?: boolean;
}

/** Cada ação vira exatamente uma chamada à API, com parâmetros validados. */
const ACTIONS: Record<string, (body: Json, appSlug: string) => Upstream> = {
  // { page?, limit?, search? }
  listSpecialists: (b) => ({ method: 'GET', path: '/v1/specialists', query: pageQuery(b) }),
  // { page?, limit?, search? }
  listAgents: (b) => ({ method: 'GET', path: '/v1/autonomous-agents', query: pageQuery(b) }),
  // {}
  listModels: () => ({ method: 'GET', path: '/v1/openai/models' }),
  // { page?, limit?, search? }
  listRepositories: (b) => ({ method: 'GET', path: '/v1/repositories', query: pageQuery(b) }),

  // { specialistId | model, messages: [{ role, content }], chatId?, temperature?, maxTokens?, stream? }
  chat: (b) => {
    const specialistId = b.specialistId === undefined ? undefined : uuid(b, 'specialistId');
    const model = specialistId ? `assistant:${specialistId}` : str(b, 'model');
    const messages = b.messages;
    if (!Array.isArray(messages) || messages.length === 0) {
      throw new ConnectError(400, 'invalid_request', 'messages deve ser uma lista com ao menos uma mensagem.');
    }
    for (const m of messages) {
      const msg = m as Json;
      if (!['system', 'user', 'assistant'].includes(String(msg?.role)) || typeof msg?.content !== 'string') {
        throw new ConnectError(400, 'invalid_request', 'Cada mensagem precisa de role (system, user ou assistant) e content em texto.');
      }
    }
    const stream = b.stream === true;
    return {
      method: 'POST',
      path: '/v1/openai/chat/completions',
      stream,
      body: {
        model,
        messages,
        chat_id: b.chatId === undefined ? undefined : uuid(b, 'chatId'),
        temperature: typeof b.temperature === 'number' ? b.temperature : undefined,
        max_tokens: int(b, 'maxTokens'),
        stream,
      },
    };
  },

  // { agentId, input, threadId?, stream? }
  runAgent: (b) => {
    const agentId = uuid(b, 'agentId');
    const input = str(b, 'input') as string;
    if (input.length > MAX_INPUT_CHARS) {
      throw new ConnectError(400, 'invalid_request', `input passa de ${MAX_INPUT_CHARS} caracteres.`);
    }
    const threadId = str(b, 'threadId', false);
    return b.stream === true
      ? { method: 'GET', path: `/v1/autonomous-agents/${agentId}/stream`, query: { input, threadId }, stream: true }
      : { method: 'POST', path: `/v1/autonomous-agents/${agentId}/execute`, body: { input, threadId } };
  },

  // { events: [{ action: 'app.<dominio>.<verbo>', resource, ... }] } — o `app` vem do secret, não do navegador.
  trackEvents: (b, appSlug) => {
    const events = b.events;
    if (!Array.isArray(events) || events.length === 0 || events.length > MAX_EVENTS) {
      throw new ConnectError(400, 'invalid_request', `events deve ter de 1 a ${MAX_EVENTS} itens.`);
    }
    return {
      method: 'POST',
      path: '/v1/audit/events/batch',
      body: {
        events: events.map((e) => {
          const ev = e as Json;
          if (typeof ev?.action !== 'string' || !ACTION_RE.test(ev.action) || typeof ev.resource !== 'string') {
            throw new ConnectError(400, 'invalid_request', 'Cada evento precisa de action no formato app.<dominio>.<verbo> e resource.');
          }
          return { ...ev, app: appSlug, eventId: typeof ev.eventId === 'string' ? ev.eventId : crypto.randomUUID() };
        }),
      },
    };
  },
};

/** Mensagem amigável para o erro da API; o detalhe técnico vai só para o log. */
function friendlyUpstreamError(status: number, code: string | undefined): { code: string; message: string } {
  if (status === 401) return { code: 'adaflow_auth', message: 'O token da Adaflow é inválido ou foi revogado. Peça ao administrador para atualizar o secret ADAFLOW_APP_TOKEN.' };
  if (status === 403) return { code: 'adaflow_forbidden', message: 'O token da Adaflow não tem permissão para esta ação.' };
  if (status === 404) return { code: 'adaflow_not_found', message: 'Recurso não encontrado na Adaflow.' };
  if (code === 'insufficient_quota') return { code: 'insufficient_quota', message: 'A organização está sem créditos na Adaflow.' };
  if (status === 429) return { code: 'rate_limited', message: 'Muitas requisições à Adaflow. Tente de novo em instantes.' };
  if (status >= 500) return { code: 'adaflow_unavailable', message: 'A Adaflow está indisponível no momento. Tente de novo em instantes.' };
  return { code: code ?? 'adaflow_error', message: 'A Adaflow recusou a requisição.' };
}

function readErrorCode(payload: unknown): string | undefined {
  const err = (payload as { error?: unknown })?.error;
  if (err && typeof err === 'object' && typeof (err as Json).code === 'string') return (err as Json).code as string;
  return undefined;
}

export interface HandlerDeps {
  fetch: typeof fetch;
  /** Usuário logado no app Base44, ou null. */
  currentUser(req: Request): Promise<{ id: string } | null>;
}

export function createHandler(deps: HandlerDeps): (req: Request) => Promise<Response> {
  return async (req) => {
    const correlationId = crypto.randomUUID();
    try {
      if (req.method !== 'POST') return fail(405, 'method_not_allowed', 'Use POST.');

      const token = secret('ADAFLOW_APP_TOKEN');
      if (!token) {
        console.error(JSON.stringify({ msg: 'adaflow.missing-token', correlationId }));
        return fail(500, 'not_configured', 'A integração com a Adaflow não está configurada. Falta o secret ADAFLOW_APP_TOKEN.');
      }

      if (secret('ADAFLOW_ALLOW_ANONYMOUS') !== 'true') {
        const user = await deps.currentUser(req).catch(() => null);
        if (!user) return fail(401, 'login_required', 'Entre no app para usar este recurso.');
      }

      let body: Json;
      try {
        body = (await req.json()) as Json;
      } catch {
        return fail(400, 'invalid_request', 'Corpo da requisição deve ser JSON.');
      }
      const action = typeof body?.action === 'string' ? body.action : '';
      const build = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
      if (!build) return fail(400, 'unknown_action', `Ação desconhecida. Use: ${Object.keys(ACTIONS).join(', ')}.`);

      const call = build(body, secret('ADAFLOW_APP_SLUG') ?? 'base44-app');
      const url = new URL(call.path, (secret('ADAFLOW_BASE_URL') ?? DEFAULT_BASE_URL).replace(/\/+$/, '') + '/');
      for (const [k, v] of Object.entries(call.query ?? {})) if (v !== undefined) url.searchParams.set(k, String(v));

      const startedAt = Date.now();
      const upstream = await deps.fetch(url, {
        method: call.method,
        headers: {
          'x-ada-token': token,
          'x-ada-client': 'base44',
          'x-correlation-id': correlationId,
          Accept: call.stream ? 'text/event-stream' : 'application/json',
          ...(call.body === undefined ? {} : { 'Content-Type': 'application/json' }),
        },
        body: call.body === undefined ? undefined : JSON.stringify(call.body),
      });

      if (!upstream.ok) {
        const raw = await upstream.text().catch(() => '');
        let payload: unknown;
        try {
          payload = JSON.parse(raw);
        } catch {
          payload = undefined;
        }
        console.error(JSON.stringify({ msg: 'adaflow.upstream-error', correlationId, action, status: upstream.status, body: raw.slice(0, 2000) }));
        const friendly = friendlyUpstreamError(upstream.status, readErrorCode(payload));
        return fail(upstream.status, friendly.code, friendly.message);
      }

      console.log(JSON.stringify({ msg: 'adaflow.ok', correlationId, action, status: upstream.status, durationMs: Date.now() - startedAt }));
      const passHeaders: Record<string, string> = {};
      const chatId = upstream.headers.get('x-chat-id');
      if (chatId) passHeaders['x-chat-id'] = chatId;

      if (call.stream) {
        return new Response(upstream.body, {
          status: 200,
          headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...passHeaders },
        });
      }
      return new Response(await upstream.text(), {
        status: 200,
        headers: { 'Content-Type': 'application/json', ...passHeaders },
      });
    } catch (error) {
      if (error instanceof ConnectError) return fail(error.status, error.code, error.message);
      console.error(JSON.stringify({ msg: 'adaflow.failed', correlationId, error: String(error) }));
      return fail(502, 'adaflow_unreachable', 'Não foi possível falar com a Adaflow. Tente de novo em instantes.');
    }
  };
}

export default createHandler({
  fetch: (input, init) => fetch(input, init),
  currentUser: async (req) => {
    const base44 = createClientFromRequest(req);
    return (await base44.auth.me()) as { id: string } | null;
  },
});
