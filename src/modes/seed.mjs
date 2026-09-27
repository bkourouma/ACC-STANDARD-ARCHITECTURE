// Mode seed : créé une fois, ensuite propriété du projet.
import { finalize } from '../fs-utils.mjs';

export function planSeed(item, { current }) {
  const entry = { mode: 'seed', profile: item.profile };
  if (current === null) {
    return { action: '+', writes: [{ abs: item.abs, content: finalize(item.content) }], entry };
  }
  return { action: '·', writes: [], entry };
}
