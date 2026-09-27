// Moteur de gabarit minimal : variables, if/else, unless, each, échappement.
import { AccError } from './fs-utils.mjs';

const ESCAPE_SENTINEL = '\u0000ACC_LBRACE\u0000';
const TAG_RE = /\{\{\s*([^}]*?)\s*\}\}/g;
// Ligne ne contenant qu'une balise de bloc : on garde la balise, on retire la ligne.
const BLOCK_LINE_RE =
  /^[ \t]*(\{\{\s*(?:#(?:if|unless|each)\s+[^}]*?|\/(?:if|unless|each)|else)\s*\}\})[ \t]*(?:\n|$)/gm;

/** Lit une valeur par chemin pointé (« a.b.c ») ; undefined si absente. */
export function getPath(obj, dotted) {
  if (!dotted) return undefined;
  let current = obj;
  for (const key of String(dotted).split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = current[key];
  }
  return current;
}

/** Vérité au sens du gabarit : non vide, non nulle, non false, tableau non vide. */
export function isTruthy(value) {
  if (value === undefined || value === null || value === false) return false;
  if (typeof value === 'string') return value.length > 0;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'object') return Object.keys(value).length > 0;
  return true;
}

/** Texte affiché pour une valeur. */
function formatValue(value) {
  if (value === undefined || value === null) return '';
  if (Array.isArray(value)) return value.map(formatValue).join(', ');
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Découpe le gabarit en jetons texte et balise. */
function tokenize(source) {
  const tokens = [];
  let last = 0;
  for (const match of source.matchAll(TAG_RE)) {
    if (match.index > last) tokens.push({ type: 'text', value: source.slice(last, match.index) });
    tokens.push({ type: 'tag', value: match[1] });
    last = match.index + match[0].length;
  }
  if (last < source.length) tokens.push({ type: 'text', value: source.slice(last) });
  return tokens;
}

/** Construit l'arbre à partir des jetons. */
function parse(tokens) {
  const root = { type: 'root', children: [] };
  const stack = [root];
  const current = () => stack[stack.length - 1];
  const target = () => {
    const node = current();
    return node.inElse ? node.elseChildren : node.children;
  };
  for (const token of tokens) {
    if (token.type === 'text') {
      target().push(token);
      continue;
    }
    const tag = token.value;
    const open = /^#(if|unless|each)\s+(\S+)$/.exec(tag);
    if (open) {
      const node = { type: open[1], path: open[2], children: [], elseChildren: [], inElse: false };
      target().push(node);
      stack.push(node);
    } else if (tag === 'else') {
      const node = current();
      if (node.type !== 'if' && node.type !== 'unless') {
        throw new AccError('Gabarit invalide : {{else}} hors d\'un bloc if/unless.');
      }
      node.inElse = true;
    } else if (/^\/(if|unless|each)$/.test(tag)) {
      const node = current();
      if (node.type !== tag.slice(1)) {
        throw new AccError(`Gabarit invalide : {{${tag}}} ne ferme pas le bloc ouvert.`);
      }
      stack.pop();
    } else if (/^[#/]/.test(tag)) {
      throw new AccError(`Gabarit invalide : balise inconnue {{${tag}}}.`);
    } else {
      target().push({ type: 'var', path: tag });
    }
  }
  if (stack.length > 1) {
    throw new AccError(`Gabarit invalide : bloc {{#${current().type}}} non fermé.`);
  }
  return root;
}

/** Résout un chemin, en tenant compte de `this` dans un each. */
function lookup(pathName, scope) {
  if (pathName === 'this') return scope.thisValue;
  if (pathName.startsWith('this.')) return getPath(scope.thisValue, pathName.slice(5));
  return getPath(scope.context, pathName);
}

function evaluate(nodes, scope) {
  let out = '';
  for (const node of nodes) {
    if (node.type === 'text') out += node.value;
    else if (node.type === 'var') out += formatValue(lookup(node.path, scope));
    else if (node.type === 'if' || node.type === 'unless') {
      const truth = isTruthy(lookup(node.path, scope));
      const pass = node.type === 'if' ? truth : !truth;
      out += evaluate(pass ? node.children : node.elseChildren, scope);
    } else if (node.type === 'each') {
      const list = lookup(node.path, scope);
      if (!Array.isArray(list)) continue;
      for (const item of list) out += evaluate(node.children, { ...scope, thisValue: item });
    }
  }
  return out;
}

/** Rend un gabarit avec le contexte donné. */
export function render(source, context) {
  let text = String(source).replace(/\r\n?/g, '\n').replace(/\\\{\{/g, ESCAPE_SENTINEL);
  text = text.replace(BLOCK_LINE_RE, '$1');
  const tree = parse(tokenize(text));
  const out = evaluate(tree.children, { context, thisValue: undefined });
  return out.split(ESCAPE_SENTINEL).join('{{');
}
