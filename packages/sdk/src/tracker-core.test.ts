import { describe, expect, it } from 'vitest';
import {
  buildEventsPayload,
  chunkBatch,
  computeBackoffMs,
  dedupeNew,
  generateId,
  isValidAction,
  normalizeEvent,
} from './tracker-core.js';

describe('isValidAction', () => {
  it('aceita o formato app.<dominio>.<verbo>', () => {
    expect(isValidAction('app.contrato.aprovado')).toBe(true);
    expect(isValidAction('app.chat.mensagem-enviada')).toBe(true);
    expect(isValidAction('app.a.b.c.d.e')).toBe(true);
  });

  it('rejeita fora do namespace, maiúsculas e profundidade excessiva', () => {
    expect(isValidAction('contrato.aprovado')).toBe(false);
    expect(isValidAction('app.Contrato.Aprovado')).toBe(false);
    expect(isValidAction('app.x')).toBe(false);
    expect(isValidAction('app.a.b.c.d.e.f')).toBe(false);
  });
});

describe('normalizeEvent', () => {
  const base = { action: 'app.pedido.criado', resource: 'Pedido' };

  it('gera eventId determinístico via dep injetada e normaliza Date para ISO', () => {
    const event = normalizeEvent(
      { ...base, occurredAt: new Date('2026-07-20T12:00:00Z') },
      { id: () => 'fixo-1' },
    );
    expect(event.eventId).toBe('fixo-1');
    expect(event.occurredAt).toBe('2026-07-20T12:00:00.000Z');
  });

  it('preserva eventId explícito', () => {
    expect(normalizeEvent({ ...base, eventId: 'meu-id' }).eventId).toBe('meu-id');
  });

  it('lança em ação inválida e resource ausente', () => {
    expect(() => normalizeEvent({ ...base, action: 'pedido.criado' })).toThrow(/Ação inválida/);
    expect(() => normalizeEvent({ action: 'app.a.b', resource: '' })).toThrow(/resource/);
  });

  it('lança em metadata acima de 4KB', () => {
    expect(() =>
      normalizeEvent({ ...base, metadata: { blob: 'x'.repeat(5000) } }),
    ).toThrow(/4096 bytes/);
  });
});

describe('buildEventsPayload', () => {
  it('carimba o app em cada evento', () => {
    const payload = buildEventsPayload(
      [normalizeEvent({ action: 'app.a.b', resource: 'R', eventId: 'e1' })],
      'meu-app',
    );
    expect(payload).toEqual({
      events: [{ action: 'app.a.b', resource: 'R', eventId: 'e1', app: 'meu-app', occurredAt: undefined }],
    });
  });
});

describe('chunkBatch', () => {
  it('divide respeitando o teto', () => {
    expect(chunkBatch([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(chunkBatch([], 50)).toEqual([]);
    expect(chunkBatch([1], 1)).toEqual([[1]]);
  });

  it('lança com max inválido', () => {
    expect(() => chunkBatch([1], 0)).toThrow();
  });
});

describe('computeBackoffMs', () => {
  const fixed = { random: () => 0.5, baseMs: 1000, capMs: 30_000 };

  it('cresce exponencialmente com jitter determinístico', () => {
    const a0 = computeBackoffMs(0, undefined, fixed);
    const a1 = computeBackoffMs(1, undefined, fixed);
    const a2 = computeBackoffMs(2, undefined, fixed);
    expect(a1).toBeGreaterThan(a0);
    expect(a2).toBeGreaterThan(a1);
  });

  it('Retry-After prevalece e o cap limita', () => {
    expect(computeBackoffMs(0, 7, fixed)).toBe(7000);
    expect(computeBackoffMs(0, 999, fixed)).toBe(30_000);
    expect(computeBackoffMs(20, undefined, fixed)).toBe(30_000);
  });
});

describe('dedupeNew', () => {
  const ev = (id: string) => normalizeEvent({ action: 'app.a.b', resource: 'R', eventId: id });

  it('filtra ids já vistos e duplicatas dentro do próprio lote', () => {
    const result = dedupeNew([ev('a'), ev('b'), ev('a')], new Set(['b']));
    expect(result.map((e) => e.eventId)).toEqual(['a']);
  });
});

describe('generateId', () => {
  it('gera UUIDs únicos no shape correto', () => {
    const a = generateId();
    const b = generateId();
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(a).not.toBe(b);
  });
});
