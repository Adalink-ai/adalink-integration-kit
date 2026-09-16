/**
 * Sessão do usuário via SSO handoff do Adaflow (lado browser).
 * O JWT vive em sessionStorage — nunca em cookie cross-domain nem query string.
 *
 * `createSsoSession` encapsula o ciclo inteiro: guarda o token, anexa o
 * `Authorization` em `session.fetch`, renova em 401 e traz as proteções
 * anti-loop de redirect (guarda por cooldown, 401 amarrado ao token da
 * request, single-flight). Não reimplemente esse miolo à mão.
 */
import { createSsoSession } from '@adaflow/sdk';

export const ADAFLOW_URL = process.env.NEXT_PUBLIC_ADAFLOW_URL ?? 'https://app.adalink.ai';

export const session = createSsoSession({ adaflowUrl: ADAFLOW_URL });

/** Conveniência para módulos que só leem o token (ex.: tracking). */
export const getJwt = session.getJwt;
