import assert from 'node:assert/strict';
import { test } from 'node:test';
import { isForbiddenEnvPath, resolveDest, sha256 } from '../src/fs-utils.mjs';
import { parseBlocks } from '../src/modes/block.mjs';
import { detectIndent, mergeJson } from '../src/modes/merge-json.mjs';

test('mergeJson : objets, scalaires, tableaux, ordre des clés', () => {
  const target = { b: 1, a: { x: 'cible', list: [1, 2] }, objs: [{ k: 1 }] };
  const frag = { a: { x: 'fragment', y: true, list: [2, 3] }, c: 'nouveau', objs: [{ k: 1 }, { k: 2 }], b: 9 };
  const merged = mergeJson(target, frag);
  assert.deepEqual(merged, {
    b: 1,
    a: { x: 'cible', list: [1, 2, 3], y: true },
    objs: [{ k: 1 }, { k: 2 }],
    c: 'nouveau',
  });
  assert.deepEqual(Object.keys(merged), ['b', 'a', 'objs', 'c']);
  assert.deepEqual(target.a.list, [1, 2], 'la cible n\'est pas mutée');
});

test('mergeJson : entrées de hooks fusionnées par matcher, hooks dédoublonnés par command', () => {
  const target = [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'a', timeout: 3 }] }];
  const frag = [
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'a' }, { type: 'command', command: 'b' }] },
    { matcher: 'Edit', hooks: [{ type: 'command', command: 'c' }] },
  ];
  assert.deepEqual(mergeJson(target, frag), [
    { matcher: 'Bash', hooks: [{ type: 'command', command: 'a', timeout: 3 }, { type: 'command', command: 'b' }] },
    { matcher: 'Edit', hooks: [{ type: 'command', command: 'c' }] },
  ]);
});

test('detectIndent', () => {
  assert.equal(detectIndent('{\n    "a": 1\n}\n'), '    ');
  assert.equal(detectIndent('{\r\n\t"a": 1\r\n}'), '\t');
  assert.equal(detectIndent('{}'), 2);
});

test('parseBlocks : contenu strictement entre marqueurs, erreurs', () => {
  const parsed = parseBlocks('x\n<!-- acc:begin a -->\nun\ndeux\n<!-- acc:end a -->\ny\n');
  assert.equal(parsed.blocks.get('a').content, 'un\ndeux');
  assert.deepEqual(parsed.errors, []);
  assert.equal(parseBlocks('<!-- acc:begin a -->\n').errors.length, 1);
  assert.equal(sha256('a\r\nb'), sha256('a\nb'));
});

test('destinations interdites', () => {
  assert.equal(isForbiddenEnvPath('.env'), true);
  assert.equal(isForbiddenEnvPath('apps/web/.env.production'), true);
  assert.equal(isForbiddenEnvPath('.env.example'), false);
  assert.equal(isForbiddenEnvPath('env.example'), false);
  assert.throws(() => resolveDest('/cible', '/etc/passwd'), /absolue/);
  assert.throws(() => resolveDest('/cible', 'C:/Windows/x'), /absolue/);
  assert.throws(() => resolveDest('/cible', 'a/../../b'), /hors de la cible/);
  assert.throws(() => resolveDest('/cible', 'a\\..\\..\\b'), /hors de la cible/);
});
