/**
 * Sessão do usuário via SSO handoff do Adaflow (lado browser).
 * O JWT vive em sessionStorage — nunca em cookie cross-domain nem query string.
 */
import { buildHandoffUrl } from '@adaflow/sdk';

const JWT_KEY = 'adaflow:jwt';
const RETRY_KEY = 'adaflow:auth-retried';

export const ADAFLOW_URL = process.env.NEXT_PUBLIC_ADAFLOW_URL ?? 'https://app.adalink.ai';

export function getJwt(): string | null {
  if (typeof window === 'undefined') return null;
  return sessionStorage.getItem(JWT_KEY);
}

export function saveJwt(jwt: string): void {
  sessionStorage.setItem(JWT_KEY, jwt);
  sessionStorage.removeItem(RETRY_KEY);
}

export function clearJwt(): void {
  sessionStorage.removeItem(JWT_KEY);
}

/** Redireciona para o handoff do Adaflow (volta em /auth/callback com o token). */
export function startLogin(): void {
  window.location.href = buildHandoffUrl(ADAFLOW_URL, `${window.location.origin}/auth/callback`);
}

/**
 * Trata 401: refaz o handoff UMA vez (sessão do Adaflow ativa = ciclo
 * transparente). Se o retry já aconteceu e ainda deu 401, retorna false —
 * mostre erro de sessão em vez de entrar em loop de redirect.
 */
export function retryLoginOnce(): boolean {
  if (sessionStorage.getItem(RETRY_KEY)) return false;
  sessionStorage.setItem(RETRY_KEY, '1');
  clearJwt();
  startLogin();
  return true;
}

/** Marca a sessão como saudável (limpa o guard de retry) após uma chamada OK. */
export function markAuthOk(): void {
  sessionStorage.removeItem(RETRY_KEY);
}
