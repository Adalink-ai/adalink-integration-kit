#!/usr/bin/env node
/**
 * adaflow — CLI oficial da plataforma Adaflow.
 *
 * `adaflow skills add|update|list` gerencia as skills de agente (Claude Code)
 * do integration kit no projeto local (`.claude/skills/`) ou globalmente
 * (`~/.claude/skills`). O conteúdo vem sempre da main do kit no GitHub.
 */
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';
import tiged from 'tiged';
import {
  KIT_REPO,
  MANIFEST_FILE,
  SKILLS_SOURCE,
  type SkillsManifest,
  classifySkills,
  emptyManifest,
  parseManifest,
  planAdd,
  planUpdate,
  resolveTargetDir,
} from './skills.js';

interface CliArgs {
  command?: string;
  subcommand?: string;
  names: string[];
  global: boolean;
  dir?: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { names: [], global: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') args.help = true;
    else if (arg === '--global' || arg === '-g') args.global = true;
    else if (arg === '--dir' || arg === '-d') args.dir = argv[++i];
    else if (arg && !arg.startsWith('-')) {
      if (!args.command) args.command = arg;
      else if (!args.subcommand) args.subcommand = arg;
      else args.names.push(arg);
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`adaflow — CLI oficial da plataforma Adaflow

Uso:
  adaflow skills add [nomes...]   Instala skills (todas, se nenhum nome)
  adaflow skills update           Atualiza as skills gerenciadas pela CLI
  adaflow skills list             Mostra instaladas e disponíveis

Opções:
  -g, --global      Usa ~/.claude/skills em vez do projeto atual
  -d, --dir <path>  Raiz do projeto de destino (default: diretório atual)
  -h, --help        Mostra esta ajuda

Exemplos:
  npx @adaflow/cli skills add
  npx @adaflow/cli skills add adaflow-sso --global
  npx @adaflow/cli skills update`);
}

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

/** Baixa `skills/` da main do kit para um diretório temporário. */
async function downloadSkills(): Promise<{ dir: string; names: string[] }> {
  const dir = mkdtempSync(join(tmpdir(), 'adaflow-skills-'));
  try {
    const emitter = tiged(SKILLS_SOURCE, { cache: false, force: true });
    await emitter.clone(dir);
  } catch (err) {
    rmSync(dir, { recursive: true, force: true });
    const detail = err instanceof Error ? err.message : String(err);
    fail(`Não foi possível baixar as skills do ${KIT_REPO} (${detail}). Verifique sua conexão.`);
  }
  const names = readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(dir, entry.name, 'SKILL.md')))
    .map((entry) => entry.name)
    .sort();
  return { dir, names };
}

/** Commit atual da main (best-effort — manifest fica sem commit se falhar). */
async function fetchHeadCommit(): Promise<string | undefined> {
  try {
    const res = await fetch(`https://api.github.com/repos/${KIT_REPO}/commits/main`, {
      headers: { accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return undefined;
    const body = (await res.json()) as { sha?: string };
    return body.sha;
  } catch {
    return undefined;
  }
}

function readLocalState(targetDir: string): { manifest: SkillsManifest; localDirs: string[] } {
  const manifestPath = join(targetDir, MANIFEST_FILE);
  const manifest = existsSync(manifestPath)
    ? parseManifest(readFileSync(manifestPath, 'utf8'))
    : emptyManifest();
  const localDirs = existsSync(targetDir)
    ? readdirSync(targetDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => entry.name)
    : [];
  return { manifest, localDirs };
}

function installSkills(
  names: string[],
  sourceDir: string,
  targetDir: string,
  manifest: SkillsManifest,
  commit: string | undefined,
): void {
  mkdirSync(targetDir, { recursive: true });
  const now = new Date().toISOString();
  for (const name of names) {
    const dest = join(targetDir, name);
    rmSync(dest, { recursive: true, force: true });
    cpSync(join(sourceDir, name), dest, { recursive: true });
    manifest.skills[name] = { installedAt: now };
    console.log(`✓ ${name}`);
  }
  manifest.source = KIT_REPO;
  manifest.commit = commit;
  manifest.updatedAt = now;
  writeFileSync(join(targetDir, MANIFEST_FILE), `${JSON.stringify(manifest, null, 2)}\n`);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help || !args.command) {
    printHelp();
    return;
  }
  if (args.command !== 'skills') {
    fail(`Comando desconhecido: "${args.command}". Disponível: skills (add|update|list).`);
  }

  const targetDir = resolveTargetDir({
    global: args.global,
    dir: args.dir,
    cwd: process.cwd(),
    home: homedir(),
  });
  const { manifest, localDirs } = readLocalState(targetDir);
  const managed = Object.keys(manifest.skills);

  const sub = args.subcommand;
  if (sub !== 'add' && sub !== 'update' && sub !== 'list') {
    fail(`Subcomando desconhecido: "${sub ?? ''}". Use: adaflow skills add|update|list.`);
  }

  const [{ dir: sourceDir, names: available }, commit] = await Promise.all([
    downloadSkills(),
    fetchHeadCommit(),
  ]);

  try {
    if (sub === 'add') {
      const plan = planAdd(available, args.names, localDirs, managed);
      if (plan.unknown.length > 0) {
        fail(`Skills inexistentes no kit: ${plan.unknown.join(', ')}. Disponíveis: ${available.join(', ')}.`);
      }
      for (const name of plan.skippedUnmanaged) {
        console.warn(`⚠ ${name} já existe localmente e não é gerenciada pela CLI — mantida como está.`);
      }
      if (plan.toInstall.length === 0) {
        console.log('Nada para instalar.');
        return;
      }
      installSkills(plan.toInstall, sourceDir, targetDir, manifest, commit);
      console.log(`\nSkills instaladas em ${targetDir}`);
    } else if (sub === 'update') {
      const plan = planUpdate(available, managed, localDirs);
      for (const name of plan.removedUpstream) {
        console.warn(`⚠ ${name} foi removida do kit — mantida localmente (remova manualmente se quiser).`);
      }
      for (const name of plan.missingLocal) {
        console.warn(`⚠ ${name} está no manifest mas foi apagada localmente — use "skills add ${name}" para reinstalar.`);
      }
      if (plan.toUpdate.length === 0) {
        console.log(managed.length === 0
          ? 'Nenhuma skill gerenciada pela CLI neste destino — use "adaflow skills add" primeiro.'
          : 'Nada para atualizar.');
        return;
      }
      installSkills(plan.toUpdate, sourceDir, targetDir, manifest, commit);
      console.log(`\nSkills atualizadas em ${targetDir}`);
    } else {
      const rows = classifySkills(available, managed, localDirs);
      const sha = commit ? ` @ ${commit.slice(0, 7)}` : '';
      console.log(`Skills do kit ${KIT_REPO}${sha} — destino: ${targetDir}\n`);
      for (const row of rows) {
        console.log(`  ${row.name.padEnd(32)} ${row.status}`);
      }
      if (manifest.commit && commit && manifest.commit !== commit) {
        console.log('\nHá atualizações no kit desde a última instalação — rode "adaflow skills update".');
      }
    }
  } finally {
    rmSync(sourceDir, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
