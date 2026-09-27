import assert from 'node:assert/strict';
import { test } from 'node:test';
import { validateConfig } from '../src/config.mjs';
import { detectProject } from '../src/detect.mjs';
import { STANDARD_VERSION } from '../src/version.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { cli, copyProject, exists, git, gitInit, read } from './helpers.mjs';

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
    { name: 'lint', command: 'npm run lint', blocking: false, whenStaged: [] },
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
  assert.deepEqual(config.git.protectedBranches, ['trunk', 'main', 'master']);
  assert.deepEqual(config.adapters, ['claude', 'codex', 'cursor']);
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

