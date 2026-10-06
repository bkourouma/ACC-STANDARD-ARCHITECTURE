// Application du plan : écriture des fichiers et du manifeste.
// N'exécute jamais git add, commit ou push.
import fs from 'node:fs';
import path from 'node:path';
import { AccError, backupFile, toPosix, writeFileAtomic } from './fs-utils.mjs';
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

/** Exécute les écritures d'un élément du plan ; renvoie la sauvegarde créée, s'il y en a une. */
function executeItem(item) {
  const backup = item.backup ? backupFile(item.abs) : null;
  for (const write of item.writes) {
    writeFileAtomic(write.abs, write.content);
    if (item.executable && write.abs === item.abs && process.platform !== 'win32') {
      fs.chmodSync(write.abs, 0o755);
    }
  }
  return backup;
}

/**
 * Applique le standard sur la cible.
 * @returns {{ plan, branch, manifestWritten, exitCode, output }}
 */
export function applyStandard(target, options) {
  const { templatesDir, allowDirty = false, force = false, adopt = false, branch = false, dryRun = false } = options;
  if (dryRun) {
    const plan = computePlan(target, { templatesDir, force, adopt });
    return { plan, exitCode: plan.conflicts ? 2 : 0, output: formatPlan(plan) };
  }
  assertCleanRepo(target, allowDirty);
  // Calcul avant toute écriture : une erreur de gabarit n'écrit rien.
  let plan = computePlan(target, { templatesDir, force, adopt });
  const createdBranch = branch ? createBranch(target) : null;
  if (createdBranch) plan = computePlan(target, { templatesDir, force, adopt });
  const backups = plan.items
    .map(executeItem)
    .filter(Boolean)
    .map((file) => toPosix(path.relative(target, file)));
  const files = Object.fromEntries(plan.items.map((i) => [i.dest, i.entry]));
  const manifestWritten = writeManifest(target, files, plan.manifest);
  return {
    plan,
    branch: createdBranch,
    manifestWritten,
    backups,
    exitCode: plan.conflicts ? 2 : 0,
    output: formatApplyReport(plan, createdBranch, manifestWritten, backups),
  };
}

function formatApplyReport(plan, branch, manifestWritten, backups) {
  const lines = [];
  if (branch) lines.push(`Branche créée : ${branch}`, '');
  lines.push(formatPlan(plan), '');
  if (backups.length) lines.push('Sauvegardes créées :', ...backups.map((b) => `  - ${b}`), '');
  lines.push(manifestWritten ? `Manifeste écrit : ${MANIFEST_FILE}` : 'Manifeste inchangé.');
  if (plan.conflicts) {
    lines.push(
      '',
      `${plan.conflicts} conflit(s) : comparez chaque fichier avec son .acc-new, reportez ce qui doit l'être,`,
      'supprimez le .acc-new, puis relancez apply (ou --force pour remplacer avec sauvegarde .acc-bak ;',
      '--adopt pour un projet déjà équipé : seuls les fichiers jamais repris par le standard sont remplacés).',
    );
  }
  if (plan.adopted.length) {
    lines.push(
      '',
      `${plan.adopted.length} fichier(s) adopté(s) : version du standard posée, version locale sauvegardée (voir « Sauvegardes créées »).`,
      "Relisez git diff et reportez ce qui doit l'être (fichiers seed, hors blocs) ou proposez-le au standard.",
    );
  }
  if (plan.skeletons.length) {
    lines.push(
      '',
      'Squelette(s) des fichiers déjà présents (sections hors blocs non posées) :',
      ...plan.skeletons.map((s) => `  - ${s}`),
      '/acc-adapt y reprend les sections absentes (TODO(acc-adapt)) puis les supprime.',
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
