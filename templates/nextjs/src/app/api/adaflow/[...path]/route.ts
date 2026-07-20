/**
 * Proxy de tracking para o Adaflow (governança + telemetria de sessão).
 * Mesmo padrão do /api/chat: o browser fala com o próprio app (sem CORS,
 * gateway não exposto) e o JWT do usuário segue no Authorization.
 *
 * Allowlist estrita: só as rotas de ingestão/telemetria passam — este proxy
 * NÃO é um túnel genérico para o gateway.
 */
import type { NextRequest } from 'next/server';

export const runtime = 'nodejs';

const ADAFLOW_BASE_URL =
  process.env.ADAFLOW_BASE_URL ?? 'https://adalink-api-gateway.onrender.com';

const ALLOWED_PATHS = new Set([
  'v1/audit/events',
  'v1/audit/events/batch',
  'v1/telemetry/heartbeat',
  'v1/telemetry/page-view',
  'v1/telemetry/session-end',
]);

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await params;
  const target = path.join('/');

  if (!ALLOWED_PATHS.has(target)) {
    return Response.json({ message: 'Rota não permitida pelo proxy.' }, { status: 404 });
  }

  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) {
    return Response.json({ message: 'Sessão ausente — entre com o Adaflow.' }, { status: 401 });
  }

  try {
    const upstream = await fetch(`${ADAFLOW_BASE_URL}/${target}`, {
      method: 'POST',
      headers: {
        authorization: auth,
        'content-type': req.headers.get('content-type') ?? 'application/json',
      },
      body: await req.text(),
    });

    return new Response(upstream.body, {
      status: upstream.status,
      headers: { 'content-type': upstream.headers.get('content-type') ?? 'application/json' },
    });
  } catch (err) {
    console.error('[api/adaflow] falha ao repassar para o gateway', err);
    return Response.json(
      { message: 'Não foi possível falar com a plataforma agora.' },
      { status: 502 },
    );
  }
}
