/**
 * Função Vercel do MCP remoto do Adaflow Connect: `POST /mcp`.
 *
 * Aberto a todas as organizações. Cada requisição traz a própria credencial
 * (x-ada-token, Authorization: Bearer ada_... ou o JWT do usuário) e nada fica
 * guardado entre requisições. Ver ../README.md.
 *
 * Env do projeto na Vercel:
 *   ADAFLOW_BASE_URL  opcional. Gateway da Adaflow; vazio = produção.
 */
import { createRemoteMcpHandler } from '@adaflow/mcp/remote';

const handler = createRemoteMcpHandler({ baseUrl: process.env.ADAFLOW_BASE_URL || undefined });

export const POST = handler;
export const OPTIONS = handler;
// Sem sessão: GET e DELETE respondem 405 pelo próprio handler.
export const GET = handler;
export const DELETE = handler;
