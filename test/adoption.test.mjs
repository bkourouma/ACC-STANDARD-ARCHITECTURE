import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import {
  cli,
  commitAll,
  copyProject,
  exists,
  gitInit,
  planActions,
  preparedProject,
  read,
  snapshot,
  write,
} from './helpers.mjs';

const SKELETON = '.acc/skeletons/AGENTS.md';
const HOOK = '.claude/hooks/validate-bash.sh';

/** Contrôle nommé du diagnostic JSON. */
function doctorCheck(dir, label) {
  const res = cli(['doctor', dir, '--json']);
  return JSON.parse(res.stdout).checks.find((c) => c.label === label);
}

/** Projet vierge dont AGENTS.md existe déjà, écrit par l'équipe. */
function projectWithAgents(content = '# Mon projet\n\nTexte écrit par l\'équipe.\n') {
  const dir = copyProject('blank');
  write(dir, 'AGENTS.md', content);
  cli(['detect', dir, '--write']);
  gitInit(dir);
  return dir;
}

test('squelette : AGENTS.md existant → blocs ajoutés, fichier complet dans .acc/skeletons', () => {
  const dir = projectWithAgents();
  const res = cli(['apply', dir]);
  assert.equal(res.status, 0, res.stderr);
  assert.ok(!read(dir, 'AGENTS.md').includes('TODO(acc-adapt)'));
  const skeleton = read(dir, SKELETON);
  assert.ok(skeleton.startsWith('# blank\n\nTODO(acc-adapt) : décrire le projet.\n'), skeleton);
  assert.match(skeleton, /<!-- acc:begin agent-rules -->/);
  assert.match(res.stdout, /~\s+block\s+AGENTS\.md\s+base\s+blocs ajoutés : agent-workflows, agent-rules ; squelette → \.acc\/skeletons\/AGENTS\.md/);
  assert.match(res.stdout, /Squelette\(s\) des fichiers déjà présents/);
  assert.equal(doctorCheck(dir, 'Squelettes en attente').status, 'warn');
});

test('squelette : idempotent, tenu à jour s\'il existe, jamais recréé après suppression', () => {
  const dir = projectWithAgents();
  cli(['apply', dir]);
  commitAll(dir, 'standard');
  const before = snapshot(dir);
  const second = cli(['apply', dir]);
  assert.equal(second.status, 0, second.stderr);
  for (const { action, dest } of planActions(second.stdout)) assert.ok('=·»'.includes(action), `${dest} : ${action}`);
  assert.deepEqual(snapshot(dir), before, 'aucun octet modifié');

  // Config modifiée : le squelette encore présent suit le rendu.
  const config = JSON.parse(read(dir, 'acc.config.json'));
  config.git.mainBranch = 'trunk';
  write(dir, 'acc.config.json', `${JSON.stringify(config, null, 2)}\n`);
  write(dir, 'AGENTS.md', read(dir, 'AGENTS.md').replace('Branche principale : main', 'Branche principale : trunk'));
  commitAll(dir, 'trunk');
  assert.equal(cli(['apply', dir]).status, 0);
  assert.match(read(dir, SKELETON), /Branche principale : trunk/);

  // Intégré par /acc-adapt puis supprimé : plus jamais recréé.
  fs.rmSync(path.join(dir, '.acc', 'skeletons'), { recursive: true });
  commitAll(dir, 'squelette intégré');
  const after = cli(['apply', dir]);
  assert.equal(after.status, 0, after.stderr);
  assert.equal(exists(dir, SKELETON), false);
  assert.equal(doctorCheck(dir, 'Squelettes en attente').status, 'ok');
});

test('squelette : aucun quand le standard crée le fichier', () => {
  const dir = preparedProject('blank');
  assert.equal(cli(['apply', dir]).status, 0);
  assert.equal(exists(dir, '.acc/skeletons'), false);
});

test('squelette : écrit aussi en cas de conflit de bloc', () => {
  const dir = projectWithAgents('# Équipe\n\n<!-- acc:begin agent-rules -->\nrègle locale\n<!-- acc:end agent-rules -->\n');
  const res = cli(['apply', dir]);
  assert.equal(res.status, 2);
  assert.ok(exists(dir, 'AGENTS.md.acc-new'));
  assert.ok(exists(dir, SKELETON));
});

test('--adopt : fichiers jamais repris remplacés avec sauvegarde, sans .acc-new', () => {
  const dir = copyProject('blank');
  const localHook = '#!/usr/bin/env bash\necho "version locale"\n';
  const localAgents = '# Équipe\n\n<!-- acc:begin agent-rules -->\nrègle locale\n<!-- acc:end agent-rules -->\n';
  write(dir, HOOK, localHook);
  write(dir, 'AGENTS.md', localAgents);
  cli(['detect', dir, '--write']);
  gitInit(dir);

  const plain = cli(['plan', dir]);
  assert.equal(plain.status, 2, 'sans --adopt : conflits');
  const preview = cli(['plan', dir, '--adopt']);
  assert.equal(preview.status, 0, preview.stdout);
  assert.match(preview.stdout, /~\s+managed\s+\.claude\/hooks\/validate-bash\.sh\s+base\s+adopté, sauvegarde/);
  assert.equal(read(dir, HOOK), localHook, 'plan n\'écrit rien');

  const res = cli(['apply', dir, '--adopt']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /2 fichier\(s\) adopté\(s\)/);
  assert.match(read(dir, HOOK), /validate-bash v1/);
  assert.equal(read(dir, `${HOOK}.acc-bak`), localHook);
  assert.match(read(dir, 'AGENTS.md'), /- Branche principale : main/);
  assert.equal(read(dir, 'AGENTS.md.acc-bak'), localAgents);
  assert.equal(exists(dir, `${HOOK}.acc-new`), false);
  assert.equal(exists(dir, 'AGENTS.md.acc-new'), false);
  const manifest = JSON.parse(read(dir, '.acc/manifest.json'));
  assert.ok(manifest.files[HOOK].hash, 'fichier désormais repris par le standard');
});

test('--adopt : sauvegarde plus ancienne présente → .2.acc-bak annoncé et écrit, l\'ancienne intacte', () => {
  const dir = copyProject('blank');
  const localHook = '#!/usr/bin/env bash\necho "version locale"\n';
  const localAgents = '# Équipe\n\n<!-- acc:begin agent-rules -->\nrègle locale\n<!-- acc:end agent-rules -->\n';
  const anciennes = { [HOOK]: '#!/usr/bin/env bash\necho "ancienne"\n', 'AGENTS.md': '# Ancienne version\n' };
  write(dir, HOOK, localHook);
  write(dir, 'AGENTS.md', localAgents);
  for (const [rel, content] of Object.entries(anciennes)) write(dir, `${rel}.acc-bak`, content);
  cli(['detect', dir, '--write']);
  gitInit(dir);

  const preview = cli(['plan', dir, '--adopt']);
  assert.match(preview.stdout, /adopté, sauvegarde \.claude\/hooks\/validate-bash\.sh\.2\.acc-bak/);
  assert.match(preview.stdout, /adopté, sauvegarde AGENTS\.md\.2\.acc-bak/);
  assert.equal(exists(dir, `${HOOK}.2.acc-bak`), false, 'plan n\'écrit aucune sauvegarde');

  const res = cli(['apply', dir, '--adopt']);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /Sauvegardes créées :\s+- AGENTS\.md\.2\.acc-bak\s+- \.claude\/hooks\/validate-bash\.sh\.2\.acc-bak/);
  assert.doesNotMatch(res.stdout, /sauvegarde (AGENTS\.md|\.claude\/hooks\/validate-bash\.sh)\.acc-bak/);
  for (const [rel, content] of Object.entries(anciennes)) {
    assert.equal(read(dir, `${rel}.acc-bak`), content, `${rel}.acc-bak intacte`);
  }
  assert.equal(read(dir, `${HOOK}.2.acc-bak`), localHook);
  assert.equal(read(dir, 'AGENTS.md.2.acc-bak'), localAgents);
});

test('--adopt : un fichier déjà repris puis modifié reste un conflit', () => {
  const dir = preparedProject('blank');
  cli(['apply', dir]);
  write(dir, HOOK, '#!/usr/bin/env bash\necho "modifié après reprise"\n');
  commitAll(dir, 'modif locale');
  const res = cli(['apply', dir, '--adopt']);
  assert.equal(res.status, 2);
  assert.ok(exists(dir, `${HOOK}.acc-new`));
  assert.equal(exists(dir, `${HOOK}.acc-bak`), false);
});

test('--adopt : conflit initial déjà enregistré (entrée sans hash) → adopté', () => {
  const dir = copyProject('blank');
  write(dir, HOOK, '#!/usr/bin/env bash\necho "déjà équipé"\n');
  cli(['detect', dir, '--write']);
  gitInit(dir);
  assert.equal(cli(['apply', dir]).status, 2);
  assert.equal(JSON.parse(read(dir, '.acc/manifest.json')).files[HOOK].hash, undefined);
  fs.rmSync(path.join(dir, `${HOOK}.acc-new`));
  commitAll(dir, 'premier essai');
  const res = cli(['apply', dir, '--adopt']);
  assert.equal(res.status, 0, res.stdout);
  assert.match(read(dir, HOOK), /validate-bash v1/);
});

test('doctor : script prepare fragile signalé, forme tolérante acceptée', () => {
  const dir = preparedProject('node-simple');
  assert.equal(cli(['apply', dir]).status, 0);
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.scripts.prepare = 'node scripts/install-git-hooks.cjs';
  write(dir, 'package.json', JSON.stringify(pkg, null, 2));
  const fragile = doctorCheck(dir, 'Script prepare');
  assert.equal(fragile.status, 'warn');
  assert.match(fragile.detail, /existsSync/);
  pkg.scripts.prepare = "node -e \"require('fs').existsSync('scripts/install-git-hooks.cjs')&&require('./scripts/install-git-hooks.cjs')\"";
  write(dir, 'package.json', JSON.stringify(pkg, null, 2));
  assert.equal(doctorCheck(dir, 'Script prepare'), undefined);
});
