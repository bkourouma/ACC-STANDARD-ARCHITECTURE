// Mise à jour : migrations entre versions, puis apply, puis nouvelle version.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyStandard, assertCleanRepo } from './apply.mjs';
import { readRawConfig, writeConfig } from './config.mjs';
import { AccError, cloneJson, resolveDest, toPosix } from './fs-utils.mjs';
import { readManifest, saveManifest } from './manifest.mjs';
import { compareSemver, parseSemver, STANDARD_VERSION } from './version.mjs';

/** Migrations applicables : version > from et <= to, triées. */
export function listMigrations(dir, from, to = STANDARD_VERSION) {
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    return [];
  }
  return names
    .map((name) => /^(\d+\.\d+\.\d+)\.mjs$/.exec(name))
    .filter(Boolean)
    .map((m) => ({ version: m[1], file: path.join(dir, m[0]) }))
    .filter((m) => compareSemver(m.version, from) > 0 && compareSemver(m.version, to) <= 0)
    .sort((a, b) => compareSemver(a.version, b.version));
}

/** Aides offertes aux migrations : renommer ou supprimer un fichier géré (disque + manifeste). */
function migrationHelpers(target, manifest, log) {
  const files = manifest?.files ?? {};
  return {
    renameManaged(from, to) {
      const src = resolveDest(target, from);
      const dst = resolveDest(target, to);
      const [a, b] = [toPosix(from), toPosix(to)];
      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.renameSync(src, dst);
      }
      if (files[a]) {
        files[b] = files[a];
        delete files[a];
      }
      log(`renommé : ${a} → ${b}`);
    },
    removeManaged(rel) {
      const abs = resolveDest(target, rel);
      fs.rmSync(abs, { force: true });
      delete files[toPosix(rel)];
      log(`supprimé : ${toPosix(rel)}`);
    },
  };
}

/**
 * Exécute les migrations puis apply.
 * @returns {{ exitCode, output }}
 */
export async function updateStandard(target, options) {
  const { templatesDir, migrationsDir, allowDirty = false, force = false, adopt = false } = options;
  assertCleanRepo(target, allowDirty);
  const raw = readRawConfig(target);
  if (raw === null) throw new AccError('acc.config.json introuvable. Lancez d\'abord : acc-standard detect --write');
  const from = parseSemver(raw.standardVersion) ? raw.standardVersion : '0.0.0';
  const lines = [];
  const log = (msg) => lines.push(`  ${msg}`);
  let config = cloneJson(raw);
  const manifest = readManifest(target);
  const migrations = listMigrations(migrationsDir, from);
  for (const migration of migrations) {
    lines.push(`Migration ${migration.version}`);
    const mod = await import(pathToFileURL(migration.file).href);
    if (typeof mod.default !== 'function') throw new AccError(`Migration ${migration.version} sans export par défaut.`);
    const result = await mod.default({ target, config, log, manifest, ...migrationHelpers(target, manifest, log) });
    if (result && typeof result === 'object') config = result;
  }
  if (!migrations.length) lines.push(`Aucune migration entre ${from} et ${STANDARD_VERSION}.`);
  if (migrations.length) {
    writeConfig(target, config);
    if (manifest) saveManifest(target, manifest);
  }
  const applied = applyStandard(target, { templatesDir, allowDirty: true, force, adopt });
  if (migrations.length || config.standardVersion !== STANDARD_VERSION) {
    config.standardVersion = STANDARD_VERSION;
    writeConfig(target, config);
  }
  lines.push('', applied.output, '', `standardVersion : ${from} → ${STANDARD_VERSION}`);
  return { exitCode: applied.exitCode, output: lines.join('\n') };
}
