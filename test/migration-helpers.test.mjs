// Aides offertes aux migrations (renameManaged, removeManaged) : elles ne
// détruisent jamais de travail local (docs/CONTRACT.md §7).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { sha256 } from '../src/fs-utils.mjs';
import { migrationHelpers } from '../src/update.mjs';
import { cli, commitAll, exists, preparedProject, read, tmpDir, write } from './helpers.mjs';

const POSE = "'use strict';\n// tel que posé par le standard\n";
const managed = (content) => ({ mode: 'managed', profile: 'base', hash: sha256(content) });

/** Dossier cible, manifeste et journal prêts à l'emploi. */
function setup(files = {}) {
  const dir = tmpDir('acc-migration-');
  const manifest = { files: {} };
  for (const [rel, { content, entry }] of Object.entries(files)) {
    write(dir, rel, content);
    if (entry) manifest.files[rel] = entry;
  }
  const lines = [];
  return { dir, manifest, lines, helpers: migrationHelpers(dir, manifest, (m) => lines.push(m)) };
}

test('removeManaged : fichier tel que posé → supprimé, entrée retirée', () => {
  const { dir, manifest, lines, helpers } = setup({ 'scripts/a.cjs': { content: POSE, entry: managed(POSE) } });
  helpers.removeManaged('scripts/a.cjs');
  assert.equal(exists(dir, 'scripts/a.cjs'), false);
  assert.equal(manifest.files['scripts/a.cjs'], undefined);
  assert.deepEqual(lines, ['supprimé : scripts/a.cjs']);
});

test('removeManaged : fin de ligne CRLF seule → toujours « tel que posé »', () => {
  const { dir, helpers } = setup({ 'scripts/a.cjs': { content: POSE.replace(/\n/g, '\r\n'), entry: managed(POSE) } });
  helpers.removeManaged('scripts/a.cjs');
  assert.equal(exists(dir, 'scripts/a.cjs'), false);
});

test('removeManaged : fichier modifié localement → conservé, devient propriété du projet', () => {
  const edited = `${POSE}// ajout de l'équipe\n`;
  const { dir, manifest, lines, helpers } = setup({ 'scripts/a.cjs': { content: edited, entry: managed(POSE) } });
  helpers.removeManaged('scripts/a.cjs');
  assert.equal(read(dir, 'scripts/a.cjs'), edited);
  assert.equal(manifest.files['scripts/a.cjs'], undefined, 'il ne figure plus au manifeste');
  assert.match(lines[0], /conservé : scripts\/a\.cjs/);
});

test('removeManaged : sans entrée au manifeste, entrée sans hash ou autre mode → conservé', () => {
  const { dir, manifest, helpers } = setup({
    'a.txt': { content: 'a\n' },
    'b.txt': { content: 'b\n', entry: { mode: 'managed', profile: 'base' } },
    'c.txt': { content: 'c\n', entry: { mode: 'seed', profile: 'base' } },
    'd.txt': { content: 'd\n', entry: { mode: 'managed', profile: 'base', hash: sha256('autre') } },
  });
  for (const rel of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) helpers.removeManaged(rel);
  for (const rel of ['a.txt', 'b.txt', 'c.txt', 'd.txt']) assert.ok(exists(dir, rel), `${rel} doit rester`);
  assert.deepEqual(manifest.files, {});
});

test('removeManaged : fichier déjà absent → entrée retirée, pas d\'erreur', () => {
  const { manifest, lines, helpers } = setup();
  manifest.files['scripts/a.cjs'] = managed(POSE);
  helpers.removeManaged('scripts/a.cjs');
  assert.equal(manifest.files['scripts/a.cjs'], undefined);
  assert.match(lines[0], /déjà absent/);
});

test('renameManaged : renomme et reporte l\'entrée du manifeste', () => {
  const { dir, manifest, helpers } = setup({ 'scripts/old.cjs': { content: POSE, entry: managed(POSE) } });
  helpers.renameManaged('scripts/old.cjs', 'lib/new.cjs');
  assert.equal(exists(dir, 'scripts/old.cjs'), false);
  assert.equal(read(dir, 'lib/new.cjs'), POSE);
  assert.deepEqual(manifest.files, { 'lib/new.cjs': managed(POSE) });
});

test('renameManaged : destination existante → jamais écrasée, source conservée', () => {
  const mine = '// le fichier de l\'équipe, déjà à la nouvelle place\n';
  const { dir, manifest, lines, helpers } = setup({
    'scripts/old.cjs': { content: POSE, entry: managed(POSE) },
    'scripts/new.cjs': { content: mine, entry: managed('// autre hash\n') },
  });
  helpers.renameManaged('scripts/old.cjs', 'scripts/new.cjs');
  assert.equal(read(dir, 'scripts/new.cjs'), mine, 'la destination est intacte');
  assert.equal(read(dir, 'scripts/old.cjs'), POSE, 'la source reste en place');
  assert.equal(manifest.files['scripts/old.cjs'], undefined);
  assert.deepEqual(manifest.files['scripts/new.cjs'], managed('// autre hash\n'), 'entrée de la destination inchangée');
  assert.match(lines[0], /non renommé : scripts\/new\.cjs existe déjà/);
});

test('renameManaged : source modifiée localement → déplacée avec l\'ancien hash', () => {
  const edited = `${POSE}// ajout de l'équipe\n`;
  const { dir, manifest, helpers } = setup({ 'scripts/old.cjs': { content: edited, entry: managed(POSE) } });
  helpers.renameManaged('scripts/old.cjs', 'scripts/new.cjs');
  assert.equal(read(dir, 'scripts/new.cjs'), edited, 'le travail local est conservé');
  assert.equal(manifest.files['scripts/new.cjs'].hash, sha256(POSE), 'la modification ressortira en conflit');
});

test('renameManaged : source absente → l\'entrée suit, rien n\'est créé', () => {
  const { dir, manifest, helpers } = setup();
  manifest.files['scripts/old.cjs'] = managed(POSE);
  helpers.renameManaged('scripts/old.cjs', 'scripts/new.cjs');
  assert.equal(exists(dir, 'scripts/new.cjs'), false);
  assert.ok(manifest.files['scripts/new.cjs']);
});

test('les aides refusent un chemin qui sort de la cible', () => {
  const { helpers } = setup();
  assert.throws(() => helpers.removeManaged('../dehors.txt'), /hors de la cible/);
  assert.throws(() => helpers.renameManaged('a.txt', '../dehors.txt'), /hors de la cible/);
  assert.throws(() => helpers.renameManaged('a.txt', '.env'), /interdite/);
});

test('update : un agent-bus.cjs déjà présent n\'est pas écrasé par le renommage', () => {
  const dir = preparedProject('blank', (c) => ({ ...c, standardVersion: '0.0.1' }));
  assert.equal(cli(['apply', dir]).status, 0);
  // Le projet a gardé l'ancien nom ET a déjà son propre agent-bus.cjs modifié.
  const oldContent = "'use strict';\n// ancien bus\n";
  const mine = "'use strict';\n// agent-bus.cjs modifié par l'équipe\n";
  write(dir, 'scripts/old-bus.cjs', oldContent);
  write(dir, 'scripts/agent-bus.cjs', mine);
  const manifest = JSON.parse(read(dir, '.acc/manifest.json'));
  manifest.files['scripts/old-bus.cjs'] = managed(oldContent);
  write(dir, '.acc/manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  commitAll(dir, 'état 0.0.1');

  const res = cli(['update', dir]);
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.match(res.stdout, /non renommé : scripts\/agent-bus\.cjs existe déjà/);
  assert.equal(read(dir, 'scripts/agent-bus.cjs'), mine, 'le fichier de l\'équipe est intact');
  assert.equal(read(dir, 'scripts/old-bus.cjs'), oldContent, 'l\'ancien fichier est conservé');
  assert.match(read(dir, 'scripts/agent-bus.cjs.acc-new'), /Bus d'agents de test/, 'conflit signalé, proposition à côté');
});
