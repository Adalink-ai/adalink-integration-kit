import { describe, expect, it } from 'vitest';
import {
  KIT_REPO,
  classifySkills,
  emptyManifest,
  parseManifest,
  planAdd,
  planUpdate,
  resolveTargetDir,
} from './skills.js';

describe('parseManifest', () => {
  it('parseia manifest válido', () => {
    const raw = JSON.stringify({
      source: KIT_REPO,
      commit: 'abc123',
      skills: { 'adaflow-sso': { installedAt: '2026-07-20T00:00:00Z' } },
    });
    const manifest = parseManifest(raw);
    expect(manifest.commit).toBe('abc123');
    expect(Object.keys(manifest.skills)).toEqual(['adaflow-sso']);
  });

  it('JSON corrompido vira manifest vazio', () => {
    expect(parseManifest('{oops')).toEqual(emptyManifest());
  });

  it('campos com tipo errado são descartados', () => {
    const manifest = parseManifest(JSON.stringify({ commit: 42, skills: 'nope' }));
    expect(manifest.commit).toBeUndefined();
    expect(manifest.skills).toEqual({});
  });
});

describe('resolveTargetDir', () => {
  const base = { cwd: '/proj', home: '/home/dev' };

  it('default: .claude/skills do diretório atual', () => {
    expect(resolveTargetDir(base)).toBe('/proj/.claude/skills');
  });

  it('--global: ~/.claude/skills', () => {
    expect(resolveTargetDir({ ...base, global: true })).toBe('/home/dev/.claude/skills');
  });

  it('--dir tem precedência sobre cwd', () => {
    expect(resolveTargetDir({ ...base, dir: '/outro/app' })).toBe('/outro/app/.claude/skills');
  });

  it('--global tem precedência sobre --dir', () => {
    expect(resolveTargetDir({ ...base, dir: '/outro', global: true })).toBe(
      '/home/dev/.claude/skills',
    );
  });
});

describe('planAdd', () => {
  const available = ['adaflow-sso', 'adaflow-assistants', 'adaflow-generic-chat'];

  it('sem nomes: instala todas', () => {
    const plan = planAdd(available, [], [], []);
    expect(plan.toInstall).toEqual(available);
    expect(plan.unknown).toEqual([]);
  });

  it('com nomes: instala só as pedidas', () => {
    const plan = planAdd(available, ['adaflow-sso'], [], []);
    expect(plan.toInstall).toEqual(['adaflow-sso']);
  });

  it('nome inexistente vai para unknown', () => {
    const plan = planAdd(available, ['adaflow-xyz'], [], []);
    expect(plan.unknown).toEqual(['adaflow-xyz']);
    expect(plan.toInstall).toEqual([]);
  });

  it('skill local não gerenciada nunca é sobrescrita', () => {
    const plan = planAdd(available, [], ['adaflow-sso'], []);
    expect(plan.skippedUnmanaged).toEqual(['adaflow-sso']);
    expect(plan.toInstall).toEqual(['adaflow-assistants', 'adaflow-generic-chat']);
  });

  it('skill gerenciada existente é reinstalada', () => {
    const plan = planAdd(available, [], ['adaflow-sso'], ['adaflow-sso']);
    expect(plan.toInstall).toContain('adaflow-sso');
    expect(plan.skippedUnmanaged).toEqual([]);
  });
});

describe('planUpdate', () => {
  const available = ['adaflow-sso', 'adaflow-assistants'];

  it('atualiza só gerenciadas presentes localmente', () => {
    const plan = planUpdate(available, ['adaflow-sso'], ['adaflow-sso', 'outra-skill']);
    expect(plan.toUpdate).toEqual(['adaflow-sso']);
  });

  it('gerenciada removida do kit vai para removedUpstream', () => {
    const plan = planUpdate(available, ['adaflow-antiga'], ['adaflow-antiga']);
    expect(plan.removedUpstream).toEqual(['adaflow-antiga']);
    expect(plan.toUpdate).toEqual([]);
  });

  it('gerenciada apagada localmente vai para missingLocal', () => {
    const plan = planUpdate(available, ['adaflow-sso'], []);
    expect(plan.missingLocal).toEqual(['adaflow-sso']);
    expect(plan.toUpdate).toEqual([]);
  });
});

describe('classifySkills', () => {
  it('classifica gerenciada, disponível e não gerenciada', () => {
    const rows = classifySkills(
      ['adaflow-sso', 'adaflow-assistants'],
      ['adaflow-sso'],
      ['adaflow-sso', 'minha-skill'],
    );
    expect(rows).toEqual([
      { name: 'adaflow-assistants', status: 'disponível' },
      { name: 'adaflow-sso', status: 'gerenciada' },
      { name: 'minha-skill', status: 'não gerenciada' },
    ]);
  });
});
