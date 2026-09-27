// Appels git en lecture, plus la création de branche (seule écriture permise).
import { spawnSync } from 'node:child_process';

/** Lance git sans shell ; renvoie { ok, stdout, stderr }. */
export function runGit(args, cwd) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8', windowsHide: true });
  if (result.error) return { ok: false, stdout: '', stderr: String(result.error.message) };
  return {
    ok: result.status === 0,
    stdout: (result.stdout ?? '').trim(),
    stderr: (result.stderr ?? '').trim(),
  };
}

export function isGitRepo(cwd) {
  const res = runGit(['rev-parse', '--is-inside-work-tree'], cwd);
  return res.ok && res.stdout === 'true';
}

/** Lignes de `git status --porcelain` (vide = dépôt propre). */
export function statusPorcelain(cwd) {
  const res = runGit(['status', '--porcelain'], cwd);
  if (!res.ok) return null;
  return res.stdout ? res.stdout.split('\n') : [];
}

/** Dossier .git effectif (gère les worktrees). */
export function gitDir(cwd) {
  const res = runGit(['rev-parse', '--git-common-dir'], cwd);
  return res.ok ? res.stdout : null;
}

/** Branche principale : origin/HEAD, sinon branche courante, sinon main. */
export function detectMainBranch(cwd) {
  const remote = runGit(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], cwd);
  if (remote.ok && remote.stdout) return remote.stdout.replace(/^refs\/remotes\/origin\//, '');
  if (!isGitRepo(cwd)) return 'main';
  const current = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
  if (current.ok && current.stdout) return current.stdout;
  return 'main';
}

/** Crée et bascule sur une nouvelle branche (`git switch -c`). */
export function switchCreate(branch, cwd) {
  return runGit(['switch', '-c', branch], cwd);
}
