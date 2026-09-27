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

/** Vrai si une branche locale <name> existe (refs/heads/<name>). */
function localBranchExists(cwd, name) {
  return runGit(['show-ref', '--verify', '--quiet', `refs/heads/${name}`], cwd).ok;
}

/**
 * Branche principale : `refs/remotes/origin/HEAD`, sinon une branche locale
 * `main`, sinon `master`, sinon la branche courante, sinon `main`.
 *
 * `source` distingue une origine fiable (`origin`, ou un `main`/`master`
 * local réellement présent) d'un simple repli sur la branche courante ou sur
 * la valeur par défaut : seule une origine fiable justifie d'ajouter le nom
 * obtenu à `protectedBranches` (voir detect.mjs), pour ne jamais protéger par
 * défaut la branche de travail sur laquelle `detect` est lancé.
 */
export function detectMainBranch(cwd) {
  const remote = runGit(['symbolic-ref', '--quiet', 'refs/remotes/origin/HEAD'], cwd);
  if (remote.ok && remote.stdout) {
    return { name: remote.stdout.replace(/^refs\/remotes\/origin\//, ''), source: 'origin' };
  }
  if (localBranchExists(cwd, 'main')) return { name: 'main', source: 'local-main' };
  if (localBranchExists(cwd, 'master')) return { name: 'master', source: 'local-master' };
  if (!isGitRepo(cwd)) return { name: 'main', source: 'default' };
  const current = runGit(['symbolic-ref', '--quiet', '--short', 'HEAD'], cwd);
  if (current.ok && current.stdout) return { name: current.stdout, source: 'current' };
  return { name: 'main', source: 'default' };
}

/** Crée et bascule sur une nouvelle branche (`git switch -c`). */
export function switchCreate(branch, cwd) {
  return runGit(['switch', '-c', branch], cwd);
}
