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

/** Vrai pour une ligne de négation (`!motif`), qui doit suivre le motif qu'elle réhabilite. */
function isNegation(line) {
  return line.startsWith('!');
}

export function planMergeLines(item, { current }) {
  const entry = { mode: 'merge-lines', profile: item.profile };
  const fragmentText = item.fragments.map((f) => toLf(f).replace(/\n+$/, '')).join('\n');
  if (current === null) {
    return { action: '+', writes: [{ abs: item.abs, content: finalize(dedupe(fragmentText)) }], entry };
  }
  const existing = new Set(toLf(current).split('\n').map((l) => l.trim()));
  // Lignes du fragment, dédoublonnées, dans leur ordre de déclaration.
  const fragmentLines = [];
  const seen = new Set();
  for (const line of fragmentText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed === LINES_HEADER || seen.has(trimmed)) continue;
    seen.add(trimmed);
    fragmentLines.push(trimmed);
  }
  const missingNonNegation = fragmentLines.filter((line) => !isNegation(line) && !existing.has(line));
  const missingNegation = fragmentLines.filter((line) => isNegation(line) && !existing.has(line));
  if (!missingNonNegation.length && !missingNegation.length) return { action: '=', writes: [], entry };
  // Au moins une ligne est ajoutée : les négations du fragment sont
  // réécrites en bloc à la fin, dans l'ordre du fragment, même si elles
  // existent déjà plus haut dans le fichier — sinon la négation reste avant
  // le motif qu'elle réhabilite et perd son effet (voir CONTRACT.md §5).
  const negationLines = fragmentLines.filter(isNegation);
  const added = [...missingNonNegation, ...negationLines];
  let text = toLf(current).replace(/\n+$/, '');
  if (!existing.has(LINES_HEADER)) text += `${text ? '\n\n' : ''}${LINES_HEADER}`;
  text += `\n${added.join('\n')}`;
  return {
    action: '»',
    detail: `${added.length} ligne(s) ajoutée(s)`,
    writes: [{ abs: item.abs, content: finalize(text) }],
    entry,
  };
}
