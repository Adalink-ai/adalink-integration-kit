/**
 * Funções puras do scaffold — separadas do entrypoint para serem testáveis
 * sem tocar filesystem, rede ou processo.
 */

export const KIT_REPO = 'Adalink-ai/adalink-integration-kit';

export const TEMPLATES = ['nextjs'] as const;
export type TemplateName = (typeof TEMPLATES)[number];
export const DEFAULT_TEMPLATE: TemplateName = 'nextjs';

/**
 * Versão publicada do @adaflow/sdk gravada no app gerado. Dentro do monorepo o
 * template usa `workspace:*`, que não resolve fora dele — o scaffold reescreve.
 */
export const SDK_PUBLISHED_VERSION = '^0.1.0';

export function isTemplateName(value: string): value is TemplateName {
  return (TEMPLATES as readonly string[]).includes(value);
}

/** Source do tiged para a subpasta do template no monorepo. */
export function buildTemplateSource(template: TemplateName, ref = 'main'): string {
  return `${KIT_REPO}/templates/${template}#${ref}`;
}

/**
 * Valida o nome do projeto (regras de package name do npm, simplificadas).
 * Retorna a mensagem de erro, ou `null` se o nome é válido.
 */
export function validateProjectName(name: string): string | null {
  if (!name) return 'Informe o nome do projeto.';
  if (name.length > 214) return 'Nome do projeto muito longo (máx. 214 caracteres).';
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(name)) {
    return 'Nome inválido: use apenas letras minúsculas, números, ".", "_" e "-" (sem espaços nem acentos).';
  }
  return null;
}

/**
 * Reescreve o package.json do app gerado: aplica o nome do projeto e troca a
 * dependência `workspace:*` do @adaflow/sdk pela versão publicada.
 */
export function rewritePackageJson(raw: string, projectName: string): string {
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  pkg['name'] = projectName;

  for (const field of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[field] as Record<string, string> | undefined;
    const sdkVersion = deps?.['@adaflow/sdk'];
    if (deps && sdkVersion?.startsWith('workspace:')) {
      deps['@adaflow/sdk'] = SDK_PUBLISHED_VERSION;
    }
  }

  return `${JSON.stringify(pkg, null, 2)}\n`;
}
