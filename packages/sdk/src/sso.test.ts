import { afterEach, describe, expect, it, vi } from 'vitest';
import { consumeSsoFragment, consumeSsoToken } from './sso.js';

function stubLocation(hash: string) {
  const replaceState = vi.fn();
  vi.stubGlobal('window', {
    location: { hash, pathname: '/auth/callback', search: '?next=%2F' },
    history: { replaceState },
  });
  return replaceState;
}

afterEach(() => vi.unstubAllGlobals());

describe('consumeSsoFragment', () => {
  it('lê sso_token e sso_code e limpa a URL', () => {
    const replaceState = stubLocation('#sso_token=a%2Fb&sso_code=c0d3');
    expect(consumeSsoFragment()).toEqual({ token: 'a/b', code: 'c0d3' });
    expect(replaceState).toHaveBeenCalledWith(null, '', '/auth/callback?next=%2F');
  });

  it('sem sso_code devolve code null (Adaflow anterior)', () => {
    stubLocation('#sso_token=tok');
    expect(consumeSsoFragment()).toEqual({ token: 'tok', code: null });
  });

  it('sem sso_token devolve null e não mexe na URL', () => {
    const replaceState = stubLocation('#sso_code=sozinho');
    expect(consumeSsoFragment()).toBeNull();
    expect(replaceState).not.toHaveBeenCalled();
  });

  it('consumeSsoToken continua devolvendo só o JWT', () => {
    stubLocation('#sso_token=tok&sso_code=c');
    expect(consumeSsoToken()).toBe('tok');
  });

  it('fora do browser lança', () => {
    expect(() => consumeSsoFragment()).toThrow(/browser/);
  });
});
