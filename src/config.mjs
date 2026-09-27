// Lecture, valeurs par défaut et validation de acc.config.json.
import path from 'node:path';
import {
  AccError,
  cloneJson,
  isPlainObject,
  readTextIfExists,
  stringifyJson,
  toLf,
  writeFileAtomic,
} from './fs-utils.mjs';
import { parseSemver, STANDARD_VERSION } from './version.mjs';

export const CONFIG_FILE = 'acc.config.json';
export const ADAPTERS = ['claude', 'codex', 'cursor'];
export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun', 'none'];

/** Configuration par défaut (clés du contrat, §2). */
export function defaultConfig() {
  return {
    standardVersion: STANDARD_VERSION,
    project: { name: '', slug: '', description: '', language: 'fr' },
    profiles: ['base'],
    adapters: ['claude'],
    stack: {
      packageManager: 'none',
      workspaces: false,
      typescript: false,
      eslint: false,
      prettier: false,
      languages: [],
    },
    commands: { install: '', dev: '', build: '', typecheck: '', lint: '', test: '' },
    ports: {},
    git: { mainBranch: 'main', protectedBranches: ['main', 'master'] },
    hooks: { preCommit: [] },
    guard: { protectedPaths: [], destructiveCommands: [] },
    options: { agentBus: true, demoInstance: false },
    demo: {},
  };
}

/** Complète les clés manquantes sans toucher aux valeurs présentes ni aux clés inconnues. */
export function withDefaults(config, defaults = defaultConfig()) {
  const out = cloneJson(config);
  for (const [key, value] of Object.entries(defaults)) {
    if (!Object.hasOwn(out, key)) out[key] = cloneJson(value);
    else if (isPlainObject(value) && isPlainObject(out[key]) && Object.keys(value).length > 0) {
      out[key] = withDefaults(out[key], value);
    }
  }
  return out;
}

/** Dérive un slug [a-z0-9-] d'un nom. */
export function slugify(name) {
  return String(name ?? '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

const isStringArray = (v) => Array.isArray(v) && v.every((x) => typeof x === 'string');

/** Renvoie la liste des erreurs de validation (vide = config valide). */
export function validateConfig(config) {
  const errors = [];
  const err = (msg) => errors.push(msg);
  if (!isPlainObject(config)) return ['la configuration doit être un objet JSON'];
  if (!parseSemver(config.standardVersion)) err('standardVersion doit être une version x.y.z');
  const project = config.project ?? {};
  if (typeof project.name !== 'string' || !project.name.trim()) err('project.name est requis');
  if (typeof project.slug !== 'string' || !/^[a-z0-9-]+$/.test(project.slug)) {
    err('project.slug doit contenir uniquement [a-z0-9-]');
  }
  if (!isStringArray(config.profiles) || !config.profiles.includes('base')) {
    err('profiles doit être un tableau contenant "base"');
  }
  if (!isStringArray(config.adapters) || config.adapters.some((a) => !ADAPTERS.includes(a))) {
    err(`adapters n'accepte que : ${ADAPTERS.join(', ')}`);
  }
  if (!PACKAGE_MANAGERS.includes(config.stack?.packageManager)) {
    err(`stack.packageManager doit valoir : ${PACKAGE_MANAGERS.join(', ')}`);
  }
  if (!isPlainObject(config.commands) || Object.values(config.commands).some((c) => typeof c !== 'string')) {
    err('commands doit être un objet de chaînes');
  }
  validateHooks(config.hooks, err);
  validateGuard(config.guard, err);
  for (const key of ['agentBus', 'demoInstance']) {
    if (typeof config.options?.[key] !== 'boolean') err(`options.${key} doit être un booléen`);
  }
  return errors;
}

function validateHooks(hooks, err) {
  const list = hooks?.preCommit;
  if (!Array.isArray(list)) return err('hooks.preCommit doit être un tableau');
  list.forEach((hook, i) => {
    if (typeof hook?.name !== 'string' || typeof hook?.command !== 'string') {
      err(`hooks.preCommit[${i}] exige name et command`);
    }
    if (hook?.blocking !== undefined && typeof hook.blocking !== 'boolean') {
      err(`hooks.preCommit[${i}].blocking doit être un booléen`);
    }
    if (hook?.whenStaged !== undefined && !isStringArray(hook.whenStaged)) {
      err(`hooks.preCommit[${i}].whenStaged doit être un tableau de chaînes`);
    }
  });
  return undefined;
}

function validateGuard(guard, err) {
  if (!isStringArray(guard?.protectedPaths)) err('guard.protectedPaths doit être un tableau de chaînes');
  const list = guard?.destructiveCommands;
  if (!Array.isArray(list)) return err('guard.destructiveCommands doit être un tableau');
  list.forEach((entry, i) => {
    try {
      new RegExp(entry?.pattern);
      if (typeof entry?.pattern !== 'string') throw new Error('absent');
    } catch {
      err(`guard.destructiveCommands[${i}].pattern n'est pas une expression régulière valide`);
    }
  });
  return undefined;
}

export function configPath(target) {
  return path.join(target, CONFIG_FILE);
}

/** Lit la config brute ; null si absente ; AccError si JSON illisible. */
export function readRawConfig(target) {
  const text = readTextIfExists(configPath(target));
  if (text === null) return null;
  try {
    return JSON.parse(toLf(text));
  } catch (error) {
    throw new AccError(`${CONFIG_FILE} illisible : ${error.message}`);
  }
}

/** Lit, complète et valide la config ; erreur explicite sinon. */
export function loadConfig(target) {
  const raw = readRawConfig(target);
  if (raw === null) {
    throw new AccError(
      `${CONFIG_FILE} introuvable dans ${target}.\n` +
        'Lancez d\'abord : acc-standard detect --write',
    );
  }
  const config = withDefaults(raw);
  const errors = validateConfig(config);
  if (errors.length) {
    throw new AccError(`${CONFIG_FILE} invalide :\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  }
  return config;
}

/** Écrit la config (indentation 2, LF). */
export function writeConfig(target, config) {
  writeFileAtomic(configPath(target), stringifyJson(config, 2));
}
