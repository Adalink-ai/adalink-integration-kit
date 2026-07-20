/**
 * Funções puras do scaffold — separadas do entrypoint para serem testáveis
 * sem tocar filesystem, rede ou processo.
 */

export const KIT_REPO = 'Adalink-ai/adalink-integration-kit';

export const TEMPLATES = ['nextjs'] as const;
export type TemplateName = (typeof TEMPLATES)[number];
export const DEFAULT_TEMPLATE: TemplateName = 'nextjs';

export const SDK_PACKAGE = '@adaflow/sdk';

/** Usada se o registry estiver inacessível no momento do scaffold. */
export const SDK_FALLBACK_VERSION = '^0.1.0';

/**
 * Resolve a versão mais recente do @adaflow/sdk no registry npm, como range
 * `^x.y.z`. Cai no fallback em qualquer falha — scaffold funciona offline.
 */
export async function resolveSdkVersion(fetchImpl: typeof fetch = fetch): Promise<string> {
  try {
    const res = await fetchImpl(
      `https://registry.npmjs.org/${SDK_PACKAGE.replace('/', '%2f')}/latest`,
    );
    if (!res.ok) return SDK_FALLBACK_VERSION;
    const { version } = (await res.json()) as { version?: string };
    return version ? `^${version}` : SDK_FALLBACK_VERSION;
  } catch {
    return SDK_FALLBACK_VERSION;
  }
}

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
 * dependência `workspace:*` do @adaflow/sdk pela versão publicada
 * (resolvida via `resolveSdkVersion`).
 */
export function rewritePackageJson(
  raw: string,
  projectName: string,
  sdkVersion: string = SDK_FALLBACK_VERSION,
): string {
  const pkg = JSON.parse(raw) as Record<string, unknown>;
  pkg['name'] = projectName;

  for (const field of ['dependencies', 'devDependencies'] as const) {
    const deps = pkg[field] as Record<string, string> | undefined;
    const current = deps?.[SDK_PACKAGE];
    if (deps && current?.startsWith('workspace:')) {
      deps[SDK_PACKAGE] = sdkVersion;
    }
  }

  return `${JSON.stringify(pkg, null, 2)}\n`;
}
