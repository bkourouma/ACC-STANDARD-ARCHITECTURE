// Mode block : seuls les blocs <!-- acc:begin id --> … <!-- acc:end id --> sont gérés.
import path from 'node:path';
import { AccError, finalize, readTextIfExists, sameContent, sha256, toLf } from '../fs-utils.mjs';

const BEGIN_RE = /^\s*<!--\s*acc:begin\s+(\S+)\s*-->\s*$/;
const END_RE = /^\s*<!--\s*acc:end\s+(\S+)\s*-->\s*$/;

/** Dossier des squelettes (relatif à la cible, notation POSIX). */
export const SKELETONS_DIR = '.acc/skeletons';

/**
 * Repère les blocs d'un texte.
 * Renvoie { lines, blocks: Map<id, { begin, end, content }>, order, errors }.
 */
export function parseBlocks(text) {
  const lines = toLf(text).split('\n');
  const blocks = new Map();
  const order = [];
  const errors = [];
  let open = null;
  lines.forEach((line, index) => {
    const begin = BEGIN_RE.exec(line);
    const end = END_RE.exec(line);
    if (begin) {
      if (open) errors.push(`bloc « ${open.id} » non fermé avant « ${begin[1]} »`);
      open = { id: begin[1], begin: index };
    } else if (end) {
      if (!open || open.id !== end[1]) {
        errors.push(`marqueur de fin « ${end[1]} » sans début correspondant`);
        return;
      }
      if (!blocks.has(open.id)) {
        blocks.set(open.id, { begin: open.begin, end: index, content: lines.slice(open.begin + 1, index).join('\n') });
        order.push(open.id);
      }
      open = null;
    }
  });
  if (open) errors.push(`bloc « ${open.id} » non fermé`);
  return { lines, blocks, order, errors };
}

/** Texte complet d'un bloc (marqueurs compris), tel qu'il est dans le gabarit. */
function blockText(parsed, id) {
  const block = parsed.blocks.get(id);
  return parsed.lines.slice(block.begin, block.end + 1);
}

/**
 * Construit le fichier cible avec les blocs choisis remplacés et les blocs
 * manquants ajoutés en fin de fichier.
 */
function compose(targetParsed, templateParsed, replaceIds, appendIds) {
  let lines = [...targetParsed.lines];
  const replacements = [...replaceIds]
    .map((id) => ({ id, block: targetParsed.blocks.get(id) }))
    .sort((a, b) => b.block.begin - a.block.begin);
  for (const { id, block } of replacements) {
    const inner = templateParsed.blocks.get(id).content.split('\n');
    lines.splice(block.begin + 1, block.end - block.begin - 1, ...inner);
  }
  let text = lines.join('\n');
  if (appendIds.length) {
    text = text.replace(/\n+$/, '');
    for (const id of appendIds) {
      text += `${text ? '\n\n' : ''}${blockText(templateParsed, id).join('\n')}`;
    }
  }
  return finalize(text);
}

/**
 * Écriture du squelette `.acc/skeletons/<dest>` (fichier rendu complet), ou
 * null. Voir §5 du contrat : écrit tant que le fichier cible, présent avant
 * le standard, n'a pas d'entrée au manifeste ; ensuite seulement tenu à jour
 * s'il existe encore.
 */
function skeletonWrite(item, rendered, { current, entry, target }) {
  if (!target) return null;
  const abs = path.join(target, ...SKELETONS_DIR.split('/'), ...item.dest.split('/'));
  const existing = readTextIfExists(abs);
  if (existing === null && (entry || sameContent(current, rendered))) return null;
  if (existing !== null && sameContent(existing, rendered)) return null;
  return { abs, content: rendered, rel: `${SKELETONS_DIR}/${item.dest}` };
}

/** Ajoute l'écriture du squelette au résultat d'un plan de bloc. */
function withSkeleton(result, skeleton) {
  if (!skeleton) return result;
  const note = `squelette → ${skeleton.rel}`;
  return {
    ...result,
    action: result.action === '=' ? '~' : result.action,
    detail: result.detail ? `${result.detail} ; ${note}` : note,
    writes: [...result.writes, { abs: skeleton.abs, content: skeleton.content }],
    skeleton: skeleton.rel,
  };
}

export function planBlock(item, state) {
  const { current } = state;
  const rendered = finalize(item.content);
  const template = parseBlocks(rendered);
  if (template.errors.length) {
    throw new AccError(`Gabarit ${item.profile}/${item.dest} : ${template.errors.join(' ; ')}`);
  }
  if (current === null) {
    const hashes = Object.fromEntries(template.order.map((id) => [id, sha256(template.blocks.get(id).content)]));
    return { action: '+', writes: [{ abs: item.abs, content: rendered }], entry: { mode: 'block', profile: item.profile, blocks: hashes } };
  }
  return withSkeleton(planExisting(item, template, state), skeletonWrite(item, rendered, state));
}

function planExisting(item, template, { current, entry, force, adopt }) {
  const hashes = Object.fromEntries(template.order.map((id) => [id, sha256(template.blocks.get(id).content)]));
  const fresh = { mode: 'block', profile: item.profile, blocks: hashes };
  const target = parseBlocks(current);
  const replace = [];
  const append = [];
  const conflicts = [...target.errors];
  // Un conflit « connu » touche un bloc déjà repris par le standard (hash au
  // manifeste) : --adopt ne le résout pas.
  let knownConflict = target.errors.length > 0;
  for (const id of template.order) {
    const wanted = template.blocks.get(id).content;
    const present = target.blocks.get(id);
    if (!present) append.push(id);
    else if (present.content === wanted) continue;
    else if (entry?.blocks?.[id] && sha256(present.content) === entry.blocks[id]) replace.push(id);
    else {
      conflicts.push(`bloc « ${id} » modifié localement`);
      if (entry?.blocks?.[id]) knownConflict = true;
    }
  }
  if (!conflicts.length) {
    if (!replace.length && !append.length) return { action: '=', writes: [], entry: fresh };
    const content = compose(target, template, replace, append);
    return { action: '~', detail: describe(replace, append), writes: [{ abs: item.abs, content }], entry: fresh };
  }
  const adopted = adopt && !knownConflict;
  return conflictResult(item, { target, template, append, conflicts, entry, fresh, force, adopted });
}

function conflictResult(item, { target, template, append, conflicts, entry, fresh, force, adopted }) {
  // Fichier proposé : tous les blocs du gabarit, y compris ceux en conflit.
  const all = target.errors.length ? [] : template.order.filter((id) => target.blocks.has(id));
  const proposed = target.errors.length ? finalize(item.content) : compose(target, template, all, append);
  if (force || adopted) {
    return {
      action: '~',
      detail: `${force ? 'forcé' : 'adopté'}, sauvegarde ${item.dest}.acc-bak`,
      backup: true,
      adopted: !force,
      writes: [{ abs: item.abs, content: proposed }],
      entry: fresh,
    };
  }
  return {
    action: '!',
    conflict: true,
    detail: `${conflicts.join(' ; ')} → ${item.dest}.acc-new`,
    writes: [{ abs: `${item.abs}.acc-new`, content: proposed }],
    entry: entry ?? { mode: 'block', profile: item.profile, blocks: {} },
  };
}

function describe(replace, append) {
  const parts = [];
  if (replace.length) parts.push(`blocs mis à jour : ${replace.join(', ')}`);
  if (append.length) parts.push(`blocs ajoutés : ${append.join(', ')}`);
  return parts.join(' ; ');
}
