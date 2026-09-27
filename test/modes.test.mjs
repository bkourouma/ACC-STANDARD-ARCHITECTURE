import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { isForbiddenEnvPath, resolveDest, sha256 } from '../src/fs-utils.mjs';
import { parseBlocks } from '../src/modes/block.mjs';
import { detectIndent, mergeJson } from '../src/modes/merge-json.mjs';
import { planMergeLines } from '../src/modes/merge-lines.mjs';

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

test('planMergeLines : négation déjà présente avant le motif → réécrite en fin de bloc', () => {
  // Cas constaté : `.gitignore` contient déjà `.env*` puis `!.env.example` ;
  // le fragment standard ajoute `.env` et `.env.*`, dont la négation devrait
  // se protéger. Sans correction, `!.env.example` reste avant `.env.*` et
  // `.env.example` finit ignoré.
  const item = {
    abs: '/proj/.gitignore',
    profile: 'node',
    fragments: ['.env\n.env.*\n!.env.example\n'],
  };
  const current = '.env*\n!.env.example\n';
  const result = planMergeLines(item, { current });
  assert.equal(result.action, '»');
  assert.equal(result.detail, '3 ligne(s) ajoutée(s)');
  const content = result.writes[0].content;
  assert.equal(
    content,
    '.env*\n!.env.example\n\n# acc-standard\n.env\n.env.*\n!.env.example\n',
  );
  // Vérification réelle via git : .env.example ne doit plus être ignoré.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'acc-merge-lines-'));
  try {
    spawnSync('git', ['init', '-q'], { cwd: dir });
    fs.writeFileSync(path.join(dir, '.gitignore'), content);
    fs.writeFileSync(path.join(dir, '.env.example'), 'X=1\n');
    const check = spawnSync('git', ['check-ignore', '--no-index', '.env.example'], { cwd: dir, encoding: 'utf8' });
    assert.equal(check.status, 1, 'git check-ignore doit indiquer que le fichier n\'est pas ignoré');
    assert.equal(check.stdout.trim(), '');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('planMergeLines : idempotence stricte, un deuxième apply ne change rien', () => {
  const item = {
    abs: '/proj/.gitignore',
    profile: 'node',
    fragments: ['.env\n.env.*\n!.env.example\n'],
  };
  const first = planMergeLines(item, { current: '.env*\n!.env.example\n' });
  const secondCurrent = first.writes[0].content;
  const second = planMergeLines(item, { current: secondCurrent });
  assert.equal(second.action, '=');
  assert.deepEqual(second.writes, []);
  // Un troisième appel sur le même contenu confirme qu'aucun octet ne bouge.
  const third = planMergeLines(item, { current: secondCurrent });
  assert.equal(third.action, '=');
});

test('planMergeLines : fichier sans négation préalable, ajout simple', () => {
  const item = {
    abs: '/proj/.gitignore',
    profile: 'node',
    fragments: ['.env\n.env.*\n!.env.example\n'],
  };
  const current = 'node_modules/\n';
  const result = planMergeLines(item, { current });
  assert.equal(result.action, '»');
  assert.equal(result.detail, '3 ligne(s) ajoutée(s)');
  assert.equal(
    result.writes[0].content,
    'node_modules/\n\n# acc-standard\n.env\n.env.*\n!.env.example\n',
  );
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
