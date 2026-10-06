// Manifeste .acc/manifest.json : ce que le standard a posé dans la cible.
import fs from 'node:fs';
import path from 'node:path';
import { AccError, readTextIfExists, stringifyJson, toLf, writeFileAtomic } from './fs-utils.mjs';
import { SOURCE_COMMIT, STANDARD_VERSION } from './version.mjs';

/** Chemin relatif affiché (notation POSIX). */
export const MANIFEST_FILE = '.acc/manifest.json';

/**
 * Modes dont le traitement dépend de l'entrée du manifeste : seule leur trace
 * est gardée dans `retired` quand le fichier n'est plus livré (contrat §6).
 */
export const RETIRED_MODES = new Set(['managed', 'block']);

export function manifestPath(target) {
  return path.join(target, '.acc', 'manifest.json');
}

/** Lit le manifeste ; null s'il est absent. */
export function readManifest(target) {
  const text = readTextIfExists(manifestPath(target));
  if (text === null) return null;
  try {
    const manifest = JSON.parse(toLf(text));
    if (!manifest || typeof manifest.files !== 'object') throw new Error('champ files absent');
    if (manifest.retired !== undefined && typeof manifest.retired !== 'object') throw new Error('champ retired invalide');
    return manifest;
  } catch (error) {
    throw new AccError(`Manifeste illisible (${MANIFEST_FILE}) : ${error.message}`);
  }
}

/** Entrée d'une destination : dans `files`, à défaut dans `retired`. */
export function manifestEntry(manifest, dest) {
  return manifest?.files?.[dest] ?? manifest?.retired?.[dest];
}

/**
 * Section `retired` après un apply : entrées managed/block du manifeste
 * précédent (files ou retired) dont la destination n'est plus livrée mais
 * dont le fichier existe encore, triées par destination.
 */
export function retiredEntries(target, manifest, delivered) {
  const candidates = { ...manifest?.retired, ...manifest?.files };
  const retired = {};
  for (const dest of Object.keys(candidates).sort()) {
    const entry = candidates[dest];
    if (delivered.has(dest) || !RETIRED_MODES.has(entry?.mode)) continue;
    if (fs.existsSync(path.join(target, dest))) retired[dest] = entry;
  }
  return retired;
}

/** Manifeste tel qu'écrit : `retired` omise quand elle est vide. */
function serialize(manifest) {
  const { retired, ...rest } = manifest;
  return stringifyJson(retired && Object.keys(retired).length ? { ...rest, retired } : rest, 2);
}

/**
 * Écrit le manifeste. Si rien n'a changé hormis la date, le fichier n'est pas
 * réécrit : un second apply ne modifie aucun octet.
 */
export function writeManifest(target, files, previous, retired = {}) {
  const unchanged =
    previous &&
    previous.standardVersion === STANDARD_VERSION &&
    previous.sourceCommit === SOURCE_COMMIT &&
    JSON.stringify(previous.files) === JSON.stringify(files) &&
    JSON.stringify(previous.retired ?? {}) === JSON.stringify(retired);
  if (unchanged) return false;
  const manifest = {
    standardVersion: STANDARD_VERSION,
    sourceCommit: SOURCE_COMMIT,
    appliedAt: new Date().toISOString(),
    files,
    retired,
  };
  writeFileAtomic(manifestPath(target), serialize(manifest));
  return true;
}

/** Écrit un manifeste déjà construit (utilisé par les migrations). */
export function saveManifest(target, manifest) {
  writeFileAtomic(manifestPath(target), serialize(manifest));
}
