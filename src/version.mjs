// Version du standard et emplacements par défaut du paquet.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const pkg = JSON.parse(fs.readFileSync(path.join(PACKAGE_ROOT, 'package.json'), 'utf8'));

/** Version du standard = version du paquet. */
export const STANDARD_VERSION = pkg.version;

/** Commit d'extraction des gabarits (voir docs/CONTRACT.md). */
export const SOURCE_COMMIT = '81313c5';

/**
 * Commande réellement exécutable à suggérer dans les messages qui invitent à
 * relancer l'outil : l'outil n'est pas publié sur le registre npm, donc
 * `acc-standard` seul ne fonctionne que si le paquet a été installé
 * manuellement (voir README.md).
 */
export const STANDARD_COMMAND = 'npx github:bkourouma/ACC-STANDARD-ARCHITECTURE';

/** Compare deux versions semver simples (x.y.z). Renvoie -1, 0 ou 1. */
export function compareSemver(a, b) {
  const pa = parseSemver(a);
  const pb = parseSemver(b);
  for (let i = 0; i < 3; i += 1) {
    if (pa[i] !== pb[i]) return pa[i] < pb[i] ? -1 : 1;
  }
  return 0;
}

/** Découpe « x.y.z » en nombres ; renvoie null si la forme est invalide. */
export function parseSemver(version) {
  const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(String(version ?? '').trim());
  if (!match) return null;
  return match.slice(1).map(Number);
}

/** Dossier des gabarits : option, variable ACC_TEMPLATES_DIR, puis paquet. */
export function templatesDir(option, env = process.env) {
  if (option) return path.resolve(option);
  if (env.ACC_TEMPLATES_DIR) return path.resolve(env.ACC_TEMPLATES_DIR);
  return path.join(PACKAGE_ROOT, 'templates');
}

/** Dossier des migrations : option, variable ACC_MIGRATIONS_DIR, puis paquet. */
export function migrationsDir(option, env = process.env) {
  if (option) return path.resolve(option);
  if (env.ACC_MIGRATIONS_DIR) return path.resolve(env.ACC_MIGRATIONS_DIR);
  return path.join(PACKAGE_ROOT, 'migrations');
}
