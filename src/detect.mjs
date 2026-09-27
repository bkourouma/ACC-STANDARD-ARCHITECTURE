// Détection du projet cible : propose une acc.config.json complète.
// Ne lit jamais de fichier .env réel : seuls .env.example / env.example.
import fs from 'node:fs';
import path from 'node:path';
import { defaultConfig, slugify } from './config.mjs';
import { readTextIfExists, toLf } from './fs-utils.mjs';
import { detectMainBranch, isGitRepo } from './git.mjs';
import { STANDARD_VERSION } from './version.mjs';

const PROTECTED_CANDIDATES = ['src', 'app', 'apps', 'packages', 'lib', 'uploads', 'assets', 'public'];
const DEFAULT_NPM_TEST = 'echo "Error: no test specified" && exit 1';
const PROJECT_MARKER_FILES = ['package.json', 'pyproject.toml', 'requirements.txt', 'go.mod', 'Cargo.toml'];
const IMPLICIT_TYPECHECK = 'npx tsc --noEmit';
// Next.js ≥ 16 : tsc a besoin des types de routes générés par `next typegen`.
const NEXT_TYPEGEN_TYPECHECK = 'npx next typegen && npx tsc --noEmit';
const NEXT_TYPEGEN_MAJOR = 16;
// Ports par défaut des serveurs de développement (voir §7 du contrat).
const FRAMEWORK_PORTS = [
  { dep: 'next', port: 3000 },
  { dep: 'vite', port: 5173 },
];
const DOCKERFILE_RE = /^(?:Dockerfile(?:\..+)?|.+\.Dockerfile)$/i;

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

/**
 * Version majeure d'une plage de dépendance (« ^16.0.1 », « 16.3.6 »,
 * « >=15 ») ; null si elle ne commence pas par un numéro (« latest »,
 * « canary », « workspace:* »…).
 */
export function majorVersion(range) {
  const match = /^\s*(?:[\^~]|[<>]=?|=)?\s*v?(\d+)/.exec(String(range ?? ''));
  return match ? Number(match[1]) : null;
}

/** Vrai si le package.json dépend de Next.js en version ≥ 16. */
function usesNextTypegen(pkg) {
  const major = majorVersion(allDeps(pkg).next);
  return major !== null && major >= NEXT_TYPEGEN_MAJOR;
}

/**
 * Commandes du projet, préfixées par le gestionnaire. Si TypeScript est
 * détecté et qu'aucun script `typecheck` n'existe, propose `npx tsc --noEmit`
 * — précédé de `npx next typegen` pour Next.js ≥ 16 — (voir §7 du contrat)
 * plutôt que de laisser la commande vide.
 */
function detectCommands(target, pkg, pm, typescript) {
  const commands = { install: '', dev: '', build: '', typecheck: '', lint: '', test: '' };
  if (!pkg) {
    if (has(target, 'requirements.txt')) commands.install = 'pip install -r requirements.txt';
    if (typescript) commands.typecheck = IMPLICIT_TYPECHECK;
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
  if (!commands.typecheck && typescript) {
    commands.typecheck = usesNextTypegen(pkg) ? NEXT_TYPEGEN_TYPECHECK : IMPLICIT_TYPECHECK;
  }
  return commands;
}

/**
 * Ports, sans écraser une clé déjà trouvée (§7 du contrat) : fichiers
 * d'exemple d'environnement (jamais .env), puis `.claude/launch.json`, puis
 * port par défaut du cadriciel de chaque paquet.
 */
function detectPorts(target, wsDirs) {
  const ports = {};
  const dirs = ['', ...wsDirs];
  const dirKey = (dir) => (dir ? path.basename(dir) : 'app');
  for (const dir of dirs) {
    for (const file of ['.env.example', 'env.example']) {
      const text = readTextIfExists(path.join(target, dir, file));
      if (text === null) continue;
      for (const m of toLf(text).matchAll(/^\s*(?:export\s+)?(?:([A-Z0-9_]+)_)?PORT\s*=\s*["']?(\d+)/gm)) {
        const key = m[1] ? m[1].toLowerCase() : dirKey(dir);
        if (!(key in ports)) ports[key] = Number(m[2]);
      }
    }
  }
  for (const { name, port } of launchPorts(target)) {
    const key = slugify(name) || 'app';
    if (!(key in ports)) ports[key] = port;
  }
  const used = () => new Set(Object.values(ports));
  for (const dir of dirs) {
    const port = frameworkPort(readPackageJson(path.join(target, dir)));
    const key = dirKey(dir);
    if (port !== null && !(key in ports) && !used().has(port)) ports[key] = port;
  }
  return ports;
}

/** Ports déclarés dans `.claude/launch.json` (configurations[].port). */
function launchPorts(target) {
  const text = readTextIfExists(path.join(target, '.claude', 'launch.json'));
  if (text === null) return [];
  let launch;
  try {
    launch = JSON.parse(toLf(text));
  } catch {
    return [];
  }
  const configurations = Array.isArray(launch?.configurations) ? launch.configurations : [];
  return configurations
    .filter((c) => Number.isInteger(c?.port) && c.port > 0)
    .map((c) => ({ name: typeof c.name === 'string' ? c.name : '', port: c.port }));
}

/**
 * Port du serveur de développement d'un paquet : celui passé par `-p` /
 * `--port` dans son script `dev`, sinon le port par défaut du cadriciel.
 */
function frameworkPort(pkg) {
  const deps = allDeps(pkg);
  const framework = FRAMEWORK_PORTS.find((f) => f.dep in deps);
  if (!framework) return null;
  const dev = typeof pkg.scripts?.dev === 'string' ? pkg.scripts.dev : '';
  const explicit = /(?:^|\s)(?:-p|--port)(?:\s+|=)(\d+)\b/.exec(dev);
  return explicit ? Number(explicit[1]) : framework.port;
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
    preCommit.push({
      name: 'lint',
      command: commands.lint,
      blocking: false,
      whenStaged: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    });
  }
  return preCommit;
}

/**
 * Vrai si la cible ne ressemble à aucun projet reconnu : ni `package.json`,
 * ni marqueur d'un autre langage (§1 du contrat), ni dépôt git (pas de
 * `.git` à sa racine, et `git rev-parse` échoue — donc pas non plus un
 * sous-dossier d'un dépôt parent).
 */
export function isUnrecognizedTarget(target) {
  if (anyFile(target, PROJECT_MARKER_FILES)) return false;
  if (has(target, '.git')) return false;
  if (isGitRepo(target)) return false;
  return true;
}

const isSkippedDir = (name) => name === 'node_modules' || name === '.git' || name.startsWith('.');
const looksLikeProject = (dir) => fs.existsSync(path.join(dir, 'package.json')) || fs.existsSync(path.join(dir, '.git'));

/**
 * Sous-dossiers directs (profondeur 1 et 2, hors `node_modules`, `.git` et
 * dossiers cachés) qui contiennent un `.git` ou un `package.json` — les
 * candidats à proposer quand la cible elle-même n'est pas reconnue.
 */
export function findNearbyProjects(target) {
  const found = [];
  for (const name1 of listDir(target)) {
    if (isSkippedDir(name1) || !isDir(target, name1)) continue;
    const abs1 = path.join(target, name1);
    if (looksLikeProject(abs1)) found.push(name1);
    for (const name2 of listDir(abs1)) {
      if (isSkippedDir(name2) || !isDir(abs1, name2)) continue;
      const abs2 = path.join(abs1, name2);
      if (looksLikeProject(abs2)) found.push(`${name1}/${name2}`);
    }
  }
  return found.sort();
}

/** Dockerfiles de la racine et des workspaces (chemins relatifs POSIX). */
function findDockerfiles(target, wsDirs) {
  return ['', ...wsDirs].flatMap((dir) =>
    listDir(path.join(target, dir))
      .filter((name) => DOCKERFILE_RE.test(name) && !isDir(target, path.join(dir, name)))
      .map((name) => (dir ? `${dir}/${name}` : name)),
  );
}

/** Avertissements propres à un projet Node (package.json racine). */
function nodeWarnings(target, pkg, wsDirs) {
  const warnings = [];
  const scripts = pkg.scripts ?? {};
  if (usesNextTypegen(pkg) && typeof scripts.typecheck === 'string' && !/\btypegen\b/.test(scripts.typecheck)) {
    warnings.push(
      `Next.js ≥ ${NEXT_TYPEGEN_MAJOR} : le script typecheck (« ${scripts.typecheck} ») ne lance pas ` +
        '`next typegen` ; sans les types de routes générés, tsc peut échouer. Proposition : ' +
        `\`${NEXT_TYPEGEN_TYPECHECK}\`.`,
    );
  }
  const generators = ['prebuild', 'predev'].filter((name) => typeof scripts[name] === 'string');
  if (generators.length) {
    const list = generators.map((name) => `${name} (« ${scripts[name]} »)`).join(', ');
    warnings.push(
      `Script(s) ${list} : s'ils génèrent des fichiers requis par tsc ou les tests, les lancer avant ` +
        'commands.typecheck (et dans hooks.preCommit, la CI) — un checkout propre ne les contient pas.',
    );
  }
  const dockerfiles = findDockerfiles(target, wsDirs);
  if (dockerfiles.length) {
    warnings.push(
      `${dockerfiles.join(', ')} détecté(s) : le script prepare tourne pendant l'installation des ` +
        'dépendances de l\'image, souvent avant la copie de scripts/. Le prepare posé par le standard ' +
        'tolère l\'absence de scripts/install-git-hooks.cjs ; un prepare existant doit en faire autant.',
    );
  }
  return warnings;
}

/** Avertissements utiles pour l'humain qui relit la proposition. */
function detectWarnings(target, deps, pkg, wsDirs) {
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
  if (pkg) warnings.push(...nodeWarnings(target, pkg, wsDirs));
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
  const commands = detectCommands(target, pkg, pm, typescript);
  const { name: mainBranch, source: mainBranchSource } = detectMainBranch(target);

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
    git: {
      mainBranch,
      // 'main' et 'master' sont toujours protégées ; mainBranch ne s'y
      // ajoute que s'il vient d'une origine fiable (origin/HEAD), jamais
      // d'un simple repli sur la branche courante (voir git.mjs).
      protectedBranches: [...new Set(['main', 'master', ...(mainBranchSource === 'origin' ? [mainBranch] : [])])],
    },
    hooks: { preCommit: detectHooks(commands) },
    guard: {
      protectedPaths: PROTECTED_CANDIDATES.filter((d) => isDir(target, d)),
      destructiveCommands,
    },
    options: { agentBus: true, demoInstance: false },
    demo: {},
  };
  return { config, warnings: detectWarnings(target, deps, pkg, wsDirs) };
}
