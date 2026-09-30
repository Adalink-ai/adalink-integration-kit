import { beforeAll, describe, expect, it, vi } from 'vitest';
import { AdaflowTokenError, createJwtVerifier } from './jwt-verifier.js';

const JWKS_URL = 'https://adaflow.example.com/v1/auth/jwks';
const NOW = Date.UTC(2026, 8, 30, 12, 0, 0);
const nowSec = NOW / 1000;

const b64url = (bytes: Uint8Array | string) =>
  Buffer.from(typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes).toString('base64url');

let privateKey: CryptoKey;
let publicJwk: JsonWebKey;
let otherPrivateKey: CryptoKey;

beforeAll(async () => {
  const pair = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  privateKey = pair.privateKey;
  publicJwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
  const other = (await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify'])) as CryptoKeyPair;
  otherPrivateKey = other.privateKey;
});

async function sign(
  payload: Record<string, unknown>,
  { kid = 'k1', alg = 'EdDSA', key = privateKey }: { kid?: string; alg?: string; key?: CryptoKey } = {},
): Promise<string> {
  const head = b64url(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = new Uint8Array(
    await crypto.subtle.sign({ name: 'Ed25519' }, key, new TextEncoder().encode(`${head}.${body}`)),
  );
  return `${head}.${body}.${b64url(sig)}`;
}

const claims = (extra: Record<string, unknown> = {}) => ({
  sub: 'u1',
  email: 'Pessoa@Cliente.com',
  name: 'Pessoa',
  organizationId: 'org1',
  role: 'MEMBER',
  sessionId: 's1',
  iat: nowSec - 60,
  exp: nowSec + 840,
  iss: 'https://adaflow.example.com',
  ...extra,
});

function jwksFetch(keys: () => unknown[] = () => [{ ...publicJwk, kid: 'k1' }]) {
  return vi.fn(async () => new Response(JSON.stringify({ keys: keys() }), { status: 200 }));
}

function verifierWith(fetchMock: ReturnType<typeof jwksFetch>, extra: Record<string, unknown> = {}, now = () => NOW) {
  return createJwtVerifier({ jwksUrl: JWKS_URL, fetch: fetchMock as unknown as typeof fetch, now, ...extra });
}

async function expectCode(promise: Promise<unknown>, code: string) {
  const err = await promise.then(() => null, (e: unknown) => e);
  expect(err).toBeInstanceOf(AdaflowTokenError);
  expect((err as AdaflowTokenError).code).toBe(code);
}

describe('createJwtVerifier', () => {
  it('aceita token EdDSA válido e devolve a identidade', async () => {
    const identity = await verifierWith(jwksFetch()).verify(await sign(claims()));
    expect(identity).toMatchObject({
      sub: 'u1',
      email: 'pessoa@cliente.com',
      name: 'Pessoa',
      organizationId: 'org1',
      role: 'MEMBER',
      sessionId: 's1',
    });
    expect(identity.expiresAt.getTime()).toBe((nowSec + 840) * 1000);
    expect(identity.issuedAt?.getTime()).toBe((nowSec - 60) * 1000);
  });

  it('exige jwksUrl', () => {
    expect(() => createJwtVerifier({ jwksUrl: '' })).toThrow(/jwksUrl/);
  });

  it('recusa algoritmo diferente de EdDSA (confusão de algoritmo)', async () => {
    await expectCode(verifierWith(jwksFetch()).verify(await sign(claims(), { alg: 'HS256' })), 'unsupported_alg');
  });

  it('recusa assinatura de outra chave', async () => {
    await expectCode(verifierWith(jwksFetch()).verify(await sign(claims(), { key: otherPrivateKey })), 'invalid_signature');
  });

  it('recusa payload adulterado', async () => {
    const [h, , s] = (await sign(claims())).split('.');
    const forged = `${h}.${b64url(JSON.stringify(claims({ sub: 'admin' })))}.${s}`;
    await expectCode(verifierWith(jwksFetch()).verify(forged), 'invalid_signature');
  });

  it('recusa token expirado, com folga de relógio', async () => {
    const verifier = verifierWith(jwksFetch());
    await expect(verifier.verify(await sign(claims({ exp: nowSec - 3 })))).resolves.toBeTruthy();
    await expectCode(verifier.verify(await sign(claims({ exp: nowSec - 10 }))), 'expired');
    await expectCode(verifier.verify(await sign(claims({ exp: undefined }))), 'expired');
  });

  it('recusa nbf no futuro', async () => {
    await expectCode(verifierWith(jwksFetch()).verify(await sign(claims({ nbf: nowSec + 60 }))), 'not_yet_valid');
  });

  it('confere issuer e audience quando configurados', async () => {
    const token = await sign(claims({ aud: ['app-a'] }));
    await expect(
      verifierWith(jwksFetch(), { issuer: 'https://adaflow.example.com', audience: 'app-a' }).verify(token),
    ).resolves.toBeTruthy();
    await expectCode(verifierWith(jwksFetch(), { issuer: 'https://outro' }).verify(token), 'invalid_issuer');
    await expectCode(verifierWith(jwksFetch(), { audience: 'app-b' }).verify(token), 'invalid_audience');
  });

  it('recusa token malformado', async () => {
    const verifier = verifierWith(jwksFetch());
    await expectCode(verifier.verify('abc'), 'malformed');
    await expectCode(verifier.verify('a.b.c'), 'malformed');
  });

  it('usa o JWKS em cache entre verificações', async () => {
    const fetchMock = jwksFetch();
    const verifier = verifierWith(fetchMock);
    await verifier.verify(await sign(claims()));
    await verifier.verify(await sign(claims()));
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('busca de novo em kid desconhecido (rotação), respeitando o cooldown', async () => {
    let clock = NOW;
    let published = [{ ...publicJwk, kid: 'k1' }];
    const fetchMock = jwksFetch(() => published);
    const verifier = verifierWith(fetchMock, {}, () => clock);
    await verifier.verify(await sign(claims()));

    published = [{ ...publicJwk, kid: 'k2' }];
    // Dentro do cooldown: não martela o JWKS por um kid desconhecido.
    await expectCode(verifier.verify(await sign(claims(), { kid: 'k2' })), 'unknown_key');
    expect(fetchMock).toHaveBeenCalledTimes(1);

    clock += 31_000;
    await expect(verifier.verify(await sign(claims(), { kid: 'k2' }))).resolves.toBeTruthy();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('ignora chaves que não são Ed25519', async () => {
    const fetchMock = jwksFetch(() => [{ kty: 'RSA', kid: 'k1', n: 'x', e: 'AQAB' }]);
    await expectCode(verifierWith(fetchMock).verify(await sign(claims())), 'unknown_key');
  });

  it('JWKS fora do ar vira jwks_unavailable', async () => {
    const fetchMock = vi.fn(async () => new Response('erro', { status: 503 }));
    await expectCode(verifierWith(fetchMock as never).verify(await sign(claims())), 'jwks_unavailable');
  });
});
