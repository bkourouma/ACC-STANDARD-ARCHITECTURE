// Chargement des profils de gabarits et construction de la liste des fichiers.
import fs from 'node:fs';
import path from 'node:path';
import { AccError, isForbiddenEnvPath, readTextIfExists, resolveDest, toLf, toPosix } from './fs-utils.mjs';
import { getPath, isTruthy, render } from './render.mjs';

export const MODES = ['managed', 'block', 'seed', 'merge-json', 'merge-lines'];
const MERGE_MODES = new Set(['merge-json', 'merge-lines']);

/** Profils demandés par la config (§3 du contrat). */
export function selectedProfileIds(config) {
  const ids = [...(config.profiles ?? [])];
  for (const adapter of config.adapters ?? []) {
    if (adapter !== 'claude') ids.push(`adapter-${adapter}`);
  }
  if (config.options?.demoInstance) ids.push('demo-instance');
  return ids;
}

/** Lit et valide templates/<id>/profile.json. */
export function loadProfile(templatesDir, id) {
  const dir = path.join(templatesDir, id);
  const file = path.join(dir, 'profile.json');
  const text = readTextIfExists(file);
  if (text === null) throw new AccError(`Profil introuvable : ${id} (${file})`);
  let profile;
  try {
    profile = JSON.parse(toLf(text));
  } catch (error) {
    throw new AccError(`profile.json illisible pour ${id} : ${error.message}`);
  }
  const files = Array.isArray(profile.files) ? profile.files : [];
  files.forEach((entry, i) => validateEntry(id, entry, i));
  return {
    id,
    dir,
    description: profile.description ?? '',
    requires: Array.isArray(profile.requires) ? profile.requires : [],
    files,
    nextSteps: Array.isArray(profile.nextSteps) ? profile.nextSteps : [],
  };
}

function validateEntry(id, entry, i) {
  const where = `profil ${id}, fichier n°${i + 1}`;
  if (typeof entry?.src !== 'string' || typeof entry?.dest !== 'string') {
    throw new AccError(`Gabarit invalide (${where}) : src et dest sont requis.`);
  }
  if (!MODES.includes(entry.mode)) {
    throw new AccError(`Gabarit invalide (${where}) : mode inconnu « ${entry.mode} ».`);
  }
  if (isForbiddenEnvPath(entry.dest)) {
    throw new AccError(`Gabarit refusé (${where}) : destination interdite « ${entry.dest} » (fichier d'environnement).`);
  }
  if (path.isAbsolute(entry.src) || toPosix(entry.src).split('/').includes('..')) {
    throw new AccError(`Gabarit invalide (${where}) : src doit rester dans files/.`);
  }
}

/** Résout les `requires` (d'abord), sans doublon, dans l'ordre de déclaration. */
export function resolveProfiles(templatesDir, ids) {
  const ordered = [];
  const done = new Set();
  const visiting = new Set();
  const visit = (id) => {
    if (done.has(id)) return;
    if (visiting.has(id)) throw new AccError(`Dépendance circulaire entre profils : ${id}`);
    visiting.add(id);
    const profile = loadProfile(templatesDir, id);
    for (const dep of profile.requires) visit(dep);
    visiting.delete(id);
    done.add(id);
    ordered.push(profile);
  };
  for (const id of ids) visit(id);
  return ordered;
}

/** Évalue une condition `when` (chemin, éventuellement préfixé de « ! »). */
export function evaluateWhen(when, context) {
  if (when === undefined || when === null || when === '') return true;
  const expr = String(when).trim();
  if (expr.startsWith('!')) return !isTruthy(getPath(context, expr.slice(1).trim()));
  return isTruthy(getPath(context, expr));
}

function readSource(profile, entry, context) {
  const file = path.join(profile.dir, 'files', entry.src);
  const text = readTextIfExists(file);
  if (text === null) throw new AccError(`Source de gabarit introuvable : ${profile.id}/files/${entry.src}`);
  return entry.render ? render(toLf(text), context) : toLf(text);
}

/**
 * Construit la liste ordonnée des fichiers à produire.
 * Chaque élément : { dest, abs, mode, profile, profiles, executable, content | fragments }.
 */
export function buildFileList(profiles, context, target) {
  const items = [];
  const byDest = new Map();
  for (const profile of profiles) {
    for (const entry of profile.files) {
      if (!evaluateWhen(entry.when, context)) continue;
      const dest = toPosix(render(entry.dest, context)).trim();
      const abs = resolveDest(target, dest);
      const content = readSource(profile, entry, context);
      const previous = byDest.get(dest);
      if (previous) {
        mergeCollision(previous, { dest, mode: entry.mode, profile: profile.id, content });
        continue;
      }
      const item = {
        dest,
        abs,
        mode: entry.mode,
        profile: profile.id,
        profiles: [profile.id],
        executable: entry.executable === true,
        content,
        fragments: [content],
      };
      byDest.set(dest, item);
      items.push(item);
    }
  }
  return items;
}

function mergeCollision(previous, next) {
  if (previous.mode !== next.mode || !MERGE_MODES.has(next.mode)) {
    throw new AccError(
      `Erreur de gabarit : « ${next.dest} » est visé par ${previous.profiles.join(', ')} ` +
        `(${previous.mode}) et ${next.profile} (${next.mode}).`,
    );
  }
  previous.fragments.push(next.content);
  if (!previous.profiles.includes(next.profile)) previous.profiles.push(next.profile);
}

/** Étapes suivantes cumulées des profils, sans doublon. */
export function collectNextSteps(profiles) {
  return [...new Set(profiles.flatMap((p) => p.nextSteps))];
}

/** Vrai si le dossier de gabarits existe. */
export function templatesExist(templatesDir) {
  return fs.existsSync(templatesDir);
}
