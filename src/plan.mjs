// Calcul et affichage du plan : ce que apply ferait, fichier par fichier.
import { loadConfig } from './config.mjs';
import { readTextIfExists } from './fs-utils.mjs';
import { manifestEntry, readManifest, retiredEntries } from './manifest.mjs';
import { planBlock } from './modes/block.mjs';
import { planManaged } from './modes/managed.mjs';
import { planMergeJson } from './modes/merge-json.mjs';
import { planMergeLines } from './modes/merge-lines.mjs';
import { planSeed } from './modes/seed.mjs';
import { buildFileList, collectNextSteps, resolveProfiles, selectedProfileIds } from './profiles.mjs';
import { SOURCE_COMMIT, STANDARD_VERSION } from './version.mjs';

const PLANNERS = {
  managed: planManaged,
  block: planBlock,
  seed: planSeed,
  'merge-json': planMergeJson,
  'merge-lines': planMergeLines,
};

export const ACTION_LABELS = {
  '+': 'à créer',
  '~': 'à mettre à jour',
  '=': 'inchangé(s)',
  '·': 'seed présent(s)',
  '»': 'fusion(s)',
  '!': 'conflit(s)',
};

/** Contexte du moteur de gabarit : config + standard.{version,sourceCommit}. */
export function renderContext(config) {
  return { ...config, standard: { version: STANDARD_VERSION, sourceCommit: SOURCE_COMMIT } };
}

/**
 * Calcule le plan complet.
 * `retired` : section du même nom du manifeste à écrire (contrat §6).
 * @returns {{ target, config, profiles, items, totals, conflicts, skeletons, adopted, nextSteps, manifest, retired }}
 */
export function computePlan(target, { templatesDir, force = false, adopt = false, config: given } = {}) {
  const config = given ?? loadConfig(target);
  const manifest = readManifest(target);
  const profiles = resolveProfiles(templatesDir, selectedProfileIds(config));
  const files = buildFileList(profiles, renderContext(config), target);
  const items = files.map((item) => {
    const current = readTextIfExists(item.abs);
    // Un fichier de nouveau livré retrouve sa trace dans retired : déjà repris.
    const entry = manifestEntry(manifest, item.dest);
    const result = PLANNERS[item.mode](item, { current, entry, force, adopt, target });
    return { ...item, ...result };
  });
  const totals = Object.fromEntries(Object.keys(ACTION_LABELS).map((a) => [a, 0]));
  for (const item of items) totals[item.action] += 1;
  return {
    target,
    config,
    profiles: profiles.map((p) => p.id),
    items,
    totals,
    conflicts: totals['!'],
    skeletons: items.filter((i) => i.skeleton).map((i) => i.skeleton),
    adopted: items.filter((i) => i.adopted).map((i) => i.dest),
    nextSteps: collectNextSteps(profiles),
    manifest,
    retired: retiredEntries(target, manifest, new Set(items.map((i) => i.dest))),
  };
}

/** Plan au format texte, colonnes alignées. */
export function formatPlan(plan) {
  const lines = [
    `acc-standard ${STANDARD_VERSION} — ${plan.config.project.name} (${plan.target})`,
    `Profils : ${plan.profiles.join(', ')}`,
    '',
  ];
  const modeWidth = Math.max(0, ...plan.items.map((i) => i.mode.length));
  const destWidth = Math.max(0, ...plan.items.map((i) => i.dest.length));
  const profileWidth = Math.max(0, ...plan.items.map((i) => i.profiles.join('+').length));
  for (const item of plan.items) {
    const cols = [
      `  ${item.action}`,
      item.mode.padEnd(modeWidth),
      item.dest.padEnd(destWidth),
      item.profiles.join('+').padEnd(profileWidth),
    ];
    if (item.detail) cols.push(item.detail);
    lines.push(cols.join('  ').trimEnd());
  }
  lines.push('', formatTotals(plan.totals));
  return lines.join('\n');
}

export function formatTotals(totals) {
  const parts = Object.entries(ACTION_LABELS).map(([action, label]) => `${totals[action]} ${label}`);
  return `Total : ${parts.join(' · ')}`;
}

/** Plan au format JSON (sans contenus). */
export function planToJson(plan) {
  return {
    standardVersion: STANDARD_VERSION,
    target: plan.target,
    profiles: plan.profiles,
    items: plan.items.map((i) => ({
      action: i.action,
      mode: i.mode,
      dest: i.dest,
      profiles: i.profiles,
      ...(i.detail ? { detail: i.detail } : {}),
    })),
    totals: plan.totals,
    conflicts: plan.conflicts,
  };
}
