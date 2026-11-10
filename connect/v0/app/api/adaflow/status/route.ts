/**
 * GET /api/adaflow/status -> { configured }
 *
 * Diz só se a variável ADAFLOW_APP_TOKEN existe, nunca o valor. Os
 * componentes da Adaflow usam isso para mostrar o aviso de configuração em vez
 * de um erro.
 */
import { isAdaflowConfigured } from '@/lib/adaflow-server';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export function GET() {
  return Response.json({ configured: isAdaflowConfigured() }, { headers: { 'Cache-Control': 'no-store' } });
}
