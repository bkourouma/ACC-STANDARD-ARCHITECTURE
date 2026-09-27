// Diagnostic de l'installation du standard dans une cible.
import fs from 'node:fs';
import path from 'node:path';
import { CONFIG_FILE, readRawConfig, validateConfig, withDefaults } from './config.mjs';
import { readTextIfExists, sha256, toLf } from './fs-utils.mjs';
import { gitDir, isGitRepo } from './git.mjs';
import { MANIFEST_FILE, readManifest } from './manifest.mjs';
import { parseBlocks } from './modes/block.mjs';
import { compareSemver, STANDARD_VERSION } from './version.mjs';

const SKIP_DIRS = new Set(['.git', 'node_modules']);

/** Liste récursive des fichiers `.acc-new` (hors .git et node_modules). */
function findPendingNew(root, rel = '') {
  const found = [];
  let entries = [];
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return found;
  }
  for (const entry of entries) {
    const child = rel ? `${rel}/${entry.name}` : entry.name;
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) found.push(...findPendingNew(root, child));
    else if (entry.isFile() && entry.name.endsWith('.acc-new')) found.push(child);
  }
  return found;
}

function checkConfig(target, report) {
  let raw;
  try {
    raw = readRawConfig(target);
  } catch (error) {
    return report('fail', 'Configuration', error.message);
  }
  if (raw === null) return report('fail', 'Configuration', `${CONFIG_FILE} absent (acc-standard detect --write)`);
  const errors = validateConfig(withDefaults(raw));
  if (errors.length) return report('fail', 'Configuration', errors.join(' ; '));
  report('ok', 'Configuration', `${CONFIG_FILE} valide`);
  const version = raw.standardVersion;
  const cmp = compareSemver(version, STANDARD_VERSION);
  if (cmp < 0) report('warn', 'Version du standard', `${version} < ${STANDARD_VERSION} : lancer acc-standard update`);
  else if (cmp > 0) report('warn', 'Version du standard', `${version} > outil ${STANDARD_VERSION} : mettre l'outil à jour`);
  else report('ok', 'Version du standard', version);
  return undefined;
}

function checkManagedDrift(target, dest, entry, report) {
  const current = readTextIfExists(path.join(target, dest));
  if (entry.mode === 'managed') {
    if (!entry.hash) report('warn', `Fichier géré ${dest}`, 'jamais repris par le standard (conflit initial)');
    else if (sha256(current) !== entry.hash) report('fail', `Fichier géré ${dest}`, 'modifié localement');
  } else if (entry.mode === 'block' && entry.blocks) {
    const { blocks } = parseBlocks(current);
    for (const [id, hash] of Object.entries(entry.blocks)) {
      const block = blocks.get(id);
      if (!block) report('fail', `Bloc ${dest}#${id}`, 'bloc absent');
      else if (sha256(block.content) !== hash) report('fail', `Bloc ${dest}#${id}`, 'modifié localement');
    }
  }
}

function checkManifest(target, report) {
  let manifest;
  try {
    manifest = readManifest(target);
  } catch (error) {
    return report('fail', 'Manifeste', error.message);
  }
  if (!manifest) return report('fail', 'Manifeste', `${MANIFEST_FILE} absent (acc-standard apply)`);
  const entries = Object.entries(manifest.files);
  report('ok', 'Manifeste', `${entries.length} fichier(s) suivis, standard ${manifest.standardVersion}`);
  const missing = entries.filter(([dest]) => !fs.existsSync(path.join(target, dest))).map(([d]) => d);
  if (missing.length) report('fail', 'Fichiers du manifeste', `absents : ${missing.join(', ')}`);
  else report('ok', 'Fichiers du manifeste', 'tous présents');
  const before = [];
  const collect = (status, label, detail) => before.push({ status, label, detail });
  for (const [dest, entry] of entries) {
    if (!missing.includes(dest)) checkManagedDrift(target, dest, entry, collect);
  }
  if (before.length) before.forEach((c) => report(c.status, c.label, c.detail));
  else report('ok', 'Dérive des fichiers gérés', 'aucune');
  return undefined;
}

function checkGitHooks(target, report) {
  if (!isGitRepo(target)) return report('warn', 'Hooks git', 'pas de dépôt git');
  const dir = gitDir(target);
  const hooksDir = path.resolve(target, dir ?? '.git', 'hooks');
  const missing = ['pre-commit', 'pre-push'].filter((name) => {
    const text = readTextIfExists(path.join(hooksDir, name));
    return !text || !/lefthook/i.test(text);
  });
  if (missing.length) {
    return report('warn', 'Hooks git', `${missing.join(', ')} sans lefthook (lancer l'installation des dépendances)`);
  }
  return report('ok', 'Hooks git', 'pre-commit et pre-push via lefthook');
}

function checkClaudeHooks(target, report) {
  const text = readTextIfExists(path.join(target, '.claude', 'settings.json'));
  if (text === null) return report('warn', 'Hooks Claude', '.claude/settings.json absent');
  try {
    const hooks = JSON.parse(toLf(text)).hooks;
    if (hooks && Object.keys(hooks).length) {
      return report('ok', 'Hooks Claude', `déclarés : ${Object.keys(hooks).join(', ')}`);
    }
    return report('warn', 'Hooks Claude', 'aucun hook déclaré dans .claude/settings.json');
  } catch {
    return report('fail', 'Hooks Claude', '.claude/settings.json illisible');
  }
}

/** Lance tous les contrôles ; renvoie { checks, ok, exitCode }. */
export function runDoctor(target) {
  const checks = [];
  const report = (status, label, detail) => checks.push({ status, label, detail });
  checkConfig(target, report);
  checkManifest(target, report);
  const pending = findPendingNew(target);
  if (pending.length) report('fail', 'Conflits en attente', pending.join(', '));
  else report('ok', 'Conflits en attente', 'aucun fichier .acc-new');
  checkGitHooks(target, report);
  checkClaudeHooks(target, report);
  const ok = !checks.some((c) => c.status === 'fail');
  return { target, checks, ok, exitCode: ok ? 0 : 2 };
}

const ICONS = { ok: 'ok   ', warn: 'avert', fail: 'ÉCHEC' };

export function formatDoctor(result) {
  const width = Math.max(...result.checks.map((c) => c.label.length));
  const lines = result.checks.map((c) => `  [${ICONS[c.status]}] ${c.label.padEnd(width)}  ${c.detail}`);
  lines.push('', result.ok ? 'Diagnostic : sain.' : 'Diagnostic : en échec.');
  return lines.join('\n');
}
