// Mode merge-lines : ajoute les lignes absentes sous un en-tête unique.
import { finalize, toLf } from '../fs-utils.mjs';

export const LINES_HEADER = '# acc-standard';

/** Retire les lignes non vides déjà vues (les fragments peuvent se recouper). */
function dedupe(text) {
  const seen = new Set();
  return text
    .split('\n')
    .filter((line) => {
      const key = line.trim();
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .join('\n');
}

export function planMergeLines(item, { current }) {
  const entry = { mode: 'merge-lines', profile: item.profile };
  const fragmentText = item.fragments.map((f) => toLf(f).replace(/\n+$/, '')).join('\n');
  if (current === null) {
    return { action: '+', writes: [{ abs: item.abs, content: finalize(dedupe(fragmentText)) }], entry };
  }
  const existing = new Set(toLf(current).split('\n').map((l) => l.trim()));
  const missing = [];
  for (const line of fragmentText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === LINES_HEADER || existing.has(trimmed) || missing.includes(trimmed)) continue;
    missing.push(trimmed);
  }
  if (!missing.length) return { action: '=', writes: [], entry };
  let text = toLf(current).replace(/\n+$/, '');
  if (!existing.has(LINES_HEADER)) text += `${text ? '\n\n' : ''}${LINES_HEADER}`;
  text += `\n${missing.join('\n')}`;
  return {
    action: '»',
    detail: `${missing.length} ligne(s) ajoutée(s)`,
    writes: [{ abs: item.abs, content: finalize(text) }],
    entry,
  };
}
