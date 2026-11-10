/**
 * Executa um agente autônomo da Adaflow e devolve o resultado ao final.
 *
 * POST /api/adaflow/agents/:agentId/run  { input, threadId? }
 *   -> { id, status, output, threadId }
 *
 * A execução pode levar minutos: maxDuration cobre até 300 s.
 */
import {
  adaflowErrorResponse,
  errorResponse,
  getAdaflowClient,
  isUuid,
  notConfiguredResponse,
} from '@/lib/adaflow-server';

export const runtime = 'nodejs';
export const maxDuration = 300;

const MAX_INPUT_CHARS = 50_000;

export async function POST(req: Request, ctx: { params: Promise<{ agentId: string }> }) {
  const client = getAdaflowClient();
  if (!client) return notConfiguredResponse();

  const { agentId } = await ctx.params;
  if (!isUuid(agentId)) return errorResponse(400, 'invalid_request', 'agentId deve ser um UUID.');

  const body = (await req.json().catch(() => null)) as { input?: unknown; threadId?: unknown } | null;
  const input = typeof body?.input === 'string' ? body.input.trim() : '';
  if (!input || input.length > MAX_INPUT_CHARS) {
    return errorResponse(400, 'invalid_request', `Envie input em texto, com até ${MAX_INPUT_CHARS} caracteres.`);
  }
  if (body?.threadId !== undefined && typeof body.threadId !== 'string') {
    return errorResponse(400, 'invalid_request', 'threadId deve ser texto.');
  }

  try {
    const execution = await client.agents.execute(agentId, { input, threadId: body?.threadId as string | undefined });
    return Response.json({
      id: execution.id,
      status: execution.status,
      output: execution.output,
      threadId: execution.threadId,
      error: execution.status === 'failed' ? 'O agente não conseguiu concluir a tarefa.' : undefined,
    });
  } catch (err) {
    return adaflowErrorResponse(err, 'agents.run');
  }
}
