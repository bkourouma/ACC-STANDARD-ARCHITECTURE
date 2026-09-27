// Manifeste .acc/manifest.json : ce que le standard a posé dans la cible.
import path from 'node:path';
import { AccError, readTextIfExists, stringifyJson, toLf, writeFileAtomic } from './fs-utils.mjs';
import { SOURCE_COMMIT, STANDARD_VERSION } from './version.mjs';

/** Chemin relatif affiché (notation POSIX). */
export const MANIFEST_FILE = '.acc/manifest.json';

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
    return manifest;
  } catch (error) {
    throw new AccError(`Manifeste illisible (${MANIFEST_FILE}) : ${error.message}`);
  }
}

/**
 * Écrit le manifeste. Si rien n'a changé hormis la date, le fichier n'est pas
 * réécrit : un second apply ne modifie aucun octet.
 */
export function writeManifest(target, files, previous) {
  const unchanged =
    previous &&
    previous.standardVersion === STANDARD_VERSION &&
    previous.sourceCommit === SOURCE_COMMIT &&
    JSON.stringify(previous.files) === JSON.stringify(files);
  if (unchanged) return false;
  const manifest = {
    standardVersion: STANDARD_VERSION,
    sourceCommit: SOURCE_COMMIT,
    appliedAt: new Date().toISOString(),
    files,
  };
  writeFileAtomic(manifestPath(target), stringifyJson(manifest, 2));
  return true;
}

/** Écrit un manifeste déjà construit (utilisé par les migrations). */
export function saveManifest(target, manifest) {
  writeFileAtomic(manifestPath(target), stringifyJson(manifest, 2));
}
