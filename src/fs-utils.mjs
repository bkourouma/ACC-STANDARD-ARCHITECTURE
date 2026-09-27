// Utilitaires de fichiers : fins de ligne, empreintes, écriture atomique,
// validation des chemins de destination.
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

/** Erreur destinée à l'utilisateur, avec son code de sortie. */
export class AccError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'AccError';
    this.exitCode = exitCode;
  }
}

/** Convertit les fins de ligne en LF et retire un éventuel BOM. */
export function toLf(text) {
  return String(text).replace(/^﻿/, '').replace(/\r\n?/g, '\n');
}

/** Contenu normalisé prêt à écrire : LF et une fin de ligne finale. */
export function finalize(text) {
  const lf = toLf(text);
  return lf.endsWith('\n') ? lf : `${lf}\n`;
}

/** SHA-256 hexadécimal du contenu normalisé. */
export function sha256(text) {
  return createHash('sha256').update(toLf(text), 'utf8').digest('hex');
}

/** Deux contenus sont égaux après normalisation des fins de ligne. */
export function sameContent(a, b) {
  return toLf(a) === toLf(b);
}

/** Lit un fichier texte, ou renvoie null s'il n'existe pas. */
export function readTextIfExists(file) {
  try {
    return fs.readFileSync(file, 'utf8');
  } catch (error) {
    if (error.code === 'ENOENT' || error.code === 'EISDIR') return null;
    throw error;
  }
}

/** Lit un JSON, ou renvoie null si le fichier est absent. */
export function readJsonIfExists(file) {
  const text = readTextIfExists(file);
  if (text === null) return null;
  return JSON.parse(toLf(text));
}

/** Écrit un fichier via un fichier temporaire puis un renommage. */
export function writeFileAtomic(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, content, 'utf8');
  try {
    fs.renameSync(tmp, file);
  } catch (error) {
    fs.rmSync(tmp, { force: true });
    throw error;
  }
}

/** Sérialise un JSON avec l'indentation voulue et une fin de ligne. */
export function stringifyJson(value, indent = 2) {
  return `${JSON.stringify(value, null, indent)}\n`;
}

/** Vrai si le nom désigne un fichier d'environnement réel (.env, .env.*). */
export function isForbiddenEnvPath(dest) {
  const base = String(dest).split(/[\\/]/).pop();
  if (base === '.env.example') return false;
  return base === '.env' || base.startsWith('.env.');
}

/** Chemin de destination en notation POSIX, sans `./` initial. */
export function toPosix(p) {
  return String(p).replace(/\\/g, '/').replace(/^(\.\/)+/, '');
}

/**
 * Valide une destination relative à la cible et renvoie son chemin absolu.
 * Refuse les chemins absolus, les `..` et les fichiers `.env`.
 */
export function resolveDest(target, dest) {
  const rel = toPosix(dest);
  if (!rel || rel.trim() === '') throw new AccError('Destination vide dans un gabarit.');
  if (path.isAbsolute(dest) || /^[a-zA-Z]:/.test(rel) || rel.startsWith('/')) {
    throw new AccError(`Destination absolue refusée : ${dest}`);
  }
  if (rel.split('/').includes('..')) {
    throw new AccError(`Destination hors de la cible refusée : ${dest}`);
  }
  if (isForbiddenEnvPath(rel)) {
    throw new AccError(`Destination interdite (fichier d'environnement) : ${dest}`);
  }
  const abs = path.resolve(target, rel);
  const relBack = path.relative(path.resolve(target), abs);
  if (relBack.startsWith('..') || path.isAbsolute(relBack)) {
    throw new AccError(`Destination hors de la cible refusée : ${dest}`);
  }
  return abs;
}

/** Vrai si le chemin existe. */
export function exists(p) {
  return fs.existsSync(p);
}

/** Copie profonde d'une valeur JSON. */
export function cloneJson(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

/** Égalité profonde de deux valeurs JSON (ordre des clés ignoré). */
export function deepEqual(a, b) {
  if (a === b) return true;
  if (typeof a !== typeof b || a === null || b === null) return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (Array.isArray(a)) {
    return a.length === b.length && a.every((v, i) => deepEqual(v, b[i]));
  }
  if (typeof a !== 'object') return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  return ka.length === kb.length && ka.every((k) => Object.hasOwn(b, k) && deepEqual(a[k], b[k]));
}

/** Vrai pour un objet littéral (ni tableau ni null). */
export function isPlainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
