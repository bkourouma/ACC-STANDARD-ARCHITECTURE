// Fichiers repris par le standard puis plus livrés (condition `when` devenue
// fausse, profil ou adaptateur retiré) : leur trace reste dans la section
// `retired` du manifeste (docs/CONTRACT.md §5 et §6).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { sha256 } from '../src/fs-utils.mjs';
import { cli, commitAll, copyTemplates, exists, preparedProject, read, snapshot, write } from './helpers.mjs';

const BUS = 'scripts/agent-bus.cjs';
const LOCAL = "'use strict';\n// bus modifié par l'équipe\n";

const manifestOf = (dir) => JSON.parse(read(dir, '.acc/manifest.json'));

/** Change options.agentBus dans acc.config.json puis commite. */
function setAgentBus(dir, value) {
  const config = JSON.parse(read(dir, 'acc.config.json'));
  config.options.agentBus = value;
  write(dir, 'acc.config.json', `${JSON.stringify(config, null, 2)}\n`);
  commitAll(dir, `agentBus=${value}`);
}

/** Applique avec succès puis commite. */
function applyOk(dir, templates, message) {
  const res = cli(['apply', dir], { templates });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  commitAll(dir, message);
  return res;
}

/** Projet dont le bus a été repris, modifié localement, puis n'est plus livré. */
function retiredModifiedBus() {
  const dir = preparedProject('blank', (c) => ({ ...c, options: { ...c.options, agentBus: true } }));
  applyOk(dir, undefined, 'standard');
  const posed = manifestOf(dir).files[BUS];
  write(dir, BUS, LOCAL);
  commitAll(dir, 'bus modifié');
  setAgentBus(dir, false);
  applyOk(dir, undefined, 'bus plus livré');
  return { dir, posed };
}

for (const command of ['apply', 'update']) {
  test(`${command} --adopt : un fichier repris, modifié puis plus livré reste un conflit à son retour`, () => {
    const { dir } = retiredModifiedBus();
    setAgentBus(dir, true);
    const res = cli([command, dir, '--adopt']);
    assert.equal(res.status, 2, res.stdout + res.stderr);
    assert.match(res.stdout, /!\s+managed\s+scripts\/agent-bus\.cjs\s+base\s+modifié localement → scripts\/agent-bus\.cjs\.acc-new/);
    assert.doesNotMatch(res.stdout, /fichier\(s\) adopté\(s\)/);
    assert.equal(read(dir, BUS), LOCAL, 'la modification locale est intacte');
    assert.match(read(dir, `${BUS}.acc-new`), /Bus d'agents de test/);
    assert.equal(exists(dir, `${BUS}.acc-bak`), false, 'aucun remplacement, donc aucune sauvegarde');
  });
}

test('fichier repris plus livré : trace gardée dans retired, un apply de plus ne change aucun octet', () => {
  const { dir, posed } = retiredModifiedBus();
  const manifest = manifestOf(dir);
  assert.equal(manifest.files[BUS], undefined, 'plus livré, donc plus dans files');
  assert.deepEqual(manifest.retired, { [BUS]: posed }, 'entrée gardée telle quelle, avec le hash posé');
  assert.equal(read(dir, BUS), LOCAL, 'apply ne touche pas un fichier plus livré');

  const before = snapshot(dir);
  const again = cli(['apply', dir]);
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /Manifeste inchangé/);
  assert.deepEqual(snapshot(dir), before, 'aucun octet modifié');
});

test('fichier retiré resté tel que posé : mis à jour à son retour, sans conflit ni --adopt', () => {
  const templates = copyTemplates();
  const dir = preparedProject('blank', (c) => ({ ...c, options: { ...c.options, agentBus: true } }));
  applyOk(dir, templates, 'standard');
  setAgentBus(dir, false);
  applyOk(dir, templates, 'bus plus livré');
  write(templates, 'base/files/agent-bus.cjs', "'use strict';\n// Bus d'agents de test.\nmodule.exports = { version: 2 };\n");

  setAgentBus(dir, true);
  const res = cli(['apply', dir], { templates });
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /~\s+managed\s+scripts\/agent-bus\.cjs/);
  assert.match(read(dir, BUS), /version: 2/);
  const manifest = manifestOf(dir);
  assert.equal(manifest.files[BUS].hash, sha256(read(dir, BUS)));
  assert.equal(manifest.retired, undefined, 'section absente quand elle est vide');
});

test('fichier retiré puis supprimé : la trace est oubliée, il est recréé à son retour', () => {
  const { dir } = retiredModifiedBus();
  fs.rmSync(path.join(dir, BUS));
  commitAll(dir, 'bus supprimé');
  applyOk(dir, undefined, 'trace oubliée');
  assert.equal(manifestOf(dir).retired, undefined);

  setAgentBus(dir, true);
  const res = cli(['apply', dir, '--adopt']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /\+\s+managed\s+scripts\/agent-bus\.cjs/);
});

test('block repris, modifié puis plus livré : conflit à son retour, squelette non recréé ; seed non gardé', () => {
  const templates = copyTemplates();
  const profileFile = path.join(templates, 'base', 'profile.json');
  const profile = JSON.parse(fs.readFileSync(profileFile, 'utf8'));
  for (const file of profile.files) {
    if (['AGENTS.md', 'docs/workflows/HANDOFF.md'].includes(file.dest)) file.when = 'options.agentBus';
  }
  fs.writeFileSync(profileFile, JSON.stringify(profile, null, 2));
  const dir = preparedProject('blank', (c) => ({ ...c, options: { ...c.options, agentBus: true } }));
  applyOk(dir, templates, 'standard');
  const posed = manifestOf(dir).files['AGENTS.md'];
  write(dir, 'AGENTS.md', read(dir, 'AGENTS.md').replace('## Règles', '## Nos règles'));
  commitAll(dir, 'bloc modifié');

  setAgentBus(dir, false);
  applyOk(dir, templates, 'plus livrés');
  assert.deepEqual(Object.keys(manifestOf(dir).retired), ['AGENTS.md', BUS], 'seed sans trace utile : non gardé');
  assert.deepEqual(manifestOf(dir).retired['AGENTS.md'], posed);

  setAgentBus(dir, true);
  const res = cli(['apply', dir, '--adopt'], { templates });
  assert.equal(res.status, 2, res.stdout + res.stderr);
  assert.match(res.stdout, /!\s+block\s+AGENTS\.md\s+base\s+bloc « agent-rules » modifié localement/);
  assert.match(read(dir, 'AGENTS.md'), /## Nos règles/);
  assert.equal(exists(dir, 'AGENTS.md.acc-bak'), false);
  assert.equal(exists(dir, '.acc/skeletons/AGENTS.md'), false, 'fichier déjà repris : pas de squelette');
  assert.equal(manifestOf(dir).retired, undefined, 'tous les fichiers sont de nouveau livrés');
});
