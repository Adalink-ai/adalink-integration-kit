import { describe, expect, it, vi } from 'vitest';
import { buildAccessEvent, defineAuditEvents, recordAppAccess, uuidV5 } from './audit-catalog.js';
import type { AdaflowIdentity } from './jwt-verifier.js';

const identity: AdaflowIdentity = {
  sub: 'u1',
  email: 'pessoa@cliente.com',
  sessionId: 's1',
  issuedAt: new Date('2026-09-30T12:00:00Z'),
  expiresAt: new Date('2026-09-30T12:15:00Z'),
  claims: {},
};

describe('uuidV5', () => {
  it('bate com o vetor conhecido da RFC (namespace DNS)', async () => {
    await expect(uuidV5('www.example.com', '6ba7b810-9dad-11d1-80b4-00c04fd430c8')).resolves.toBe(
      '2ed6657d-e927-568b-95e1-2665a8aea6a2',
    );
  });

  it('é determinístico e sensível ao nome', async () => {
    expect(await uuidV5('a')).toBe(await uuidV5('a'));
    expect(await uuidV5('a')).not.toBe(await uuidV5('b'));
  });
});

describe('defineAuditEvents', () => {
  const events = defineAuditEvents('amcor-rfqs', {
    quoteApproved: { action: 'app.cotacao.aprovada', label: 'Cotação aprovada', resource: 'Cotacao' },
    quoteDeleted: {
      action: 'app.cotacao.removida',
      label: 'Cotação removida',
      resource: 'Cotacao',
      severity: 'warning',
    },
  });

  it('valida a ação na definição', () => {
    expect(() =>
      defineAuditEvents('x', { bad: { action: 'cotação.aprovada', label: 'L', resource: 'R' } }),
    ).toThrow(/ação inválida/);
  });

  it('exige scope, resource e label', () => {
    expect(() => defineAuditEvents('', {})).toThrow(/scope/);
    expect(() => defineAuditEvents('x', { e: { action: 'app.a.b', label: 'L', resource: '' } })).toThrow(/resource/);
    expect(() => defineAuditEvents('x', { e: { action: 'app.a.b', label: '', resource: 'R' } })).toThrow(/label/);
  });

  it('monta o evento com defaults e subjectId na metadata', async () => {
    const event = await events.build('quoteDeleted', { subjectId: 'q1', metadata: { origem: 'tela' } });
    expect(event).toMatchObject({
      action: 'app.cotacao.removida',
      actionLabel: 'Cotação removida',
      resource: 'Cotacao',
      severity: 'warning',
      success: true,
      metadata: { subjectId: 'q1', origem: 'tela' },
    });
  });

  it('eventId é idempotente por (scope, evento, objeto, ocorrência)', async () => {
    const a = await events.build('quoteApproved', { subjectId: 'q1' });
    const b = await events.build('quoteApproved', { subjectId: 'q1' });
    const c = await events.build('quoteApproved', { subjectId: 'q1', occurrence: '2' });
    const other = defineAuditEvents('outro-app', events.specs);
    const d = await other.build('quoteApproved', { subjectId: 'q1' });
    expect(a.eventId).toBe(b.eventId);
    expect(c.eventId).not.toBe(a.eventId);
    expect(d.eventId).not.toBe(a.eventId);
  });

  it('recusa metadata acima de 4 KB', async () => {
    await expect(events.build('quoteApproved', { subjectId: 'q1', metadata: { x: 'a'.repeat(5000) } })).rejects.toThrow(
      /4096/,
    );
  });
});

describe('registro de acesso', () => {
  it('evento de acesso concedido e negado', async () => {
    const granted = await buildAccessEvent({ identity, app: 'amcor-rfqs' });
    expect(granted).toMatchObject({
      action: 'app.acesso.login',
      category: 'acesso',
      resource: 'Aplicativo',
      success: true,
      severity: 'info',
    });
    const denied = await buildAccessEvent({ identity, app: 'amcor-rfqs', outcome: 'denied', reason: 'sem_cadastro' });
    expect(denied).toMatchObject({
      action: 'app.acesso.negado',
      success: false,
      severity: 'warning',
      metadata: { reason: 'sem_cadastro' },
    });
    expect(denied.eventId).not.toBe(granted.eventId);
  });

  it('mesmo token trocado duas vezes gera o mesmo eventId; novo login gera outro', async () => {
    const a = await buildAccessEvent({ identity, app: 'app' });
    const b = await buildAccessEvent({ identity, app: 'app' });
    const c = await buildAccessEvent({ identity: { ...identity, issuedAt: new Date('2026-09-30T13:00:00Z') }, app: 'app' });
    expect(a.eventId).toBe(b.eventId);
    expect(c.eventId).not.toBe(a.eventId);
  });

  it('recordAppAccess assina com o JWT da pessoa e envia ao batch', async () => {
    const fetchMock = vi.fn(async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify({ accepted: 1, duplicated: 0, rejected: [] }), { status: 202 }),
    );
    const res = await recordAppAccess(
      { token: 'jwt-da-pessoa', identity, app: 'amcor-rfqs' },
      { baseUrl: 'https://gw.example.com', fetch: fetchMock as unknown as typeof fetch },
    );
    expect(res).toEqual({ ok: true, result: { accepted: 1, duplicated: 0, rejected: [] } });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://gw.example.com/v1/audit/events/batch');
    expect((init?.headers as Record<string, string>).authorization).toBe('Bearer jwt-da-pessoa');
    const body = JSON.parse(String(init?.body));
    expect(body.events[0]).toMatchObject({ app: 'amcor-rfqs', action: 'app.acesso.login' });
  });

  it('recordAppAccess nunca lança', async () => {
    const fetchMock = vi.fn(async () => {
      throw new TypeError('fetch failed');
    });
    const res = await recordAppAccess(
      { token: 't', identity, app: 'app' },
      { baseUrl: 'https://gw.example.com', fetch: fetchMock as unknown as typeof fetch },
    );
    expect(res.ok).toBe(false);
  });
});
