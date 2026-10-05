// Mode managed : le fichier appartient au standard.
import { finalize, sameContent, sha256 } from '../fs-utils.mjs';

/**
 * @param item élément de buildFileList
 * @param state { current: texte actuel ou null, entry: entrée du manifeste, force, adopt }
 */
export function planManaged(item, { current, entry, force, adopt }) {
  const content = finalize(item.content);
  const fresh = { mode: 'managed', profile: item.profile, hash: sha256(content) };
  if (current === null) {
    return { action: '+', writes: [{ abs: item.abs, content }], entry: fresh };
  }
  if (sameContent(current, content)) return { action: '=', writes: [], entry: fresh };
  if (entry?.hash && sha256(current) === entry.hash) {
    return { action: '~', writes: [{ abs: item.abs, content }], entry: fresh };
  }
  // --adopt : seulement un fichier jamais repris par le standard (pas de hash
  // au manifeste) ; une modification locale d'un fichier repris reste un conflit.
  const adopted = Boolean(!force && adopt && !entry?.hash);
  if (force || adopted) {
    return {
      action: '~',
      detail: `${adopted ? 'adopté' : 'forcé'}, sauvegarde ${item.dest}.acc-bak`,
      backup: true,
      adopted,
      writes: [{ abs: item.abs, content }],
      entry: fresh,
    };
  }
  return {
    action: '!',
    conflict: true,
    detail: `modifié localement → ${item.dest}.acc-new`,
    writes: [{ abs: `${item.abs}.acc-new`, content }],
    entry: entry ?? { mode: 'managed', profile: item.profile },
  };
}
