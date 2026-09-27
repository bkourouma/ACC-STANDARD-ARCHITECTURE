import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateConfig } from '../src/config.mjs';
import { detectProject, findNearbyProjects, isUnrecognizedTarget, majorVersion } from '../src/detect.mjs';
import { STANDARD_COMMAND, STANDARD_VERSION } from '../src/version.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { cli, commitAll, copyProject, exists, git, gitInit, read, tmpDir, write } from './helpers.mjs';

test('detect : projet Node simple', () => {
  const dir = copyProject('node-simple');
  const { config, warnings } = detectProject(dir);
  assert.deepEqual(validateConfig(config), []);
  assert.equal(config.standardVersion, STANDARD_VERSION);
  assert.equal(config.project.name, 'node-simple');
  assert.equal(config.project.slug, 'node-simple');
  assert.equal(config.project.description, 'Projet Node simple');
  assert.deepEqual(config.profiles, ['base', 'node']);
  assert.deepEqual(config.adapters, ['claude']);
  assert.deepEqual(config.stack, {
    packageManager: 'npm',
    workspaces: false,
    typescript: true,
    eslint: true,
    prettier: false,
    languages: ['javascript', 'typescript'],
  });
  assert.deepEqual(config.commands, {
    install: 'npm install',
    dev: 'npm run dev',
    build: 'npm run build',
    typecheck: 'npm run typecheck',
    lint: 'npm run lint',
    test: 'npm test',
  });
  assert.deepEqual(config.ports, { app: 3000, api: 8001 });
  assert.equal(config.git.mainBranch, 'main');
  assert.deepEqual(config.hooks.preCommit, [
    { name: 'typecheck', command: 'npm run typecheck', blocking: true, whenStaged: ['**/*.ts', '**/*.tsx'] },
    {
      name: 'lint',
      command: 'npm run lint',
      blocking: false,
      whenStaged: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    },
  ]);
  assert.deepEqual(config.guard.protectedPaths, ['src']);
  assert.equal(config.guard.destructiveCommands.length, 1);
  assert.match(config.guard.destructiveCommands[0].pattern, /DROP/);
  assert.deepEqual(config.options, { agentBus: true, demoInstance: false });
  assert.deepEqual(warnings, []);
});

test('detect : monorepo npm avec workspaces et Prisma', () => {
  const dir = copyProject('npm-monorepo');
  const { config } = detectProject(dir);
  assert.equal(config.project.name, '@acme/monorepo');
  assert.equal(config.project.slug, 'acme-monorepo');
  assert.equal(config.stack.workspaces, true);
  assert.equal(config.stack.typescript, true, 'typescript vient d\'un workspace');
  assert.equal(config.stack.prettier, true);
  assert.deepEqual(config.ports, { web: 3000, api: 8001 });
  assert.deepEqual(config.guard.protectedPaths, ['apps', 'packages']);
  assert.ok(config.guard.destructiveCommands.some((c) => /prisma/.test(c.pattern)));
  assert.equal(config.commands.lint, '');
  assert.deepEqual(config.hooks.preCommit.map((h) => h.name), ['typecheck']);
});

test('detect : projet Husky (yarn, test par défaut ignoré, avertissement)', () => {
  const dir = copyProject('husky-project');
  const { config, warnings } = detectProject(dir);
  assert.equal(config.stack.packageManager, 'yarn');
  assert.equal(config.stack.eslint, true);
  assert.equal(config.commands.lint, 'yarn lint');
  assert.equal(config.commands.test, '', 'le test npm par défaut ne compte pas');
  assert.equal(warnings.length, 1);
  assert.match(warnings[0], /Husky/);
});

test('detect : projet Python sans package.json', () => {
  const dir = copyProject('no-package');
  const { config } = detectProject(dir);
  assert.deepEqual(validateConfig(config), []);
  assert.equal(config.stack.packageManager, 'none');
  assert.deepEqual(config.profiles, ['base']);
  assert.deepEqual(config.stack.languages, ['python']);
  assert.equal(config.commands.install, 'pip install -r requirements.txt');
  assert.deepEqual(config.hooks.preCommit, []);
});

test('detect : branche courante et adaptateurs', () => {
  const dir = copyProject('blank');
  gitInit(dir);
  git(dir, 'switch', '-q', '-c', 'trunk');
  git(dir, 'branch', '-q', '-D', 'main');
  fs.mkdirSync(path.join(dir, '.codex'));
  fs.mkdirSync(path.join(dir, '.cursor'));
  const { config } = detectProject(dir);
  assert.equal(config.git.mainBranch, 'trunk');
  // 'trunk' n'est qu'un repli sur la branche courante (pas de main/master
  // local, pas d'origin/HEAD) : elle ne doit pas devenir protégée pour
  // autant, sous peine de bloquer le pre-push sur la branche de travail.
  assert.deepEqual(config.git.protectedBranches, ['main', 'master']);
  assert.deepEqual(config.adapters, ['claude', 'codex', 'cursor']);
});

test('detect : master local + branche de travail courante sans remote → mainBranch master', () => {
  const dir = copyProject('blank');
  git(dir, 'init', '-q', '-b', 'master');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  git(dir, 'config', 'core.autocrlf', 'false');
  git(dir, 'config', 'commit.gpgsign', 'false');
  commitAll(dir, 'initial');
  git(dir, 'switch', '-q', '-c', 'feature/x');
  const { config } = detectProject(dir);
  assert.equal(config.git.mainBranch, 'master');
  assert.deepEqual(config.git.protectedBranches, ['main', 'master']);
  assert.ok(!config.git.protectedBranches.includes('feature/x'));
});

test('detect : TypeScript sans script typecheck → npx tsc --noEmit proposé', () => {
  const dir = copyProject('ts-no-typecheck');
  const { config } = detectProject(dir);
  assert.equal(config.stack.typescript, true);
  assert.equal(config.commands.typecheck, 'npx tsc --noEmit');
  assert.deepEqual(config.hooks.preCommit, [
    { name: 'typecheck', command: 'npx tsc --noEmit', blocking: true, whenStaged: ['**/*.ts', '**/*.tsx'] },
    {
      name: 'lint',
      command: 'npm run lint',
      blocking: false,
      whenStaged: ['**/*.{js,jsx,mjs,cjs,ts,tsx}'],
    },
  ]);
});

test('detect : mauvais dossier — sous-dossiers candidats (profondeur 1 et 2)', () => {
  const dir = copyProject('parent-no-project');
  assert.equal(isUnrecognizedTarget(dir), true);
  assert.deepEqual(findNearbyProjects(dir), ['apps/tool-a', 'standalone']);
});

test('detect CLI : mauvais dossier + --write → n\'écrit rien, code 1, liste les candidats', () => {
  const dir = copyProject('parent-no-project');
  const res = cli(['detect', dir, '--write']);
  assert.equal(res.status, 1);
  assert.equal(exists(dir, 'acc.config.json'), false);
  assert.match(res.stderr, /ne ressemble à aucun projet reconnu/);
  assert.match(res.stderr, /apps\/tool-a/);
  assert.match(res.stderr, /standalone/);
  assert.ok(res.stderr.includes(STANDARD_COMMAND), 'la commande suggérée doit être exécutable telle quelle');
});

test('detect CLI : mauvais dossier sans --write → avertissement en plus de la proposition', () => {
  const dir = copyProject('parent-no-project');
  const res = cli(['detect', dir]);
  assert.equal(res.status, 0);
  assert.match(res.stderr, /ne ressemble à aucun projet reconnu/);
  assert.equal(JSON.parse(res.stdout).project.name, 'parent-no-project');
});

test('detect CLI : --write écrit, refuse d\'écraser sans --force', () => {
  const dir = copyProject('node-simple');
  const shown = cli(['detect', dir]);
  assert.equal(shown.status, 0);
  assert.equal(JSON.parse(shown.stdout).project.name, 'node-simple');
  assert.equal(exists(dir, 'acc.config.json'), false);
  assert.equal(cli(['detect', dir, '--write']).status, 0);
  assert.equal(JSON.parse(read(dir, 'acc.config.json')).project.slug, 'node-simple');
  const again = cli(['detect', dir, '--write']);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /--force/);
  assert.equal(cli(['detect', dir, '--write', '--force']).status, 0);
});


test('majorVersion : plages usuelles de dépendance', () => {
  assert.equal(majorVersion('16.3.6'), 16);
  assert.equal(majorVersion('^16.0.1'), 16);
  assert.equal(majorVersion('~15.2'), 15);
  assert.equal(majorVersion('>=16'), 16);
  assert.equal(majorVersion('latest'), null);
  assert.equal(majorVersion('workspace:*'), null);
  assert.equal(majorVersion(undefined), null);
});

test('detect : Next.js 16 — typegen, ports du cadriciel et de launch.json, avertissements', () => {
  const dir = copyProject('next-app');
  const { config, warnings } = detectProject(dir);
  assert.deepEqual(validateConfig(config), []);
  assert.equal(config.commands.typecheck, 'npx next typegen && npx tsc --noEmit');
  assert.equal(config.hooks.preCommit[0].command, 'npx next typegen && npx tsc --noEmit');
  // launch.json d'abord (clé = nom en slug), puis port par défaut de Next.
  assert.deepEqual(config.ports, { storybook: 6006, app: 3000 });
  assert.equal(warnings.length, 2, warnings.join('\n'));
  assert.match(warnings[0], /prebuild \(« node scripts\/gen-data\.mjs »\), predev/);
  assert.match(warnings[0], /commands\.typecheck/);
  assert.match(warnings[1], /^Dockerfile détecté/);
  assert.match(warnings[1], /prepare/);
});

test('detect : Next.js 16 avec script typecheck sans typegen → gardé, avertissement', () => {
  const dir = copyProject('next-app');
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.scripts.typecheck = 'tsc --noEmit';
  write(dir, 'package.json', JSON.stringify(pkg));
  const { config, warnings } = detectProject(dir);
  assert.equal(config.commands.typecheck, 'npm run typecheck');
  assert.ok(warnings.some((w) => /next typegen/.test(w) && /tsc --noEmit/.test(w)), warnings.join('\n'));
});

test('detect : Next.js 15 → tsc seul ; port -p du script dev', () => {
  const dir = copyProject('next-app');
  const pkg = JSON.parse(read(dir, 'package.json'));
  pkg.dependencies.next = '^15.5.0';
  pkg.scripts.dev = 'next dev -p 3100';
  write(dir, 'package.json', JSON.stringify(pkg));
  fs.rmSync(path.join(dir, '.claude'), { recursive: true });
  const { config } = detectProject(dir);
  assert.equal(config.commands.typecheck, 'npx tsc --noEmit');
  assert.deepEqual(config.ports, { app: 3100 });
});

test('detect : ports Vite (défaut, --port, pas de doublon avec .env.example)', () => {
  const vite = (dev, env) => {
    const dir = path.join(tmpDir('acc-vite-'), 'vite-app');
    write(dir, 'package.json', JSON.stringify({ name: 'vite-app', scripts: { dev }, devDependencies: { vite: '^7.0.0' } }));
    if (env) write(dir, '.env.example', env);
    return detectProject(dir).config.ports;
  };
  assert.deepEqual(vite('vite'), { app: 5173 });
  assert.deepEqual(vite('vite --port=4000'), { app: 4000 });
  assert.deepEqual(vite('vite', 'WEB_PORT=5173\n'), { web: 5173 }, 'même numéro : pas de clé en double');
  assert.deepEqual(vite('vite', 'PORT=8080\n'), { app: 8080 }, 'la clé venue de .env.example gagne');
});

test('detect : launch.json illisible ignoré, sans erreur', () => {
  const dir = copyProject('next-app');
  write(dir, '.claude/launch.json', '{ pas du json');
  assert.deepEqual(detectProject(dir).config.ports, { app: 3000 });
});
