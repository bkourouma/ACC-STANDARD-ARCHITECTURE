// Aides de test : copie de fixtures en dossier temporaire, git local, appel du CLI.
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const BIN = path.join(ROOT, 'bin', 'acc-standard.mjs');
export const FIXTURES = path.join(ROOT, 'test', 'fixtures');
export const TEMPLATES = path.join(FIXTURES, 'templates');
export const MIGRATIONS = path.join(FIXTURES, 'migrations');

/** Dossier temporaire neuf. */
export function tmpDir(prefix = 'acc-test-') {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Copie une fixture de projet dans un dossier temporaire. */
export function copyProject(name) {
  // Sous-dossier au nom de la fixture : le nom détecté reste stable.
  const dir = path.join(tmpDir(`acc-${name}-`), name);
  fs.cpSync(path.join(FIXTURES, 'projects', name), dir, { recursive: true });
  return dir;
}

/** Copie les gabarits de test (pour les modifier dans un test). */
export function copyTemplates() {
  const dir = tmpDir('acc-templates-');
  fs.cpSync(TEMPLATES, dir, { recursive: true });
  return dir;
}

/** git dans un dépôt TEMPORAIRE de test uniquement. */
export function git(dir, ...args) {
  const res = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true });
  if (res.status !== 0) throw new Error(`git ${args.join(' ')} : ${res.stderr}`);
  return res.stdout.trim();
}

/** git init + config locale + commit initial. */
export function gitInit(dir) {
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'commit.gpgsign', 'false');
  commitAll(dir, 'initial');
}

export function commitAll(dir, message = 'commit') {
  git(dir, 'add', '-A');
  git(dir, 'commit', '-q', '--allow-empty', '-m', message);
}

/** Lance le CLI ; renvoie { status, stdout, stderr }. */
export function cli(args, { cwd = ROOT, env = {}, templates = TEMPLATES } = {}) {
  const res = spawnSync(process.execPath, [BIN, ...args], {
    cwd,
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, ACC_TEMPLATES_DIR: templates, ACC_MIGRATIONS_DIR: MIGRATIONS, ...env },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/**
 * bash utilisable pour lancer les hooks livrés. Sous Windows, `bash` seul peut
 * désigner le lanceur WSL (System32) : on cherche Git Bash à côté de git.exe.
 * ACC_TEST_BASH force un chemin. Renvoie null si rien n'est trouvé.
 */
function findBash() {
  const works = (bin) => spawnSync(bin, ['-c', 'exit 0'], { windowsHide: true }).status === 0;
  if (process.env.ACC_TEST_BASH) return works(process.env.ACC_TEST_BASH) ? process.env.ACC_TEST_BASH : null;
  if (process.platform !== 'win32') return works('bash') ? 'bash' : null;
  const where = spawnSync('where', ['git'], { encoding: 'utf8', windowsHide: true });
  for (const gitExe of (where.stdout ?? '').split(/\r?\n/).filter(Boolean)) {
    const root = path.dirname(path.dirname(gitExe));
    for (const rel of [['usr', 'bin', 'bash.exe'], ['bin', 'bash.exe']]) {
      const candidate = path.join(root, ...rel);
      if (fs.existsSync(candidate) && works(candidate)) return candidate;
    }
  }
  return null;
}

export const BASH = findBash();

/**
 * Lance un hook livré (bash) avec une entrée JSON. CLAUDE_PROJECT_DIR est
 * toujours redéfini : sans cela, les tests lus dans une session Claude Code
 * liraient l'acc.config.json du dépôt courant.
 */
export function runHook(hook, input, { cwd, project = cwd ?? tmpDir('acc-hook-vide-'), env = {} } = {}) {
  const res = spawnSync(BASH, [hook.replace(/\\/g, '/')], {
    cwd: cwd ?? project,
    input: typeof input === 'string' ? input : JSON.stringify(input),
    encoding: 'utf8',
    windowsHide: true,
    env: { ...process.env, CLAUDE_PROJECT_DIR: project, ...env },
  });
  return { status: res.status, stdout: res.stdout, stderr: res.stderr };
}

/** Entrée d'un hook PreToolUse Bash. */
export const bashInput = (command) => ({ tool_name: 'Bash', tool_input: { command } });

/** Projet prêt : fixture copiée, config détectée écrite, dépôt git propre. */
export function preparedProject(name = 'node-simple', mutate) {
  const dir = copyProject(name);
  const res = cli(['detect', dir, '--write']);
  if (res.status !== 0) throw new Error(`detect --write : ${res.stderr}`);
  if (mutate) {
    const file = path.join(dir, 'acc.config.json');
    const config = JSON.parse(fs.readFileSync(file, 'utf8'));
    fs.writeFileSync(file, `${JSON.stringify(mutate(config) ?? config, null, 2)}\n`);
  }
  gitInit(dir);
  return dir;
}

export const read = (dir, rel) => fs.readFileSync(path.join(dir, rel), 'utf8');
export const write = (dir, rel, content) => {
  fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
  fs.writeFileSync(path.join(dir, rel), content);
};
export const exists = (dir, rel) => fs.existsSync(path.join(dir, rel));

/** Instantané de tous les fichiers (hors .git) : chemin → contenu. */
export function snapshot(dir) {
  const out = {};
  const walk = (rel) => {
    for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name !== '.git') walk(child);
      } else out[child] = fs.readFileSync(path.join(dir, child), 'utf8');
    }
  };
  walk('');
  return out;
}

/** Lignes d'action du plan (symbole en tête). */
export function planActions(stdout) {
  return stdout
    .split(/\r?\n/)
    .map((l) => /^ {2}([+~=·»!]) {2}\S+\s+(\S+)/.exec(l))
    .filter(Boolean)
    .map((m) => ({ action: m[1], dest: m[2] }));
}
