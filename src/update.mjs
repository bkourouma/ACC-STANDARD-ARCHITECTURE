// Mise à jour : migrations entre versions, puis apply, puis nouvelle version.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { applyStandard, assertCleanRepo } from './apply.mjs';
import { readRawConfig, writeConfig } from './config.mjs';
import { AccError, cloneJson, readTextIfExists, resolveDest, sha256, toPosix } from './fs-utils.mjs';
import { readManifest, RETIRED_MODES, saveManifest } from './manifest.mjs';
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

/**
 * Aides offertes aux migrations : renommer ou supprimer un fichier géré
 * (disque + manifeste). Elles ne détruisent jamais de travail local (voir
 * docs/CONTRACT.md §7) : un fichier qu'elles laissent en place devient
 * propriété du projet, et son entrée managed/block passe dans `retired` (§6)
 * pour qu'un retour du même chemin ne l'adopte pas.
 */
export function migrationHelpers(target, manifest, log) {
  const book = manifest ?? { files: {} };
  // Section qui porte l'entrée : files, à défaut retired.
  const sectionOf = (rel) => (book.files[rel] ? book.files : book.retired?.[rel] ? book.retired : null);
  const entryOf = (rel) => sectionOf(rel)?.[rel];
  const forget = (rel) => {
    delete book.files[rel];
    if (book.retired) delete book.retired[rel];
  };
  // Fichier conservé hors livraison : seule une entrée managed/block garde sa trace.
  const retire = (rel) => {
    const entry = entryOf(rel);
    forget(rel);
    if (RETIRED_MODES.has(entry?.mode)) (book.retired ??= {})[rel] = entry;
  };
  // Vrai si le fichier est exactement tel que le standard l'a posé.
  const untouched = (rel, abs) => {
    const entry = entryOf(rel);
    const text = readTextIfExists(abs);
    return entry?.mode === 'managed' && Boolean(entry.hash) && text !== null && sha256(text) === entry.hash;
  };
  return {
    renameManaged(from, to) {
      const [a, b] = [toPosix(from), toPosix(to)];
      const src = resolveDest(target, a);
      const dst = resolveDest(target, b);
      if (fs.existsSync(src)) {
        if (fs.existsSync(dst)) {
          retire(a);
          log(`non renommé : ${b} existe déjà, ${a} conservé (propriété du projet)`);
          return;
        }
        fs.mkdirSync(path.dirname(dst), { recursive: true });
        fs.renameSync(src, dst);
      }
      const section = sectionOf(a);
      if (section) {
        section[b] = section[a];
        delete section[a];
      }
      log(`renommé : ${a} → ${b}`);
    },
    removeManaged(rel) {
      const a = toPosix(rel);
      const abs = resolveDest(target, a);
      if (!fs.existsSync(abs)) {
        forget(a);
        log(`déjà absent : ${a}`);
      } else if (untouched(a, abs)) {
        fs.rmSync(abs);
        forget(a);
        log(`supprimé : ${a}`);
      } else {
        retire(a);
        log(`conservé : ${a} (modifié localement ou non géré), propriété du projet`);
      }
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
