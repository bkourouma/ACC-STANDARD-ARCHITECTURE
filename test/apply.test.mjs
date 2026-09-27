import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { test } from 'node:test';
import { sha256 } from '../src/fs-utils.mjs';
import {
  cli,
  commitAll,
  copyProject,
  copyTemplates,
  exists,
  git,
  gitInit,
  planActions,
  preparedProject,
  read,
  snapshot,
  write,
} from './helpers.mjs';

test('apply sur projet vierge : fichiers créés et manifeste conforme', () => {
  const dir = preparedProject('blank');
  const res = cli(['apply', dir]);
  assert.equal(res.status, 0, res.stderr);
  for (const rel of [
    'AGENTS.md',
    '.claude/hooks/validate-bash.sh',
    'docs/workflows/HANDOFF.md',
    '.claude/settings.json',
    '.gitignore',
    'scripts/agent-bus.cjs',
    'docs/blank-notes.md',
  ]) {
    assert.ok(exists(dir, rel), `${rel} doit exister`);
  }
  assert.equal(exists(dir, 'package.json'), false, 'profil node non sélectionné sans package.json');
  assert.match(read(dir, 'docs/workflows/HANDOFF.md'), /Standard 0\.1\.0 \(81313c5\)/);
  const manifest = JSON.parse(read(dir, '.acc/manifest.json'));
  assert.equal(manifest.standardVersion, '0.1.0');
  assert.equal(manifest.sourceCommit, '81313c5');
  assert.ok(!Number.isNaN(Date.parse(manifest.appliedAt)));
  const hook = manifest.files['.claude/hooks/validate-bash.sh'];
  assert.deepEqual(hook, { mode: 'managed', profile: 'base', hash: sha256(read(dir, '.claude/hooks/validate-bash.sh')) });
  assert.deepEqual(Object.keys(manifest.files['AGENTS.md'].blocks), ['agent-workflows', 'agent-rules']);
  assert.deepEqual(manifest.files['docs/workflows/HANDOFF.md'], { mode: 'seed', profile: 'base' });
  assert.deepEqual(manifest.files['.claude/settings.json'], { mode: 'merge-json', profile: 'base' });
  assert.match(res.stdout, /Étapes suivantes/);
  assert.match(res.stdout, /git add -A && git commit/);
  // Aucun commit n'est fait par apply.
  assert.equal(git(dir, 'rev-list', '--count', 'HEAD'), '1');
  for (const content of Object.values(snapshot(dir))) assert.ok(!content.includes('\r\n'));
});

test('idempotence : un second apply ne change aucun octet', () => {
  const dir = preparedProject('node-simple');
  assert.equal(cli(['apply', dir]).status, 0);
  commitAll(dir, 'standard');
  const before = snapshot(dir);
  const second = cli(['apply', dir]);
  assert.equal(second.status, 0, second.stderr);
  const actions = planActions(second.stdout);
  assert.ok(actions.length > 0);
  for (const { action, dest } of actions) assert.ok('=·»'.includes(action), `${dest} : ${action}`);
  assert.deepEqual(snapshot(dir), before);
  assert.equal(git(dir, 'status', '--porcelain'), '');
});

test('managed modifié localement : .acc-new, cible intacte, code 2 ; --force : .acc-bak', () => {
  const dir = preparedProject('blank');
  cli(['apply', dir]);
  const rel = '.claude/hooks/validate-bash.sh';
  const manifestBefore = read(dir, '.acc/manifest.json');
  write(dir, rel, '#!/usr/bin/env bash\necho "modifié à la main"\n');
  commitAll(dir, 'modif locale');
  const res = cli(['apply', dir]);
  assert.equal(res.status, 2);
  assert.match(res.stdout, /!\s+managed\s+\.claude\/hooks\/validate-bash\.sh/);
  assert.equal(read(dir, rel), '#!/usr/bin/env bash\necho "modifié à la main"\n');
  assert.match(read(dir, `${rel}.acc-new`), /validate-bash v1/);
  const hashBefore = JSON.parse(manifestBefore).files[rel].hash;
  assert.equal(JSON.parse(read(dir, '.acc/manifest.json')).files[rel].hash, hashBefore, 'ancien hash conservé');

  fs.rmSync(path.join(dir, `${rel}.acc-new`));
  const forced = cli(['apply', dir, '--force']);
  assert.equal(forced.status, 0, forced.stderr);
  assert.equal(read(dir, `${rel}.acc-bak`), '#!/usr/bin/env bash\necho "modifié à la main"\n');
  assert.match(read(dir, rel), /validate-bash v1/);
});

test('managed : mise à jour silencieuse si la cible n\'a pas bougé', () => {
  const dir = preparedProject('blank');
  const templates = copyTemplatesWith((t) => t);
  cli(['apply', dir, '--templates', templates]);
  commitAll(dir, 'standard');
  write(templates, 'base/files/validate-bash.sh', '#!/usr/bin/env bash\necho "validate-bash v2"\n');
  const res = cli(['apply', dir, '--templates', templates]);
  assert.equal(res.status, 0, res.stderr);
  assert.match(res.stdout, /~\s+managed\s+\.claude\/hooks\/validate-bash\.sh/);
  assert.match(read(dir, '.claude/hooks/validate-bash.sh'), /v2/);
});

test('block : AGENTS.md sans blocs → blocs ajoutés en fin, texte du projet intact', () => {
  const dir = copyProject('blank');
  const original = '# Mon projet\n\nTexte écrit par l\'équipe.\r\nDeuxième ligne.\r\n';
  write(dir, 'AGENTS.md', original);
  cli(['detect', dir, '--write']);
  gitInit(dir);
  assert.equal(cli(['apply', dir]).status, 0);
  const text = read(dir, 'AGENTS.md');
  assert.ok(text.startsWith('# Mon projet\n\nTexte écrit par l\'équipe.\nDeuxième ligne.\n\n<!-- acc:begin agent-workflows -->'));
  assert.ok(text.endsWith('<!-- acc:end agent-rules -->\n'));
  assert.ok(!text.includes('TODO(acc-adapt)'), 'le texte hors blocs du gabarit ne sert qu\'à la création');
  assert.equal(text.match(/acc:begin agent-rules/g).length, 1);
});

test('block : bloc modifié localement → conflit, cible intacte', () => {
  const dir = preparedProject('blank');
  cli(['apply', dir]);
  const edited = read(dir, 'AGENTS.md').replace('- Branche principale : main', '- Branche principale : trunk (maison)');
  write(dir, 'AGENTS.md', edited);
  commitAll(dir, 'modif bloc');
  const res = cli(['apply', dir]);
  assert.equal(res.status, 2);
  assert.match(res.stdout, /bloc « agent-rules » modifié localement/);
  assert.equal(read(dir, 'AGENTS.md'), edited);
  assert.match(read(dir, 'AGENTS.md.acc-new'), /- Branche principale : main\n/);
});

test('block : bloc mis à jour quand le gabarit change et que la cible n\'a pas bougé', () => {
  const dir = preparedProject('blank');
  const templates = copyTemplatesWith((t) => t);
  cli(['apply', dir, '--templates', templates]);
  const projectLine = '\nNote ajoutée par le projet hors blocs.\n';
  write(dir, 'AGENTS.md', read(dir, 'AGENTS.md') + projectLine);
  commitAll(dir, 'note projet');
  const tpl = path.join(templates, 'base/files/AGENTS.md');
  fs.writeFileSync(tpl, fs.readFileSync(tpl, 'utf8').replace('## Règles', '## Règles v2'));
  const res = cli(['apply', dir, '--templates', templates]);
  assert.equal(res.status, 0, res.stdout + res.stderr);
  assert.match(res.stdout, /~\s+block\s+AGENTS\.md/);
  const text = read(dir, 'AGENTS.md');
  assert.match(text, /## Règles v2/);
  assert.ok(text.endsWith(projectLine), 'texte du projet conservé');
  assert.match(text, /# blank/);
});

test('seed : jamais retouché', () => {
  const dir = preparedProject('blank');
  cli(['apply', dir]);
  write(dir, 'docs/workflows/HANDOFF.md', 'contenu du projet\n');
  fs.rmSync(path.join(dir, 'docs/blank-notes.md'));
  write(dir, 'docs/blank-notes.md', 'notes à nous\r\n');
  commitAll(dir, 'seed modifié');
  const res = cli(['apply', dir, '--force']);
  assert.equal(res.status, 0);
  assert.equal(read(dir, 'docs/workflows/HANDOFF.md'), 'contenu du projet\n');
  assert.equal(read(dir, 'docs/blank-notes.md'), 'notes à nous\r\n');
  assert.match(res.stdout, /·\s+seed\s+docs\/workflows\/HANDOFF\.md/);
});

test('merge-json : settings.json existant, union sans doublon, la cible gagne, indentation conservée', () => {
  const dir = copyProject('node-simple');
  const settings = {
    permissions: { allow: ['Bash(git status)', 'Bash(ls)'], defaultMode: 'plan' },
    hooks: {
      PreToolUse: [
        {
          matcher: 'Bash',
          hooks: [
            { type: 'command', command: 'bash .claude/hooks/validate-bash.sh', timeout: 5 },
            { type: 'command', command: 'bash maison.sh' },
          ],
        },
      ],
      Stop: [{ hooks: [{ type: 'command', command: 'echo fin' }] }],
    },
    env: { ACC_STANDARD: '0' },
  };
  write(dir, '.claude/settings.json', `${JSON.stringify(settings, null, 4)}\n`);
  cli(['detect', dir, '--write']);
  gitInit(dir);
  const res = cli(['apply', dir]);
  assert.equal(res.status, 0, res.stderr);
  const text = read(dir, '.claude/settings.json');
  assert.match(text, /^\{\n {4}"permissions": \{\n {8}"allow"/);
  const merged = JSON.parse(text);
  assert.deepEqual(Object.keys(merged), ['permissions', 'hooks', 'env']);
  assert.deepEqual(merged.permissions.allow, ['Bash(git status)', 'Bash(ls)', 'Bash(npm test)']);
  assert.equal(merged.permissions.defaultMode, 'plan');
  assert.deepEqual(merged.permissions.deny, ['Read(./.env)']);
  assert.equal(merged.hooks.PreToolUse.length, 1);
  assert.deepEqual(merged.hooks.PreToolUse[0].hooks.map((h) => h.command), [
    'bash .claude/hooks/validate-bash.sh',
    'bash maison.sh',
  ]);
  assert.equal(merged.hooks.PreToolUse[0].hooks[0].timeout, 5);
  assert.deepEqual(merged.hooks.Stop, settings.hooks.Stop);
  assert.equal(merged.env.ACC_STANDARD, '0', 'la cible gagne sur les scalaires');

  const pkg = JSON.parse(read(dir, 'package.json'));
  assert.equal(pkg.scripts.test, 'node --test');
  assert.equal(pkg.scripts['agent-bus'], 'node scripts/agent-bus.cjs');
  assert.equal(pkg.devDependencies.lefthook, '^1.7.0');
});

test('merge-json : un script existant n\'est pas remplacé', () => {
  const dir = copyProject('node-simple');
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.scripts.test = 'vitest run';
  write(dir, 'package.json', `${JSON.stringify(pkg, null, 2)}\n`);
  cli(['detect', dir, '--write']);
  gitInit(dir);
  assert.equal(cli(['apply', dir]).status, 0);
  const after = JSON.parse(read(dir, 'package.json'));
  assert.equal(after.scripts.test, 'vitest run');
  assert.deepEqual(Object.keys(after).slice(0, 3), ['name', 'version', 'description']);
});

test('merge-json : JSON cible illisible → conflit avec le fragment en .acc-new', () => {
  const dir = copyProject('blank');
  write(dir, '.claude/settings.json', '{ pas du json');
  cli(['detect', dir, '--write']);
  gitInit(dir);
  const res = cli(['apply', dir]);
  assert.equal(res.status, 2);
  assert.equal(read(dir, '.claude/settings.json'), '{ pas du json');
  assert.ok(JSON.parse(read(dir, '.claude/settings.json.acc-new')).hooks);
});

test('merge-lines : .gitignore complété, en-tête ajouté une seule fois', () => {
  const dir = copyProject('node-simple');
  write(dir, '.gitignore', 'node_modules/\r\n.idea/\r\n');
  cli(['detect', dir, '--write']);
  gitInit(dir);
  assert.equal(cli(['apply', dir]).status, 0);
  const first = read(dir, '.gitignore');
  assert.equal(first, 'node_modules/\n.idea/\n\n# acc-standard\n*.acc-new\n*.acc-bak\ndist/\ncoverage/\n');
  write(dir, '.gitignore', first.replace('dist/\n', ''));
  commitAll(dir, 'retrait dist');
  assert.equal(cli(['apply', dir]).status, 0);
  const second = read(dir, '.gitignore');
  assert.equal(second.match(/# acc-standard/g).length, 1);
  assert.ok(second.endsWith('coverage/\ndist/\n'));
});

test('refus : dépôt sale sans --allow-dirty, absence de dépôt', () => {
  const dir = preparedProject('blank');
  write(dir, 'wip.txt', 'en cours\n');
  const res = cli(['apply', dir]);
  assert.equal(res.status, 1);
  assert.match(res.stderr, /non commitées/);
  assert.equal(exists(dir, 'AGENTS.md'), false);
  assert.equal(cli(['apply', dir, '--allow-dirty']).status, 0);

  const noRepo = copyProject('blank');
  cli(['detect', noRepo, '--write']);
  const res2 = cli(['apply', noRepo]);
  assert.equal(res2.status, 1);
  assert.match(res2.stderr, /pas un dépôt git/);
});

test('refus : config absente → propose detect --write', () => {
  const dir = copyProject('blank');
  gitInit(dir);
  for (const cmd of ['plan', 'apply']) {
    const res = cli([cmd, dir]);
    assert.equal(res.status, 1);
    assert.match(res.stderr, /detect --write/);
  }
});

test('refus : dest .env, dest hors cible, collision de gabarits', () => {
  const dir = preparedProject('blank');
  const cases = [
    [{ src: 'x', dest: '.env', mode: 'seed' }, /environnement/],
    [{ src: 'x', dest: 'config/.env.local', mode: 'seed' }, /environnement/],
    [{ src: 'x', dest: '../evade.txt', mode: 'seed' }, /hors de la cible/],
    [{ src: 'x', dest: '{{project.slug}}/../../evade.txt', mode: 'seed' }, /hors de la cible/],
    [{ src: 'x', dest: 'AGENTS.md', mode: 'managed' }, /Erreur de gabarit/],
  ];
  for (const [entry, expected] of cases) {
    const templates = copyTemplatesWith((t) => {
      write(t, 'base/files/x', 'x\n');
      const file = path.join(t, 'base/profile.json');
      const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
      profile.files.push(entry);
      fs.writeFileSync(file, JSON.stringify(profile));
    });
    const res = cli(['apply', dir, '--templates', templates]);
    assert.equal(res.status, 1, `${entry.dest} doit être refusé`);
    assert.match(res.stderr, expected);
    assert.equal(exists(dir, 'AGENTS.md'), false, 'rien n\'est écrit');
  }
  const envOk = copyTemplatesWith((t) => {
    write(t, 'base/files/x', 'X=1\n');
    const file = path.join(t, 'base/profile.json');
    const profile = JSON.parse(fs.readFileSync(file, 'utf8'));
    profile.files.push({ src: 'x', dest: '.env.example', mode: 'seed' });
    fs.writeFileSync(file, JSON.stringify(profile));
  });
  assert.equal(cli(['apply', dir, '--templates', envOk]).status, 0);
  assert.equal(read(dir, '.env.example'), 'X=1\n');
});

test('sélection : when, requires, adaptateur codex, demo-instance, dest templatisée', () => {
  const dir = preparedProject('node-simple', (c) => {
    c.adapters = ['claude', 'codex'];
    c.options = { agentBus: false, demoInstance: true };
    c.profiles = ['node', 'base'];
    return c;
  });
  const res = cli(['plan', dir, '--json']);
  assert.equal(res.status, 0, res.stderr);
  const plan = JSON.parse(res.stdout);
  assert.deepEqual(plan.profiles, ['base', 'node', 'adapter-codex', 'demo-instance']);
  const dests = plan.items.map((i) => i.dest);
  assert.ok(dests.includes('.codex/config.toml'));
  assert.ok(dests.includes('scripts/demo-instance.cjs'));
  assert.ok(dests.includes('docs/node-simple-notes.md'));
  assert.ok(!dests.includes('scripts/agent-bus.cjs'), 'when options.agentBus faux');
  assert.deepEqual(plan.items.find((i) => i.dest === '.gitignore').profiles, ['base', 'node']);
  assert.ok(plan.items.every((i) => i.action === '+' || i.action === '»'));
  assert.equal(exists(dir, '.codex'), false, 'plan n\'écrit rien');
});

test('--dry-run n\'écrit rien ; --branch crée la branche', () => {
  const dir = preparedProject('blank');
  const dry = cli(['apply', dir, '--dry-run']);
  assert.equal(dry.status, 0);
  assert.match(dry.stdout, /Total :/);
  assert.equal(exists(dir, 'AGENTS.md'), false);
  const res = cli(['apply', dir, '--branch']);
  assert.equal(res.status, 0, res.stderr);
  assert.equal(git(dir, 'branch', '--show-current'), 'chore/acc-standard-v0.1.0');
  assert.match(res.stdout, /Branche créée/);
});

test('CLI : --help, --version, commande et option inconnues', () => {
  const help = cli(['--help']);
  assert.equal(help.status, 0);
  assert.match(help.stdout, /Usage/);
  assert.equal(cli(['--version']).stdout.trim(), '0.1.0');
  assert.equal(cli(['nimporte']).status, 1);
  assert.equal(cli(['plan', '--inconnu']).status, 1);
});

/** Copie les gabarits de test puis applique une modification. */
function copyTemplatesWith(mutate) {
  const dir = copyTemplates();
  mutate(dir);
  return dir;
}
