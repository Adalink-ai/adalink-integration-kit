/**
 * Funções puras do gerenciador de skills — separadas do entrypoint para serem
 * testáveis sem tocar filesystem ou rede.
 *
 * As skills vivem em `skills/` no monorepo do integration kit e são baixadas
 * sempre da `main` — editar uma skill e dar push já atualiza todo mundo no
 * próximo `adaflow skills update`, sem release de pacote.
 */
import { join } from 'node:path';

export const KIT_REPO = 'Adalink-ai/adalink-integration-kit';
export const SKILLS_SOURCE = `${KIT_REPO}/skills#main`;

/** Manifest gravado dentro do diretório de skills — rastreia o que a CLI gerencia. */
export const MANIFEST_FILE = '.adaflow-skills.json';

export interface SkillsManifest {
  source: string;
  /** Commit da main no momento da instalação (best-effort). */
  commit?: string;
  updatedAt?: string;
  skills: Record<string, { installedAt: string }>;
}

export function emptyManifest(): SkillsManifest {
  return { source: KIT_REPO, skills: {} };
}

/** Parse tolerante: manifest corrompido ou de versão antiga vira manifest vazio. */
export function parseManifest(raw: string): SkillsManifest {
  try {
    const parsed = JSON.parse(raw) as Partial<SkillsManifest>;
    if (typeof parsed !== 'object' || parsed === null) return emptyManifest();
    return {
      source: typeof parsed.source === 'string' ? parsed.source : KIT_REPO,
      commit: typeof parsed.commit === 'string' ? parsed.commit : undefined,
      updatedAt: typeof parsed.updatedAt === 'string' ? parsed.updatedAt : undefined,
      skills: typeof parsed.skills === 'object' && parsed.skills !== null ? parsed.skills : {},
    };
  } catch {
    return emptyManifest();
  }
}

export interface TargetOptions {
  /** `--global`: instala em ~/.claude/skills (vale para todos os projetos). */
  global?: boolean;
  /** `--dir`: destino explícito (raiz do projeto). */
  dir?: string;
  cwd: string;
  home: string;
}

/** Resolve o diretório de skills de destino. */
export function resolveTargetDir(opts: TargetOptions): string {
  if (opts.global) return join(opts.home, '.claude', 'skills');
  const root = opts.dir ?? opts.cwd;
  return join(root, '.claude', 'skills');
}

export interface AddPlan {
  toInstall: string[];
  /** Pedidas mas inexistentes no kit. */
  unknown: string[];
  /** Existem localmente mas não são gerenciadas pela CLI — não sobrescrever. */
  skippedUnmanaged: string[];
}

/**
 * Plano do `skills add`. Sem nomes pedidos, instala todas as disponíveis.
 * Skill local não gerenciada (sem entrada no manifest) nunca é sobrescrita —
 * pode ser uma customização do time.
 */
export function planAdd(
  available: string[],
  requested: string[],
  localDirs: string[],
  managed: string[],
): AddPlan {
  const wanted = requested.length > 0 ? requested : available;
  const unknown = wanted.filter((name) => !available.includes(name));
  const valid = wanted.filter((name) => available.includes(name));
  const skippedUnmanaged = valid.filter(
    (name) => localDirs.includes(name) && !managed.includes(name),
  );
  const toInstall = valid.filter((name) => !skippedUnmanaged.includes(name));
  return { toInstall, unknown, skippedUnmanaged };
}

export interface UpdatePlan {
  toUpdate: string[];
  /** Gerenciadas que sumiram do kit (removidas upstream). */
  removedUpstream: string[];
  /** Gerenciadas apagadas localmente — não reinstala sem `add` explícito. */
  missingLocal: string[];
}

/** Plano do `skills update`: só toca no que está no manifest E existe localmente. */
export function planUpdate(
  available: string[],
  managed: string[],
  localDirs: string[],
): UpdatePlan {
  const removedUpstream = managed.filter((name) => !available.includes(name));
  const present = managed.filter((name) => available.includes(name));
  const missingLocal = present.filter((name) => !localDirs.includes(name));
  const toUpdate = present.filter((name) => localDirs.includes(name));
  return { toUpdate, removedUpstream, missingLocal };
}

export type SkillStatus = 'gerenciada' | 'disponível' | 'não gerenciada';

/** Classifica cada skill para o `skills list`. */
export function classifySkills(
  available: string[],
  managed: string[],
  localDirs: string[],
): Array<{ name: string; status: SkillStatus }> {
  const names = [...new Set([...available, ...localDirs])].sort();
  return names.map((name) => {
    if (managed.includes(name) && localDirs.includes(name)) {
      return { name, status: 'gerenciada' as const };
    }
    if (localDirs.includes(name)) return { name, status: 'não gerenciada' as const };
    return { name, status: 'disponível' as const };
  });
}
