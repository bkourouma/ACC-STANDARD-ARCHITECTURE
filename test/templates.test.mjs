// Tests sur les gabarits réels du paquet (templates/), pas sur les gabarits de test.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { cli, commitAll, copyProject, gitInit, planActions, preparedProject, read, ROOT, snapshot, tmpDir, write } from './helpers.mjs';

const REAL = path.join(ROOT, 'templates');
const real = (args) => cli([...args, '--templates', REAL]);

function filesUnder(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const abs = path.join(dir, e.name);
    return e.isDirectory() ? filesUnder(abs) : [abs];
  });
}

test('gabarits : chaque script .cjs porte l\'en-tête eslint-disable après le shebang', () => {
  const scripts = filesUnder(REAL).filter((f) => f.endsWith('.cjs'));
  assert.ok(scripts.length >= 4);
  for (const file of scripts) {
    const lines = fs.readFileSync(file, 'utf8').split('\n');
    assert.match(lines[0], /^#!\/usr\/bin\/env node/, file);
    assert.match(lines[1], /^\/\* eslint-disable -- .+\*\/$/, file);
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    assert.equal(check.status, 0, `${file} : ${check.stderr}`);
  }
});

test('gabarits réels : Next 16 sans tests — CI explicite, prepare tolérant, idempotence', () => {
  const dir = preparedProject('next-app');
  const res = real(['apply', dir]);
  assert.equal(res.status, 0, res.stdout + res.stderr);

  const ci = read(dir, '.github/workflows/ci.yml');
  assert.match(ci, /npx next typegen && npx tsc --noEmit/);
  assert.match(ci, /- name: Tests \(aucune commande configurée\)/);
  assert.match(ci, /::warning title=Tests absents::/);
  assert.ok(!/\{\{|\}\}/.test(ci.replace(/\$\{\{ github\.[a-z]+ \}\}/g, '')), 'aucune balise non rendue');

  const pkg = JSON.parse(read(dir, 'package.json'));
  assert.match(pkg.scripts.prepare, /existsSync\('scripts\/install-git-hooks\.cjs'\)/);

  commitAll(dir, 'standard');
  const before = snapshot(dir);
  const second = real(['apply', dir]);
  assert.equal(second.status, 0, second.stderr);
  for (const { action, dest } of planActions(second.stdout)) assert.ok('=·»'.includes(action), `${dest} : ${action}`);
  assert.deepEqual(snapshot(dir), before);
});

test('gabarits réels : CI avec commands.test → étape Tests, sans avertissement', () => {
  const dir = preparedProject('node-simple');
  assert.equal(real(['apply', dir]).status, 0);
  const ci = read(dir, '.github/workflows/ci.yml');
  assert.match(ci, /- name: Tests\n\s+run: \|\n\s+npm test\n/);
  assert.ok(!ci.includes('Tests absents'));
});

test('gabarits réels : prepare ne fait rien sans le script, le lance s\'il existe', () => {
  const dir = preparedProject('node-simple');
  real(['apply', dir]);
  const prepare = JSON.parse(read(dir, 'package.json')).scripts.prepare;
  const run = (cwd) => spawnSync(prepare, { cwd, shell: true, encoding: 'utf8' });

  const docker = tmpDir('acc-docker-');
  write(docker, 'package.json', '{}\n');
  const absent = run(docker);
  assert.equal(absent.status, 0, absent.stderr);

  write(docker, 'scripts/install-git-hooks.cjs', "require('node:fs').writeFileSync('lance.txt', 'oui');\n");
  const present = run(docker);
  assert.equal(present.status, 0, present.stderr);
  assert.equal(read(docker, 'lance.txt'), 'oui');
});

test('gabarits réels : AGENTS.md et CLAUDE.md existants → squelettes complets', () => {
  const dir = copyProject('node-simple');
  write(dir, 'AGENTS.md', '# Consignes maison\n');
  write(dir, 'CLAUDE.md', '# Claude maison\n\n@AGENTS.md\n');
  cli(['detect', dir, '--write']);
  gitInit(dir);
  const res = real(['apply', dir]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  const agents = read(dir, 'AGENTS.md');
  assert.ok(!agents.includes('## Structure réelle'), 'hors blocs non ajouté au fichier du projet');
  const skeleton = read(dir, '.acc/skeletons/AGENTS.md');
  for (const heading of ['## Structure réelle', '## Commandes', '## Règles propres au projet', '## Pièges connus']) {
    assert.ok(skeleton.includes(heading), heading);
  }
  assert.match(skeleton, /npm run typecheck {4}# vérifier les types/);
  assert.match(read(dir, '.acc/skeletons/CLAUDE.md'), /## Chargement progressif/);
});
