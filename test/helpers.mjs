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
