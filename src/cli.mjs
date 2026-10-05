// Interface en ligne de commande : analyse des arguments, aide, codes de sortie.
import path from 'node:path';
import { applyStandard } from './apply.mjs';
import { CONFIG_FILE, readRawConfig, writeConfig } from './config.mjs';
import { detectProject, findNearbyProjects, isUnrecognizedTarget } from './detect.mjs';
import { formatDoctor, runDoctor } from './doctor.mjs';
import { AccError, stringifyJson } from './fs-utils.mjs';
import { computePlan, formatPlan, planToJson } from './plan.mjs';
import { updateStandard } from './update.mjs';
import { migrationsDir, STANDARD_COMMAND, STANDARD_VERSION, templatesDir } from './version.mjs';

export const HELP = `acc-standard ${STANDARD_VERSION} — architecture agentique standard

Usage (remplacer par « ${STANDARD_COMMAND} » si l'outil n'est pas installé) :
  acc-standard detect [cible] [--write] [--force]
      Analyse le projet et propose ${CONFIG_FILE}.
      --write  écrit la config si elle est absente ; --force la remplace.
  acc-standard plan   [cible] [--json] [--adopt]
      Affiche ce que apply ferait, sans rien écrire.
  acc-standard apply  [cible] [--branch] [--allow-dirty] [--force] [--adopt] [--dry-run]
      Pose le standard. Exige un dépôt git propre (sauf --allow-dirty).
      --branch   crée chore/acc-standard-v${STANDARD_VERSION} avant d'écrire
      --force    remplace les fichiers modifiés localement (sauvegarde .acc-bak)
      --adopt    projet déjà équipé : remplace (sauvegarde .acc-bak) les seuls
                 fichiers jamais repris par le standard, au lieu de .acc-new
      --dry-run  équivaut à plan
  acc-standard doctor [cible] [--json]
      Vérifie l'installation (config, manifeste, dérive, conflits, hooks).
  acc-standard update [cible] [--allow-dirty] [--force] [--adopt]
      Lance les migrations de version puis apply.
  acc-standard --help | --version

Options communes :
  --templates <dossier>   gabarits (défaut : templates/ du paquet, ou ACC_TEMPLATES_DIR)
  --migrations <dossier>  migrations (défaut : migrations/ du paquet, ou ACC_MIGRATIONS_DIR)

Codes de sortie : 0 succès, 1 erreur, 2 terminé avec conflits (ou doctor en échec).
Aucune commande git add, commit ou push n'est jamais lancée.`;

const COMMANDS = {
  detect: ['write', 'force'],
  plan: ['json', 'adopt'],
  apply: ['branch', 'allow-dirty', 'force', 'adopt', 'dry-run'],
  doctor: ['json'],
  update: ['allow-dirty', 'force', 'adopt'],
};
const VALUE_OPTIONS = ['templates', 'migrations'];

/** Analyse argv en { command, target, flags, values }. */
export function parseArgs(argv) {
  const parsed = { command: null, positionals: [], flags: new Set(), values: {} };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') parsed.flags.add('help');
    else if (arg === '-v' || arg === '--version') parsed.flags.add('version');
    else if (arg.startsWith('--')) {
      const [name, inline] = arg.slice(2).split(/=(.*)/s, 2);
      if (VALUE_OPTIONS.includes(name)) {
        const value = inline ?? argv[++i];
        if (!value) throw new AccError(`L'option --${name} attend une valeur.`);
        parsed.values[name] = value;
      } else parsed.flags.add(name);
    } else if (!parsed.command) parsed.command = arg;
    else parsed.positionals.push(arg);
  }
  return parsed;
}

function checkFlags(parsed) {
  const allowed = COMMANDS[parsed.command];
  if (!allowed) throw new AccError(`Commande inconnue : ${parsed.command}\n\n${HELP}`);
  for (const flag of parsed.flags) {
    if (!allowed.includes(flag)) throw new AccError(`Option inconnue pour ${parsed.command} : --${flag}`);
  }
  if (parsed.positionals.length > 1) throw new AccError('Une seule cible est acceptée.');
}

/**
 * Avertissement + candidats quand la cible ne ressemble à aucun projet
 * reconnu ET qu'un vrai projet est trouvé juste à côté (typiquement : la
 * commande a été lancée un dossier trop haut). Un dossier vide sans aucun
 * sous-dossier candidat reste un « projet vierge » ordinaire (profil
 * `base`) : ce n'est pas en soi le signe d'une mauvaise cible.
 */
function unrecognizedTargetWarning(target, nearby) {
  const lines = [
    `${target} ne ressemble à aucun projet reconnu ` +
      '(pas de package.json, pyproject.toml, requirements.txt, go.mod, Cargo.toml, ni dépôt git).',
    'Projet(s) trouvé(s) à proximité :',
  ];
  for (const rel of nearby) lines.push(`  - ${rel} : cd ${rel} && ${STANDARD_COMMAND} detect --write`);
  return lines.join('\n');
}

function runDetect(target, flags, io) {
  const nearby = isUnrecognizedTarget(target) ? findNearbyProjects(target) : [];
  if (nearby.length && flags.has('write')) {
    io.err(unrecognizedTargetWarning(target, nearby));
    return 1;
  }
  const { config, warnings } = detectProject(target);
  for (const w of warnings) io.err(`Attention : ${w}`);
  if (nearby.length) io.err(unrecognizedTargetWarning(target, nearby));
  if (!flags.has('write')) {
    io.out(stringifyJson(config).trimEnd());
    return 0;
  }
  if (readRawConfigSafe(target) !== null && !flags.has('force')) {
    throw new AccError(`${CONFIG_FILE} existe déjà ; relancez avec --force pour le remplacer.`);
  }
  writeConfig(target, config);
  io.out(`${CONFIG_FILE} écrit. Relisez-le, puis lancez : ${STANDARD_COMMAND} plan`);
  return 0;
}

function readRawConfigSafe(target) {
  try {
    return readRawConfig(target);
  } catch {
    return {};
  }
}

async function dispatch(parsed, io, env, cwd) {
  const target = path.resolve(cwd, parsed.positionals[0] ?? '.');
  const flags = parsed.flags;
  const tdir = templatesDir(parsed.values.templates, env);
  switch (parsed.command) {
    case 'detect':
      return runDetect(target, flags, io);
    case 'plan': {
      const plan = computePlan(target, { templatesDir: tdir, adopt: flags.has('adopt') });
      io.out(flags.has('json') ? stringifyJson(planToJson(plan)).trimEnd() : formatPlan(plan));
      return plan.conflicts ? 2 : 0;
    }
    case 'apply': {
      const res = applyStandard(target, {
        templatesDir: tdir,
        allowDirty: flags.has('allow-dirty'),
        force: flags.has('force'),
        adopt: flags.has('adopt'),
        branch: flags.has('branch'),
        dryRun: flags.has('dry-run'),
      });
      io.out(res.output);
      return res.exitCode;
    }
    case 'doctor': {
      const res = runDoctor(target);
      io.out(flags.has('json') ? stringifyJson(res).trimEnd() : formatDoctor(res));
      return res.exitCode;
    }
    case 'update': {
      const res = await updateStandard(target, {
        templatesDir: tdir,
        migrationsDir: migrationsDir(parsed.values.migrations, env),
        allowDirty: flags.has('allow-dirty'),
        force: flags.has('force'),
        adopt: flags.has('adopt'),
      });
      io.out(res.output);
      return res.exitCode;
    }
    default:
      throw new AccError(`Commande inconnue : ${parsed.command}`);
  }
}

/** Point d'entrée ; renvoie le code de sortie. */
export async function main(argv, options = {}) {
  const io = {
    out: options.out ?? ((s) => process.stdout.write(`${s}\n`)),
    err: options.err ?? ((s) => process.stderr.write(`${s}\n`)),
  };
  try {
    const parsed = parseArgs(argv);
    if (parsed.flags.has('version')) {
      io.out(STANDARD_VERSION);
      return 0;
    }
    if (parsed.flags.has('help') || !parsed.command) {
      io.out(HELP);
      return 0;
    }
    checkFlags(parsed);
    return await dispatch(parsed, io, options.env ?? process.env, options.cwd ?? process.cwd());
  } catch (error) {
    if (error instanceof AccError) {
      io.err(`Erreur : ${error.message}`);
      return error.exitCode;
    }
    io.err(`Erreur inattendue : ${error.stack ?? error}`);
    return 1;
  }
}
