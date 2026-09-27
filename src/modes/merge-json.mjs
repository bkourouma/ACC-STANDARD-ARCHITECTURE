// Mode merge-json : fusion profonde où la cible gagne sur les scalaires.
import { AccError, cloneJson, deepEqual, isPlainObject, stringifyJson, toLf } from '../fs-utils.mjs';

const isHookEntry = (v) => isPlainObject(v) && ('matcher' in v || Array.isArray(v.hooks));

/** Fusionne `fragment` dans `target` ; renvoie une nouvelle valeur. */
export function mergeJson(target, fragment) {
  if (isPlainObject(target) && isPlainObject(fragment)) return mergeObjects(target, fragment);
  if (Array.isArray(target) && Array.isArray(fragment)) return mergeArrays(target, fragment);
  return cloneJson(target);
}

function mergeObjects(target, fragment) {
  const out = {};
  for (const key of Object.keys(target)) out[key] = cloneJson(target[key]);
  for (const [key, value] of Object.entries(fragment)) {
    out[key] = Object.hasOwn(target, key) ? mergeJson(target[key], value) : cloneJson(value);
  }
  return out;
}

function mergeArrays(target, fragment) {
  const matcherStyle = [...target, ...fragment].some(isHookEntry);
  if (matcherStyle) return mergeHookEntries(target, fragment);
  return unionDeep(target, fragment);
}

function unionDeep(target, fragment, same = deepEqual) {
  const out = target.map(cloneJson);
  for (const value of fragment) {
    if (!out.some((existing) => same(existing, value))) out.push(cloneJson(value));
  }
  return out;
}

/** Entrées de hooks Claude Code : regroupées par `matcher`, hooks dédoublonnés par `command`. */
function mergeHookEntries(target, fragment) {
  const out = target.map(cloneJson);
  for (const entry of fragment) {
    if (!isHookEntry(entry)) {
      if (!out.some((e) => deepEqual(e, entry))) out.push(cloneJson(entry));
      continue;
    }
    const index = out.findIndex((e) => isHookEntry(e) && (e.matcher ?? '') === (entry.matcher ?? ''));
    if (index === -1) {
      out.push(cloneJson(entry));
      continue;
    }
    const { hooks: newHooks, ...rest } = entry;
    const { hooks: oldHooks, ...oldRest } = out[index];
    const merged = mergeObjects(oldRest, rest);
    if (oldHooks !== undefined || newHooks !== undefined) {
      merged.hooks = unionDeep(oldHooks ?? [], newHooks ?? [], sameHook);
    }
    out[index] = reorder(merged, out[index]);
  }
  return out;
}

function sameHook(a, b) {
  if (isPlainObject(a) && isPlainObject(b) && typeof a.command === 'string' && typeof b.command === 'string') {
    return a.command === b.command;
  }
  return deepEqual(a, b);
}

/** Remet les clés dans l'ordre d'origine, les nouvelles à la fin. */
function reorder(value, original) {
  const out = {};
  for (const key of Object.keys(original)) if (key in value) out[key] = value[key];
  for (const key of Object.keys(value)) if (!(key in out)) out[key] = value[key];
  return out;
}

/** Indentation d'un JSON existant (2 espaces par défaut). */
export function detectIndent(text) {
  const match = /^[{[]\s*?\n([ \t]+)\S/.exec(toLf(text));
  return match ? match[1] : 2;
}

/** Fragment cumulé des profils (le premier gagne sur les scalaires). */
function combinedFragment(item) {
  return item.fragments
    .map((text, i) => {
      try {
        return JSON.parse(text);
      } catch (error) {
        throw new AccError(`Fragment JSON invalide pour ${item.dest} (${item.profiles[i] ?? item.profile}) : ${error.message}`);
      }
    })
    .reduce((acc, frag) => (acc === undefined ? frag : mergeJson(acc, frag)), undefined);
}

export function planMergeJson(item, { current, entry }) {
  const fragment = combinedFragment(item);
  const fresh = { mode: 'merge-json', profile: item.profile };
  if (current === null) {
    return { action: '+', writes: [{ abs: item.abs, content: stringifyJson(fragment, 2) }], entry: fresh };
  }
  let parsed;
  try {
    parsed = JSON.parse(toLf(current));
  } catch {
    return {
      action: '!',
      conflict: true,
      detail: `JSON illisible → ${item.dest}.acc-new`,
      writes: [{ abs: `${item.abs}.acc-new`, content: stringifyJson(fragment, 2) }],
      entry: entry ?? fresh,
    };
  }
  const merged = mergeJson(parsed, fragment);
  if (JSON.stringify(merged) === JSON.stringify(parsed)) return { action: '=', writes: [], entry: fresh };
  const content = stringifyJson(merged, detectIndent(current));
  return { action: '»', detail: 'fusion JSON', writes: [{ abs: item.abs, content }], entry: fresh };
}
