#!/usr/bin/env node
/**
 * create-adaflow-app — cria um app integrado à plataforma Adaflow a
 * partir de um template do integration kit.
 *
 * Fluxo: baixa `templates/<nome>` do monorepo via tiged (sem histórico git),
 * aplica o nome do projeto no package.json, troca a dependência `workspace:*`
 * do @adaflow/sdk pela versão publicada e inicializa um repositório git.
 */
import { execSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import tiged from 'tiged';
import {
  DEFAULT_TEMPLATE,
  KIT_REPO,
  TEMPLATES,
  buildTemplateSource,
  isTemplateName,
  rewritePackageJson,
  validateProjectName,
} from './scaffold.js';

interface CliArgs {
  dir?: string;
  template: string;
  help: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { template: DEFAULT_TEMPLATE, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--template' || arg === '-t') {
      args.template = argv[++i] ?? '';
    } else if (arg && !arg.startsWith('-') && !args.dir) {
      args.dir = arg;
    }
  }
  return args;
}

function printHelp(): void {
  console.log(`create-adaflow-app — cria um app integrado à plataforma Adaflow

Uso:
  pnpm create adaflow-app <diretório> [--template ${TEMPLATES.join('|')}]

Opções:
  -t, --template   Template a usar (default: ${DEFAULT_TEMPLATE})
  -h, --help       Mostra esta ajuda

Exemplo:
  pnpm create adaflow-app meu-app`);
}

async function askProjectDir(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return (await rl.question('Nome do projeto: ')).trim();
  } finally {
    rl.close();
  }
}

function fail(message: string): never {
  console.error(`\n✖ ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    printHelp();
    return;
  }

  if (!isTemplateName(args.template)) {
    fail(`Template desconhecido: "${args.template}". Disponíveis: ${TEMPLATES.join(', ')}.`);
  }

  const dirArg = args.dir ?? (await askProjectDir());
  const targetDir = resolve(dirArg);
  const projectName = basename(targetDir);

  const nameError = validateProjectName(projectName);
  if (nameError) fail(nameError);

  if (existsSync(targetDir) && readdirSync(targetDir).length > 0) {
    fail(`O diretório "${dirArg}" já existe e não está vazio.`);
  }

  console.log(`\nBaixando o template "${args.template}" de ${KIT_REPO}...`);
  try {
    const emitter = tiged(buildTemplateSource(args.template), { cache: false, force: true });
    await emitter.clone(targetDir);
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    fail(
      `Não foi possível baixar o template (${detail}).\n` +
        `  Verifique sua conexão e se "templates/${args.template}" já existe no repositório ${KIT_REPO}.`,
    );
  }

  const pkgPath = join(targetDir, 'package.json');
  if (existsSync(pkgPath)) {
    writeFileSync(pkgPath, rewritePackageJson(readFileSync(pkgPath, 'utf8'), projectName));
  }

  try {
    execSync('git init -q', { cwd: targetDir, stdio: 'ignore' });
  } catch {
    console.warn('⚠ git não encontrado — repositório não inicializado (rode "git init" depois).');
  }

  console.log(`\n✔ Projeto "${projectName}" criado em ${targetDir}

Próximos passos:
  cd ${dirArg}
  pnpm install
  pnpm dev

Documentação: https://github.com/${KIT_REPO}/blob/main/docs/INTEGRATED-APPS-GUIDE.md`);
}

main().catch((err: unknown) => {
  fail(err instanceof Error ? err.message : String(err));
});
