import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { sha256 } from '../src/fs-utils.mjs';
import { listMigrations } from '../src/update.mjs';
import { cli, commitAll, copyProject, exists, MIGRATIONS, preparedProject, read, write } from './helpers.mjs';

test('doctor : installation saine → 0', () => {
  const dir = preparedProject('node-simple');
  assert.equal(cli(['apply', dir]).status, 0);
  const res = cli(['doctor', dir]);
  assert.equal(res.status, 0, res.stdout);
  assert.match(res.stdout, /Diagnostic : sain/);
  const json = JSON.parse(cli(['doctor', dir, '--json']).stdout);
  assert.equal(json.ok, true);
  assert.ok(json.checks.some((c) => c.label === 'Hooks git' && c.status === 'warn'));
});

test('doctor : managed modifié localement → 2', () => {
  const dir = preparedProject('blank');
  cli(['apply', dir]);
  write(dir, 'scripts/agent-bus.cjs', 'modifié\n');
  const res = cli(['doctor', dir]);
  assert.equal(res.status, 2);
  assert.match(res.stdout, /Fichier géré scripts\/agent-bus\.cjs\s+modifié localement/);
});

test('doctor : bloc modifié, .acc-new en attente, fichier manquant, config absente', () => {
  const dir = preparedProject('blank');
  cli(['apply', dir]);
  write(dir, 'AGENTS.md', read(dir, 'AGENTS.md').replace('## Règles', '## Nos règles'));
  write(dir, 'docs/x.md.acc-new', 'x\n');
  fs.rmSync(path.join(dir, '.claude/settings.json'));
  const res = cli(['doctor', dir, '--json']);
  assert.equal(res.status, 2);
  const failed = JSON.parse(res.stdout).checks.filter((c) => c.status === 'fail').map((c) => c.label);
  assert.ok(failed.includes('Bloc AGENTS.md#agent-rules'));
  assert.ok(failed.includes('Conflits en attente'));
  assert.ok(failed.includes('Fichiers du manifeste'));

  const empty = copyProject('blank');
  const res2 = cli(['doctor', empty]);
  assert.equal(res2.status, 2);
  assert.match(res2.stdout, /acc\.config\.json absent/);
});

test('listMigrations : bornes strictes et ordre semver', () => {
  assert.deepEqual(listMigrations(MIGRATIONS, '0.0.1', '0.1.0').map((m) => m.version), ['0.1.0']);
  assert.deepEqual(listMigrations(MIGRATIONS, '0.0.0', '0.2.0').map((m) => m.version), ['0.0.1', '0.1.0', '0.2.0']);
  assert.deepEqual(listMigrations(MIGRATIONS, '0.1.0', '0.1.0'), []);
  assert.deepEqual(listMigrations(path.join(MIGRATIONS, 'absent'), '0.0.0'), []);
});

test('update : migration qui renomme un fichier géré, standardVersion mis à jour', () => {
  const dir = preparedProject('blank', (c) => ({ ...c, standardVersion: '0.0.1' }));
  assert.equal(cli(['apply', dir]).status, 0);
  // Simule l'état 0.0.1 : le bus s'appelait old-bus.cjs, avec un autre contenu.
  const oldContent = "'use strict';\n// ancien bus\n";
  fs.rmSync(path.join(dir, 'scripts/agent-bus.cjs'));
  write(dir, 'scripts/old-bus.cjs', oldContent);
  const manifestFile = path.join(dir, '.acc/manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestFile, 'utf8'));
  delete manifest.files['scripts/agent-bus.cjs'];
  manifest.files['scripts/old-bus.cjs'] = { mode: 'managed', profile: 'base', hash: sha256(oldContent) };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  commitAll(dir, 'état 0.0.1');

  const res = cli(['update', dir]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /Migration 0\.1\.0/);
  assert.match(res.stdout, /~\s+managed\s+scripts\/agent-bus\.cjs/);
  assert.equal(exists(dir, 'scripts/old-bus.cjs'), false);
  assert.match(read(dir, 'scripts/agent-bus.cjs'), /Bus d'agents de test/);
  const config = JSON.parse(read(dir, 'acc.config.json'));
  assert.equal(config.standardVersion, '0.1.0');
  assert.equal(config.migratedTo, '0.1.0');
  const after = JSON.parse(read(dir, '.acc/manifest.json'));
  assert.equal(after.files['scripts/old-bus.cjs'], undefined);
  assert.equal(after.files['scripts/agent-bus.cjs'].hash, sha256(read(dir, 'scripts/agent-bus.cjs')));
  assert.equal(exists(dir, 'migration-0.0.1.txt'), false, 'migration <= version courante ignorée');
  assert.equal(exists(dir, 'migration-0.2.0.txt'), false, 'migration > version du paquet ignorée');

  commitAll(dir, 'update');
  const again = cli(['update', dir]);
  assert.equal(again.status, 0);
  assert.match(again.stdout, /Aucune migration/);
});

test('update : refuse un dépôt sale', () => {
  const dir = preparedProject('blank', (c) => ({ ...c, standardVersion: '0.0.1' }));
  write(dir, 'wip.txt', 'x\n');
  const res = cli(['update', dir]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /non commitées/);
});
