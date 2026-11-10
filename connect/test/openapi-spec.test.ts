import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parse } from 'yaml';

type Operation = { operationId?: string; security?: unknown };
type Spec = {
  openapi: string;
  servers: Array<{ url: string }>;
  security: Array<Record<string, unknown>>;
  paths: Record<string, Record<string, Operation>>;
  components: { securitySchemes: Record<string, { type: string; in?: string; name?: string }> };
};

const spec = parse(readFileSync(new URL('../openapi/adaflow.yaml', import.meta.url), 'utf8')) as Spec;
const HTTP_METHODS = ['get', 'post', 'put', 'patch', 'delete'];

function operations(): Array<{ path: string; method: string; op: Operation }> {
  return Object.entries(spec.paths).flatMap(([path, item]) =>
    Object.entries(item)
      .filter(([method]) => HTTP_METHODS.includes(method))
      .map(([method, op]) => ({ path, method, op })),
  );
}

/** Rotas que o Connect publica. Mudou aqui? Mude a spec, o SDK e a função da Base44 juntos. */
const EXPECTED = [
  'get /v1/specialists',
  'get /v1/specialists/{specialistId}',
  'get /v1/autonomous-agents',
  'get /v1/autonomous-agents/{agentId}',
  'post /v1/autonomous-agents/{agentId}/execute',
  'get /v1/autonomous-agents/{agentId}/stream',
  'post /v1/openai/chat/completions',
  'get /v1/openai/models',
  'get /v1/repositories',
  'get /v1/repositories/{repositoryId}/files',
  'post /v1/audit/events/batch',
];

describe('openapi/adaflow.yaml', () => {
  it('é OpenAPI 3.1 apontando para o gateway de produção', () => {
    expect(spec.openapi).toBe('3.1.0');
    expect(spec.servers[0]?.url).toBe('https://zeus.adalink.app');
  });

  it('publica exatamente as rotas do Connect', () => {
    expect(operations().map(({ method, path }) => `${method} ${path}`).sort()).toEqual([...EXPECTED].sort());
  });

  it('não expõe rotas administrativas nem internas', () => {
    for (const path of Object.keys(spec.paths)) {
      expect(path).not.toMatch(/(^|\/)(admin|internal)(\/|$)/);
    }
  });

  it('autentica só com o token de app no header x-ada-token', () => {
    expect(spec.security).toEqual([{ AdaToken: [] }]);
    expect(spec.components.securitySchemes).toEqual({
      AdaToken: expect.objectContaining({ type: 'apiKey', in: 'header', name: 'x-ada-token' }),
    });
    for (const { op } of operations()) expect(op.security).toBeUndefined();
  });

  it('tem operationId único em toda operação (a Base44 e geradores de cliente dependem disso)', () => {
    const ids = operations().map(({ op }) => op.operationId);
    expect(ids.every(Boolean)).toBe(true);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('resolve todo $ref local', () => {
    const raw = readFileSync(new URL('../openapi/adaflow.yaml', import.meta.url), 'utf8');
    const refs = [...raw.matchAll(/\$ref: '#\/([^']+)'/g)].map((m) => m[1] as string);
    expect(refs.length).toBeGreaterThan(0);
    for (const ref of refs) {
      const target = ref.split('/').reduce<unknown>((node, key) => (node as Record<string, unknown>)?.[key], spec);
      expect(target, ref).toBeDefined();
    }
  });
});
