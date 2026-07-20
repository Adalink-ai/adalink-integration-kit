import { describe, expect, it } from 'vitest';
import {
  SDK_PUBLISHED_VERSION,
  buildTemplateSource,
  isTemplateName,
  rewritePackageJson,
  validateProjectName,
} from './scaffold.js';

describe('validateProjectName', () => {
  it('aceita nomes válidos', () => {
    expect(validateProjectName('meu-app')).toBeNull();
    expect(validateProjectName('app2')).toBeNull();
    expect(validateProjectName('meu.app_v2')).toBeNull();
  });

  it('rejeita vazio', () => {
    expect(validateProjectName('')).toMatch(/Informe o nome/);
  });

  it('rejeita maiúsculas, espaços e acentos', () => {
    expect(validateProjectName('MeuApp')).toMatch(/inválido/);
    expect(validateProjectName('meu app')).toMatch(/inválido/);
    expect(validateProjectName('aplicação')).toMatch(/inválido/);
  });

  it('rejeita começar com separador', () => {
    expect(validateProjectName('-app')).toMatch(/inválido/);
    expect(validateProjectName('.app')).toMatch(/inválido/);
  });

  it('rejeita nome acima de 214 caracteres', () => {
    expect(validateProjectName('a'.repeat(215))).toMatch(/longo/);
  });
});

describe('buildTemplateSource', () => {
  it('monta o source da subpasta com ref default main', () => {
    expect(buildTemplateSource('nextjs')).toBe(
      'Adalink-ai/adalink-integration-kit/templates/nextjs#main',
    );
  });

  it('aceita ref explícita', () => {
    expect(buildTemplateSource('nextjs', 'v0.1.0')).toBe(
      'Adalink-ai/adalink-integration-kit/templates/nextjs#v0.1.0',
    );
  });
});

describe('isTemplateName', () => {
  it('reconhece templates conhecidos e rejeita desconhecidos', () => {
    expect(isTemplateName('nextjs')).toBe(true);
    expect(isTemplateName('svelte')).toBe(false);
  });
});

describe('rewritePackageJson', () => {
  it('aplica o nome e troca workspace:* do sdk pela versão publicada', () => {
    const raw = JSON.stringify({
      name: 'adaflow-template-nextjs',
      dependencies: { '@adaflow/sdk': 'workspace:*', next: '^16.0.0' },
    });
    const out = JSON.parse(rewritePackageJson(raw, 'meu-app'));
    expect(out.name).toBe('meu-app');
    expect(out.dependencies['@adaflow/sdk']).toBe(SDK_PUBLISHED_VERSION);
    expect(out.dependencies.next).toBe('^16.0.0');
  });

  it('troca também em devDependencies', () => {
    const raw = JSON.stringify({
      name: 't',
      devDependencies: { '@adaflow/sdk': 'workspace:^' },
    });
    const out = JSON.parse(rewritePackageJson(raw, 'meu-app'));
    expect(out.devDependencies['@adaflow/sdk']).toBe(SDK_PUBLISHED_VERSION);
  });

  it('não mexe em versão que já não é workspace', () => {
    const raw = JSON.stringify({
      name: 't',
      dependencies: { '@adaflow/sdk': '^0.2.0' },
    });
    const out = JSON.parse(rewritePackageJson(raw, 'meu-app'));
    expect(out.dependencies['@adaflow/sdk']).toBe('^0.2.0');
  });

  it('funciona sem o sdk nas dependências', () => {
    const raw = JSON.stringify({ name: 't', dependencies: { next: '^16.0.0' } });
    const out = JSON.parse(rewritePackageJson(raw, 'meu-app'));
    expect(out.name).toBe('meu-app');
  });

  it('termina com newline', () => {
    expect(rewritePackageJson('{"name":"t"}', 'meu-app').endsWith('\n')).toBe(true);
  });
});
