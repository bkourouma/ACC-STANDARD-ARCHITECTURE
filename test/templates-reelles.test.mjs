// Les vrais gabarits (templates/) appliqués pour de bon sur les projets
// factices. Les autres tests utilisent des gabarits de maquette : sans ce
// fichier, rien ne vérifie que ce qui est livré s'applique, est idempotent et
// produit des fichiers valides.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { cli, commitAll, exists, git, preparedProject, read, ROOT, snapshot, write } from './helpers.mjs';

const REAL_TEMPLATES = path.join(ROOT, 'templates');
const REAL_MIGRATIONS = path.join(ROOT, 'migrations');
const real = (args, cwd) => cli(args, { cwd, templates: REAL_TEMPLATES, env: { ACC_MIGRATIONS_DIR: REAL_MIGRATIONS } });

const PROJETS = ['blank', 'node-simple', 'npm-monorepo', 'husky-project', 'ts-no-typecheck', 'no-package'];

// Balise de gabarit oubliée : `{{#if`, `{{project.name}}`… (`${{ github.ref }}` a une espace).
const BALISE_RESTANTE = /\{\{[#/]?[a-zA-Z]/;

for (const name of PROJETS) {
  test(`gabarits réels : ${name} → apply sans conflit, idempotent, fichiers valides`, () => {
    const dir = preparedProject(name);
    const first = real(['apply', dir]);
    assert.equal(first.status, 0, first.stdout + first.stderr);
    assert.doesNotMatch(first.stdout, /^ {2}!/m, 'aucun conflit sur un projet vierge du standard');

    const manifest = JSON.parse(read(dir, '.acc/manifest.json'));
    for (const rel of Object.keys(manifest.files)) {
      assert.ok(exists(dir, rel), `${rel} est au manifeste mais absent`);
      const text = read(dir, rel);
      assert.ok(!text.includes('\r'), `${rel} doit être écrit en LF`);
      assert.ok(text.endsWith('\n'), `${rel} doit finir par une fin de ligne`);
      assert.doesNotMatch(text, BALISE_RESTANTE, `${rel} contient une balise de gabarit non rendue`);
      if (rel.endsWith('.json')) assert.doesNotThrow(() => JSON.parse(text), `${rel} n'est pas un JSON valide`);
    }

    commitAll(dir, 'standard');
    const before = snapshot(dir);
    const second = real(['apply', dir]);
    assert.equal(second.status, 0, second.stdout + second.stderr);
    assert.deepEqual(snapshot(dir), before, 'le second apply ne doit changer aucun octet');
    assert.equal(git(dir, 'status', '--porcelain'), '');

    const doctor = real(['doctor', dir]);
    assert.equal(doctor.status, 0, doctor.stdout);
  });
}

test('gabarits réels : adaptateurs Codex et Cursor et instance de démo', () => {
  const dir = preparedProject('node-simple', (c) => ({
    ...c,
    adapters: ['claude', 'codex', 'cursor'],
    options: { ...c.options, demoInstance: true },
  }));
  const res = real(['apply', dir]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  for (const rel of ['.codex/config.toml', '.cursor/rules/acc-standard.mdc', 'scripts/demo-instance.cjs']) {
    assert.ok(exists(dir, rel), `${rel} manquant`);
  }
  commitAll(dir, 'standard');
  const before = snapshot(dir);
  assert.equal(real(['apply', dir]).status, 0);
  assert.deepEqual(snapshot(dir), before);
});

test('gabarits réels : settings.json protège les hooks et demande confirmation pour la config', () => {
  const dir = preparedProject('blank');
  assert.equal(real(['apply', dir]).status, 0);
  const { permissions } = JSON.parse(read(dir, '.claude/settings.json'));
  for (const tool of ['Edit', 'Write']) {
    assert.ok(permissions.deny.includes(`${tool}(**/.claude/hooks/**)`), `${tool} sur les hooks doit être refusé`);
    assert.ok(permissions.ask.includes(`${tool}(**/.claude/settings.json)`));
    assert.ok(permissions.ask.includes(`${tool}(**/acc.config.json)`));
    // /acc-adapt doit pouvoir corriger acc.config.json : demande, pas refus.
    assert.ok(!permissions.deny.includes(`${tool}(**/acc.config.json)`));
  }
});

test('gabarits réels : settings.json existant fusionné sans rien retirer', () => {
  const dir = preparedProject('blank');
  write(
    dir,
    '.claude/settings.json',
    `${JSON.stringify({ env: { MA_VARIABLE: '1' }, permissions: { allow: ['Bash(ls)'], ask: ['Bash(rm *)'] } }, null, 2)}\n`,
  );
  commitAll(dir, 'settings du projet');
  assert.equal(real(['apply', dir]).status, 0);
  const settings = JSON.parse(read(dir, '.claude/settings.json'));
  assert.equal(settings.env.MA_VARIABLE, '1');
  assert.ok(settings.permissions.allow.includes('Bash(ls)'));
  assert.deepEqual(settings.permissions.ask.slice(0, 1), ['Bash(rm *)'], 'ordre de la cible conservé');
  assert.ok(settings.permissions.ask.includes('Edit(**/acc.config.json)'));
  assert.ok(settings.permissions.deny.includes('Edit(**/.claude/hooks/**)'));
});

test('gabarits réels : update depuis 0.0.0 avec les vraies migrations', () => {
  const dir = preparedProject('blank', (c) => ({ ...c, standardVersion: '0.0.0' }));
  const res = real(['update', dir]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /Migration 0\.1\.0/);
  assert.equal(JSON.parse(read(dir, 'acc.config.json')).standardVersion, JSON.parse(read(ROOT, 'package.json')).version);
});

test('gabarits réels : AGENTS.md et CLAUDE.md disent que les hooks sont un filet, pas une barrière', () => {
  const dir = preparedProject('blank');
  assert.equal(real(['apply', dir]).status, 0);
  for (const rel of ['AGENTS.md', 'CLAUDE.md']) {
    assert.match(read(dir, rel), /filet\s+contre\s+les\s+accidents,\s+pas\s+une\s+barrière/, rel);
  }
});

test('gabarits réels : CLAUDE.md, HANDOFF.md et /acc-adapt expliquent la section retired du manifeste', () => {
  const dir = preparedProject('blank');
  assert.equal(real(['apply', dir]).status, 0);
  for (const rel of ['CLAUDE.md', 'docs/workflows/HANDOFF.md', '.claude/skills/acc-adapt/SKILL.md']) {
    const text = read(dir, rel);
    assert.match(text, /section\s+`retired`/, rel);
    assert.match(text, /modification\s+locale\s+ressort(ira)?\s+en\s+conflit/, rel);
  }
});

test('gabarits réels : bus désactivé → agent-bus.cjs conservé dans retired, doctor sain', () => {
  const dir = preparedProject('blank');
  assert.equal(real(['apply', dir]).status, 0);
  commitAll(dir, 'standard');
  const config = JSON.parse(read(dir, 'acc.config.json'));
  config.options.agentBus = false;
  write(dir, 'acc.config.json', `${JSON.stringify(config, null, 2)}\n`);
  commitAll(dir, 'bus désactivé');
  const res = real(['apply', dir]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.ok(exists(dir, 'scripts/agent-bus.cjs'), 'apply ne supprime pas un fichier plus livré');
  const manifest = JSON.parse(read(dir, '.acc/manifest.json'));
  assert.equal(manifest.files['scripts/agent-bus.cjs'], undefined);
  assert.deepEqual(Object.keys(manifest.retired), ['scripts/agent-bus.cjs']);
  const doctor = real(['doctor', dir]);
  assert.equal(doctor.status, 0, doctor.stdout);
});
