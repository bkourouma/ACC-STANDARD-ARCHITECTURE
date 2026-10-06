// Hooks Claude Code livrés (templates/base/files/.claude/hooks) : exécutés pour
// de vrai avec bash, sur les gabarits réels et non sur des maquettes.
import assert from 'node:assert/strict';
import path from 'node:path';
import { test } from 'node:test';
import { BASH, bashInput, commitAll, git, gitInit, ROOT, runHook, tmpDir, write } from './helpers.mjs';

const HOOKS = path.join(ROOT, 'templates', 'base', 'files', '.claude', 'hooks');
const VALIDATE = path.join(HOOKS, 'validate-bash.sh');
const PRE_COMMIT = path.join(HOOKS, 'pre-commit.sh');
const SKIP = BASH ? false : 'bash introuvable (définir ACC_TEST_BASH)';

/** Projet vide, avec ou sans acc.config.json. */
function projectWith(config) {
  const dir = tmpDir('acc-hook-');
  if (config !== undefined) {
    write(dir, 'acc.config.json', typeof config === 'string' ? config : JSON.stringify(config));
  }
  return dir;
}

const validate = (command, project) => runHook(VALIDATE, bashInput(command), { project });

// --- validate-bash.sh -------------------------------------------------------

const REFUSEES = [
  ['git push origin main', /branche protégée/],
  ['git push origin HEAD:master', /branche protégée/],
  ['cd app && git push origin main', /branche protégée/],
  ['git push origin --delete main', /branche protégée/],
  ['git push --force origin feat/x', /--force est bloqué/],
  ['git push -f origin feat/x', /-f est bloqué/],
  ['git push origin +feat/x', /préfixée par \+/],
  ['git stash', /git stash/],
  ['git stash pop', /git stash \(pop\)/],
  ['git commit --no-verify -m x', /--no-verify/],
  ['git commit -n -m x', /git commit -n/],
  ['git push --no-verify origin feat/x', /--no-verify/],
  ['LEFTHOOK=0 git commit -m x', /LEFTHOOK=0/],
  ['git config core.hooksPath /dev/null', /core\.hooksPath/],
  ['git reset --hard HEAD~1', /reset --hard/],
  ['git clean -fd', /git clean -f/],
  ['git checkout -- .', /checkout -- \./],
  ['git restore .', /restore \./],
  ['dropdb prod', /dropdb/],
  ['rm -rf .', /dossier protégé/],
  ['rm -rf node_modules', /dossier protégé/],
  ['rm -fr .git', /dossier protégé/],
  ['Remove-Item -Recurse -Force node_modules', /Remove-Item -Recurse/],
  ['bash -c "git stash"', /git stash/],
];

const AUTORISEES = [
  'git status',
  'git log --oneline -5',
  'git diff --stat',
  'git push origin feat/x',
  'git push --force-with-lease origin feat/x',
  'git stash list',
  'git stash apply',
  'git commit -m "fix: ne plus lancer git stash ni git push -f"',
  'git commit -m wip',
  'rm -rf dist',
  'rm -rf src/generated',
  'grep -n "git reset --hard" docs/notes.md',
  "cat > notes.md <<'EOF'\ngit push origin main\ngit stash\nEOF",
  'npm test',
];

test('validate-bash : commandes destructrices refusées (code 2, raison en français)', { skip: SKIP }, () => {
  const project = projectWith();
  for (const [command, raison] of REFUSEES) {
    const res = validate(command, project);
    assert.equal(res.status, 2, `« ${command} » devrait être refusée`);
    assert.match(res.stderr, raison, command);
  }
});

test('validate-bash : commandes ordinaires autorisées (code 0, rien sur stderr)', { skip: SKIP }, () => {
  const project = projectWith();
  for (const command of AUTORISEES) {
    const res = validate(command, project);
    assert.equal(res.status, 0, `« ${command} » devrait passer : ${res.stderr}`);
    assert.equal(res.stderr, '', command);
  }
});

test('validate-bash : échec ouvert sur entrée vide, illisible ou sans commande', { skip: SKIP }, () => {
  const project = projectWith();
  for (const input of ['', '{', 'pas du json', '{}', '{"tool_input":{}}', '{"tool_input":{"command":42}}']) {
    const res = runHook(VALIDATE, input, { project });
    assert.equal(res.status, 0, `entrée ${JSON.stringify(input)}`);
  }
});

test('validate-bash : la configuration du projet est lue à l\'exécution', { skip: SKIP }, () => {
  const project = projectWith({
    git: { protectedBranches: ['trunk'] },
    guard: {
      protectedPaths: ['src'],
      destructiveCommands: [
        { pattern: '\\bmigrate\\s+reset\\b', reason: 'raison-de-test' },
        { pattern: '(', reason: 'regex invalide, ignorée' },
        { reason: 'sans motif, ignorée' },
      ],
    },
  });
  assert.equal(validate('git push origin trunk', project).status, 2);
  assert.equal(validate('git push origin main', project).status, 0, 'seules les branches configurées sont protégées');
  assert.equal(validate('rm -rf src', project).status, 2);
  assert.equal(validate('rm -rf ./src/', project).status, 2);
  assert.equal(validate('rm -rf dist', project).status, 0);
  const res = validate('outil migrate reset --all', project);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /raison-de-test/);
  assert.equal(validate('git status', project).status, 0, 'une règle invalide ne casse pas le hook');
});

test('validate-bash : configuration absente ou illisible → valeurs par défaut', { skip: SKIP }, () => {
  for (const project of [projectWith(), projectWith('{ pas du json'), projectWith('[]')]) {
    assert.equal(validate('git push origin main', project).status, 2);
    assert.equal(validate('git push origin master', project).status, 2);
    assert.equal(validate('git status', project).status, 0);
  }
});

// Limites connues (docs/CONTRACT.md §8). Chacune est écrite comme le
// comportement ATTENDU, en `todo` : le test échoue sans faire échouer la suite
// tant que la limite existe. Pour en corriger une, retirer son `todo`.
const LIMITES = [
  ['git -C . push origin main', 'git -C <dossier> contourne la détection de « git push »'],
  ['sh -c "git push origin main"', 'le guillemet fermant colle à « main » : la branche n\'est pas reconnue'],
  ['git push --mirror', 'push --mirror écrase toutes les références distantes'],
  ['git branch -D main', 'suppression d\'une branche protégée'],
  ['git push origin "main"', 'texte cité neutralisé (limite acceptée dans le hook)'],
  ['B=main; git push origin $B', 'valeur construite dynamiquement : non corrigeable par regex'],
  ['node -e "require(\'child_process\').execSync(\'git push -f origin main\')"', 'commande lancée depuis un script : non corrigeable par regex'],
];

for (const [command, raison] of LIMITES) {
  test(`validate-bash, limite connue : « ${command} » devrait être refusée`, { skip: SKIP, todo: raison }, () => {
    assert.equal(validate(command, projectWith()).status, 2);
  });
}

// --- pre-commit.sh ----------------------------------------------------------

/** Dépôt avec acc.config.json (contrôles preCommit) et des fichiers indexés. */
function commitProject(checks, staged = { 'a.md': 'x\n' }) {
  const dir = tmpDir('acc-precommit-');
  write(dir, 'fail.cjs', "console.log('boom-sortie'); process.exit(1);\n");
  write(dir, 'ok.cjs', 'process.exit(0);\n');
  if (checks !== undefined) write(dir, 'acc.config.json', JSON.stringify({ hooks: { preCommit: checks } }));
  gitInit(dir);
  for (const [file, content] of Object.entries(staged)) {
    write(dir, file, content);
    git(dir, 'add', file);
  }
  return dir;
}

const precommit = (dir, command = 'git commit -m message') => runHook(PRE_COMMIT, bashInput(command), { cwd: dir });

test('pre-commit : contrôle bloquant en échec → code 2 avec la sortie du contrôle', { skip: SKIP }, () => {
  const dir = commitProject([{ name: 'lint', command: 'node fail.cjs', blocking: true }]);
  const res = precommit(dir);
  assert.equal(res.status, 2);
  assert.match(res.stderr, /Contrôle avant commit « lint »/);
  assert.match(res.stderr, /boom-sortie/);
});

test('pre-commit : blocking par défaut, y compris pour git -C et message cité', { skip: SKIP }, () => {
  const dir = commitProject([{ name: 'lint', command: 'node fail.cjs' }]);
  assert.equal(precommit(dir).status, 2);
  assert.equal(precommit(dir, 'git -C . commit -m message').status, 2);
  assert.equal(precommit(dir, 'git add -A && git commit -m "x"').status, 2);
});

test('pre-commit : contrôle non bloquant en échec → code 0 et avertissement JSON', { skip: SKIP }, () => {
  const dir = commitProject([{ name: 'lint', command: 'node fail.cjs', blocking: false }]);
  const res = precommit(dir);
  assert.equal(res.status, 0);
  const out = JSON.parse(res.stdout);
  assert.match(out.systemMessage, /non bloquant/);
  assert.match(out.systemMessage, /boom-sortie/);
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
});

test('pre-commit : contrôle réussi → code 0, silencieux', { skip: SKIP }, () => {
  const dir = commitProject([{ name: 'ok', command: 'node ok.cjs' }]);
  const res = precommit(dir);
  assert.equal(res.status, 0);
  assert.equal(res.stdout, '');
  assert.equal(res.stderr, '');
});

test('pre-commit : whenStaged ne lance le contrôle que si un fichier indexé correspond', { skip: SKIP }, () => {
  const check = (whenStaged) => [{ name: 'lint', command: 'node fail.cjs', whenStaged }];
  const dir = commitProject(check(['**/*.ts']), { 'a.md': 'x\n' });
  assert.equal(precommit(dir).status, 0, 'aucun .ts indexé');

  const ts = commitProject(check(['**/*.ts']), { 'src/deep/a.ts': 'x\n' });
  assert.equal(precommit(ts).status, 2, '**/*.ts doit viser un sous-dossier profond');

  const braces = commitProject(check(['*.{ts,md}']), { 'docs/a.md': 'x\n' });
  assert.equal(precommit(braces).status, 2, 'motif sans / : nom de fichier, accolades');

  const scoped = commitProject(check(['packages/**/*.ts']), { 'src/a.ts': 'x\n' });
  assert.equal(precommit(scoped).status, 0, 'motif avec / : chemin complet');

  const always = commitProject(check([]), { 'a.md': 'x\n' });
  assert.equal(precommit(always).status, 2, 'whenStaged vide : toujours');
});

test('pre-commit : ne fait rien hors git commit, sans fichier indexé ou sans configuration', { skip: SKIP }, () => {
  const dir = commitProject([{ name: 'lint', command: 'node fail.cjs' }]);
  for (const command of ['git status', 'git log', 'npm test', 'echo "git commit"', 'grep "git commit" README.md']) {
    assert.equal(precommit(dir, command).status, 0, command);
  }

  const nothingStaged = commitProject([{ name: 'lint', command: 'node fail.cjs' }], {});
  assert.equal(precommit(nothingStaged).status, 0);

  const noConfig = commitProject(undefined);
  assert.equal(precommit(noConfig).status, 0);

  const broken = commitProject([]);
  write(broken, 'acc.config.json', '{ pas du json');
  assert.equal(precommit(broken).status, 0);

  assert.equal(runHook(PRE_COMMIT, '{', { cwd: dir }).status, 0, 'entrée illisible : échec ouvert');
});

test('pre-commit : ne modifie ni l\'index ni l\'arbre de travail', { skip: SKIP }, () => {
  const dir = commitProject([{ name: 'ok', command: 'node ok.cjs' }]);
  const before = git(dir, 'status', '--porcelain');
  precommit(dir);
  assert.equal(git(dir, 'status', '--porcelain'), before);
  commitAll(dir, 'fin');
});
