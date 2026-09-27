// Application du plan : écriture des fichiers et du manifeste.
// N'exécute jamais git add, commit ou push.
import fs from 'node:fs';
import { AccError, writeFileAtomic } from './fs-utils.mjs';
import { isGitRepo, statusPorcelain, switchCreate } from './git.mjs';
import { MANIFEST_FILE, writeManifest } from './manifest.mjs';
import { computePlan, formatPlan } from './plan.mjs';
import { STANDARD_VERSION } from './version.mjs';

/** Refuse un dépôt absent ou sale, sauf si allowDirty. */
export function assertCleanRepo(target, allowDirty) {
  if (allowDirty) return;
  if (!isGitRepo(target)) {
    throw new AccError(`${target} n'est pas un dépôt git. Initialisez-le ou relancez avec --allow-dirty.`);
  }
  const status = statusPorcelain(target);
  if (status === null || status.length > 0) {
    throw new AccError(
      'Le dépôt contient des modifications non commitées. ' +
        'Commitez-les (ou relancez avec --allow-dirty) avant d\'appliquer le standard.',
    );
  }
}

function createBranch(target) {
  const branch = `chore/acc-standard-v${STANDARD_VERSION}`;
  if (!isGitRepo(target)) throw new AccError('--branch exige un dépôt git.');
  const res = switchCreate(branch, target);
  if (!res.ok) throw new AccError(`Impossible de créer la branche ${branch} : ${res.stderr}`);
  return branch;
}

/** Exécute les écritures d'un élément du plan. */
function executeItem(item) {
  if (item.backup) fs.copyFileSync(item.abs, `${item.abs}.acc-bak`);
  for (const write of item.writes) {
    writeFileAtomic(write.abs, write.content);
    if (item.executable && write.abs === item.abs && process.platform !== 'win32') {
      fs.chmodSync(write.abs, 0o755);
    }
  }
}

/**
 * Applique le standard sur la cible.
 * @returns {{ plan, branch, manifestWritten, exitCode, output }}
 */
export function applyStandard(target, options) {
  const { templatesDir, allowDirty = false, force = false, branch = false, dryRun = false } = options;
  if (dryRun) {
    const plan = computePlan(target, { templatesDir, force });
    return { plan, exitCode: plan.conflicts ? 2 : 0, output: formatPlan(plan) };
  }
  assertCleanRepo(target, allowDirty);
  // Calcul avant toute écriture : une erreur de gabarit n'écrit rien.
  let plan = computePlan(target, { templatesDir, force });
  const createdBranch = branch ? createBranch(target) : null;
  if (createdBranch) plan = computePlan(target, { templatesDir, force });
  for (const item of plan.items) executeItem(item);
  const files = Object.fromEntries(plan.items.map((i) => [i.dest, i.entry]));
  const manifestWritten = writeManifest(target, files, plan.manifest);
  return {
    plan,
    branch: createdBranch,
    manifestWritten,
    exitCode: plan.conflicts ? 2 : 0,
    output: formatApplyReport(plan, createdBranch, manifestWritten),
  };
}

function formatApplyReport(plan, branch, manifestWritten) {
  const lines = [];
  if (branch) lines.push(`Branche créée : ${branch}`, '');
  lines.push(formatPlan(plan), '');
  lines.push(manifestWritten ? `Manifeste écrit : ${MANIFEST_FILE}` : 'Manifeste inchangé.');
  if (plan.conflicts) {
    lines.push(
      '',
      `${plan.conflicts} conflit(s) : comparez chaque fichier avec son .acc-new, reportez ce qui doit l'être,`,
      'supprimez le .acc-new, puis relancez apply (ou --force pour remplacer avec sauvegarde .acc-bak).',
    );
  }
  if (plan.nextSteps.length) {
    lines.push('', 'Étapes suivantes :', ...plan.nextSteps.map((s) => `  - ${s}`));
  }
  lines.push(
    '',
    'Commit suggéré (non exécuté) :',
    `  git add -A && git commit -m "chore: architecture agentique acc-standard v${STANDARD_VERSION}"`,
  );
  return lines.join('\n');
}
