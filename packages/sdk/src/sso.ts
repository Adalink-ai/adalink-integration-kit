/**
 * Helpers de SSO handoff (lado browser do app integrado).
 * O Adaflow é o Identity Provider: o app redireciona para o handoff e recebe
 * o JWT de volta no fragment `#sso_token=` — que não vai ao servidor nem vaza
 * por Referer. Ver seção 1 do guia de apps integrados.
 */

/** Monta a URL de handoff para redirecionar o browser ao Adaflow. */
export function buildHandoffUrl(adaflowBaseUrl: string, redirectUrl: string): string {
  const base = adaflowBaseUrl.replace(/\/$/, '');
  return `${base}/sso/handoff?redirect-url=${encodeURIComponent(redirectUrl)}`;
}

export interface ConsumeSsoTokenOptions {
  /** Limpa o fragment da URL após extrair o token (default: true — recomendado). */
  cleanUrl?: boolean;
}

/**
 * Extrai o `sso_token` do fragment da URL atual (página de callback) e, por
 * padrão, limpa o fragment do histórico do browser. Retorna `null` se não há
 * token. Uso exclusivo em browser.
 */
export function consumeSsoToken(options: ConsumeSsoTokenOptions = {}): string | null {
  if (typeof window === 'undefined') {
    throw new Error('consumeSsoToken só funciona em browser (window indisponível).');
  }
  const params = new URLSearchParams(window.location.hash.slice(1));
  const raw = params.get('sso_token');
  if (!raw) return null;

  if (options.cleanUrl !== false) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return decodeURIComponent(raw);
}

/** O que o handoff entrega no fragment. */
export interface SsoFragment {
  /** JWT de 15 minutos (`#sso_token=`). */
  token: string;
  /**
   * Código de uso único (`#sso_code=`) que vira a sessão de 7 dias do app, ou
   * `null` quando o Adaflow não o emitiu (versão anterior ou falha).
   */
  code: string | null;
}

/**
 * Como `consumeSsoToken`, mas devolve também o `sso_code`. O código precisa
 * ser lido ANTES de limpar a URL. Retorna `null` se o fragment não traz token.
 */
export function consumeSsoFragment(options: ConsumeSsoTokenOptions = {}): SsoFragment | null {
  if (typeof window === 'undefined') {
    throw new Error('consumeSsoFragment só funciona em browser (window indisponível).');
  }
  const params = new URLSearchParams(window.location.hash.slice(1));
  const raw = params.get('sso_token');
  if (!raw) return null;
  const code = params.get('sso_code');

  if (options.cleanUrl !== false) {
    window.history.replaceState(null, '', window.location.pathname + window.location.search);
  }
  return { token: decodeURIComponent(raw), code: code ? decodeURIComponent(code) : null };
}
