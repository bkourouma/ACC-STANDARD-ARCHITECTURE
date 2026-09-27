// Détection du projet cible : propose une acc.config.json complète.
// Ne lit jamais de fichier .env réel : seuls .env.example / env.example.
import fs from 'node:fs';
import path from 'node:path';
import { defaultConfig, slugify } from './config.mjs';
import { readTextIfExists, toLf } from './fs-utils.mjs';
import { detectMainBranch } from './git.mjs';
import { STANDARD_VERSION } from './version.mjs';

const PROTECTED_CANDIDATES = ['src', 'app', 'apps', 'packages', 'lib', 'uploads', 'assets', 'public'];
const DEFAULT_NPM_TEST = 'echo "Error: no test specified" && exit 1';

const has = (target, rel) => fs.existsSync(path.join(target, rel));
const isDir = (target, rel) => {
  try {
    return fs.statSync(path.join(target, rel)).isDirectory();
  } catch {
    return false;
  }
};

function readPackageJson(dir) {
  const text = readTextIfExists(path.join(dir, 'package.json'));
  if (text === null) return null;
  try {
    return JSON.parse(toLf(text));
  } catch {
    return null;
  }
}

function listDir(dir) {
  try {
    return fs.readdirSync(dir);
  } catch {
    return [];
  }
}

/** Gestionnaire de paquets d'après les lockfiles, puis le champ packageManager. */
function detectPackageManager(target, pkg) {
  if (!pkg) return 'none';
  if (has(target, 'pnpm-lock.yaml')) return 'pnpm';
  if (has(target, 'yarn.lock')) return 'yarn';
  if (has(target, 'bun.lockb') || has(target, 'bun.lock')) return 'bun';
  if (has(target, 'package-lock.json')) return 'npm';
  const declared = /^(npm|pnpm|yarn|bun)@/.exec(pkg.packageManager ?? '');
  return declared ? declared[1] : 'npm';
}

/** Motifs de workspaces déclarés (package.json ou pnpm-workspace.yaml). */
function workspacePatterns(target, pkg) {
  if (Array.isArray(pkg?.workspaces)) return pkg.workspaces;
  if (Array.isArray(pkg?.workspaces?.packages)) return pkg.workspaces.packages;
  const pnpm = readTextIfExists(path.join(target, 'pnpm-workspace.yaml'));
  if (pnpm) {
    return [...toLf(pnpm).matchAll(/^\s*-\s*['"]?([^'"\n]+)['"]?\s*$/gm)].map((m) => m[1].trim());
  }
  return [];
}

/** Dossiers des workspaces (motifs simples « dossier/* » ou chemins directs). */
function workspaceDirs(target, patterns) {
  const dirs = [];
  for (const pattern of patterns) {
    const clean = pattern.replace(/\\/g, '/').replace(/\/\*\*?$/, '/*');
    if (clean.endsWith('/*')) {
      const parent = clean.slice(0, -2);
      for (const name of listDir(path.join(target, parent))) {
        if (isDir(target, `${parent}/${name}`)) dirs.push(`${parent}/${name}`);
      }
    } else if (!clean.includes('*') && isDir(target, clean)) dirs.push(clean);
  }
  return dirs;
}

function allDeps(pkg) {
  return { ...(pkg?.dependencies ?? {}), ...(pkg?.devDependencies ?? {}), ...(pkg?.peerDependencies ?? {}) };
}

const anyFile = (target, names) => names.some((n) => has(target, n));
const anyPrefix = (target, prefixes) =>
  listDir(target).some((f) => prefixes.some((p) => f.startsWith(p)));

function detectLanguages(target, pkg, typescript) {
  const langs = [];
  if (pkg) langs.push('javascript');
  if (typescript) langs.push('typescript');
  if (anyFile(target, ['pyproject.toml', 'requirements.txt', 'setup.py', 'Pipfile'])) langs.push('python');
  if (has(target, 'go.mod')) langs.push('go');
  if (has(target, 'Cargo.toml')) langs.push('rust');
  if (anyFile(target, ['pom.xml', 'build.gradle', 'build.gradle.kts'])) langs.push('java');
  if (has(target, 'composer.json')) langs.push('php');
  if (has(target, 'Gemfile')) langs.push('ruby');
  return langs;
}

/** Commandes du projet, préfixées par le gestionnaire. */
function detectCommands(target, pkg, pm) {
  const commands = { install: '', dev: '', build: '', typecheck: '', lint: '', test: '' };
  if (!pkg) {
    if (has(target, 'requirements.txt')) commands.install = 'pip install -r requirements.txt';
    return commands;
  }
  commands.install = `${pm} install`;
  const scripts = pkg.scripts ?? {};
  const run = (name) => (pm === 'yarn' ? `yarn ${name}` : `${pm} run ${name}`);
  for (const name of ['dev', 'build', 'typecheck', 'lint']) {
    if (typeof scripts[name] === 'string') commands[name] = run(name);
  }
  if (typeof scripts.test === 'string' && scripts.test.trim() !== DEFAULT_NPM_TEST) {
    commands.test = pm === 'bun' ? 'bun run test' : `${pm} test`;
  }
  return commands;
}

/** Ports lus dans les fichiers d'exemple d'environnement (jamais .env). */
function detectPorts(target, wsDirs) {
  const ports = {};
  const dirs = ['', ...wsDirs];
  for (const dir of dirs) {
    for (const file of ['.env.example', 'env.example']) {
      const text = readTextIfExists(path.join(target, dir, file));
      if (text === null) continue;
      for (const m of toLf(text).matchAll(/^\s*(?:export\s+)?(?:([A-Z0-9_]+)_)?PORT\s*=\s*["']?(\d+)/gm)) {
        const key = m[1] ? m[1].toLowerCase() : dir ? path.basename(dir) : 'app';
        if (!(key in ports)) ports[key] = Number(m[2]);
      }
    }
  }
  return ports;
}

function detectPrisma(target, deps, wsDirs) {
  if ('prisma' in deps || '@prisma/client' in deps) return true;
  return ['', ...wsDirs].some((dir) => has(target, path.join(dir, 'prisma', 'schema.prisma')));
}

function detectHooks(commands) {
  const preCommit = [];
  if (commands.typecheck) {
    preCommit.push({
      name: 'typecheck',
      command: commands.typecheck,
      blocking: true,
      whenStaged: ['**/*.ts', '**/*.tsx'],
    });
  }
  if (commands.lint) {
    preCommit.push({ name: 'lint', command: commands.lint, blocking: false, whenStaged: [] });
  }
  return preCommit;
}

/** Avertissements utiles pour l'humain qui relit la proposition. */
function detectWarnings(target, deps) {
  const warnings = [];
  if (has(target, '.husky') || 'husky' in deps) {
    warnings.push(
      'Husky détecté : le standard installe ses hooks git via Lefthook ; retirer Husky ' +
        '(dossier .husky, script prepare) avant apply pour éviter deux gestionnaires de hooks.',
    );
  }
  if (has(target, 'lefthook.yml') || has(target, '.lefthook.yml')) {
    warnings.push('Configuration Lefthook existante : vérifier la fusion après apply.');
  }
  return warnings;
}

/**
 * Analyse la cible et renvoie { config, warnings }.
 * La config suit l'ordre et les clés du contrat.
 */
export function detectProject(target) {
  const pkg = readPackageJson(target);
  const pm = detectPackageManager(target, pkg);
  const patterns = workspacePatterns(target, pkg);
  const wsDirs = workspaceDirs(target, patterns);
  const deps = { ...allDeps(pkg), ...Object.assign({}, ...wsDirs.map((d) => allDeps(readPackageJson(path.join(target, d))))) };

  const typescript = 'typescript' in deps || has(target, 'tsconfig.json');
  const eslint = 'eslint' in deps || anyPrefix(target, ['eslint.config.', '.eslintrc']);
  const prettier = 'prettier' in deps || anyPrefix(target, ['.prettierrc', 'prettier.config.']);
  const name = (typeof pkg?.name === 'string' && pkg.name) || path.basename(path.resolve(target));
  const commands = detectCommands(target, pkg, pm);
  const mainBranch = detectMainBranch(target);

  const adapters = ['claude'];
  if (isDir(target, '.codex')) adapters.push('codex');
  if (isDir(target, '.cursor')) adapters.push('cursor');

  const destructiveCommands = [];
  if (detectPrisma(target, deps, wsDirs)) {
    destructiveCommands.push({
      pattern: '\\bprisma\\s+migrate\\s+reset\\b',
      reason: 'Efface la base de données : à lancer à la main, jamais par un agent.',
    });
  }
  destructiveCommands.push({
    pattern: '\\bDROP\\s+DATABASE\\b',
    reason: 'Suppression de base de données interdite aux agents.',
  });

  const config = {
    ...defaultConfig(),
    standardVersion: STANDARD_VERSION,
    project: { name, slug: slugify(name) || 'projet', description: pkg?.description ?? '', language: 'fr' },
    profiles: pkg ? ['base', 'node'] : ['base'],
    adapters,
    stack: {
      packageManager: pm,
      workspaces: patterns.length > 0,
      typescript,
      eslint,
      prettier,
      languages: detectLanguages(target, pkg, typescript),
    },
    commands,
    ports: detectPorts(target, wsDirs),
    git: { mainBranch, protectedBranches: [...new Set([mainBranch, 'main', 'master'])] },
    hooks: { preCommit: detectHooks(commands) },
    guard: {
      protectedPaths: PROTECTED_CANDIDATES.filter((d) => isDir(target, d)),
      destructiveCommands,
    },
    options: { agentBus: true, demoInstance: false },
    demo: {},
  };
  return { config, warnings: detectWarnings(target, deps) };
}
