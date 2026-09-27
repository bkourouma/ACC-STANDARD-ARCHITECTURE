#!/usr/bin/env node
"use strict";

// Bus de messages entre les processus « développement » et « démo/debug ».
// Un dossier .agent-bus/ partagé par tous les worktrees (voir docs/workflows/
// DEV_PROCESS.md et DEMO_DEBUG_PROCESS.md) sert de canal d'échange pour les
// rapports d'anomalie (bugs/<ID>.md) et le journal des révisions livrées
// (revisions.md). CommonJS, zéro dépendance, Node 20.
//
// Fichier géré par acc-standard : ne pas le modifier localement.
// Le bus est ignoré par git (.gitignore : .agent-bus/) ; AGENT_BUS_DIR permet
// de le placer ailleurs.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const ETATS_VALIDES = [
  "nouveau",
  "en correction",
  "prêt au retest",
  "passé",
  "bloqué",
];

const PRIORITES_VALIDES = ["bloquant", "important", "mineur"];

// --- Localisation du bus -----------------------------------------------

// Trouve le répertoire commun (.git) du dépôt principal : cela permet à un
// worktree (.claude/worktrees/*) et au checkout principal de partager le même
// bus, même quand ils ont des .git différents (fichier gitdir vs dossier).
function gitCommonDir() {
  const result = spawnSync(
    "git",
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  if (result.status !== 0) {
    throw new Error(
      "Impossible de localiser le dépôt Git (git rev-parse a échoué).",
    );
  }
  return result.stdout.trim();
}

function getBusDir() {
  if (process.env.AGENT_BUS_DIR) {
    return path.resolve(process.env.AGENT_BUS_DIR);
  }
  const commonDir = gitCommonDir();
  return path.join(path.dirname(commonDir), ".agent-bus");
}

function bugsDir(busDir) {
  return path.join(busDir, "bugs");
}

function revisionsFile(busDir) {
  return path.join(busDir, "revisions.md");
}

// Crée l'arborescence du bus si nécessaire (idempotent). Appelée
// implicitement par toutes les commandes sauf `path`.
function ensureInit(busDir) {
  fs.mkdirSync(bugsDir(busDir), { recursive: true });
  const revFile = revisionsFile(busDir);
  if (!fs.existsSync(revFile)) {
    fs.writeFileSync(
      revFile,
      "# Journal des révisions\n\nJournal en ajout seul : une entrée par révision livrée par le développement.\n",
      { encoding: "utf8" },
    );
  }
}

// --- Utilitaires d'arguments ---------------------------------------------

// Découpe argv en arguments positionnels et options --nom valeur.
function parseArgs(argv) {
  const positional = [];
  const options = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const name = arg.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith("--")) {
        options[name] = true;
      } else {
        options[name] = next;
        i += 1;
      }
    } else {
      positional.push(arg);
    }
  }
  return { positional, options };
}

function nowIso() {
  return new Date().toISOString();
}

// Date du jour au format AAAA-MM-JJ, en heure locale (pas UTC).
function todayLocal() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function usageError(message) {
  console.error(`Erreur : ${message}`);
  process.exit(1);
}

// --- Commande : path -------------------------------------------------------

function cmdPath() {
  // Ne crée rien : seule commande à ne pas appeler ensureInit.
  console.log(getBusDir());
}

// --- Commande : new-bug -----------------------------------------------------

function buildBugContent(id, opts) {
  const titre = opts.title || "(sans titre)";
  const priorite = opts.priority || "important";
  const lignes = [
    `# ${id} — ${titre}`,
    "",
    `État : nouveau`,
    `Priorité : ${priorite}`,
    `Scénario : ${opts.scenario || ""}`,
    `Branche / révision testée : ${opts.branch || ""}${opts.sha ? ` (${opts.sha})` : ""}`,
    `Instance / URL : ${opts.url || ""}`,
    "Rôle et données de test : ",
    "Préconditions : ",
    "Étapes :",
    "1. ",
    "Attendu : ",
    "Observé : ",
    "Preuve : ",
    "Fréquence : ",
    "Correction annoncée : ",
    "Retest : ",
    "",
    "## Historique",
    `- ${nowIso()} nouveau`,
    "",
  ];
  return lignes.join("\n");
}

// Génère un ID libre du jour et crée le fichier de façon atomique (deux
// agents peuvent tenter la création en même temps : on retente sur EEXIST).
function createBugFile(dir, opts) {
  const jour = todayLocal();
  for (let n = 1; n <= 999; n += 1) {
    const id = `BUG-${jour}-${String(n).padStart(3, "0")}`;
    const filePath = path.join(dir, `${id}.md`);
    try {
      const fd = fs.openSync(filePath, "wx");
      fs.writeSync(fd, buildBugContent(id, opts));
      fs.closeSync(fd);
      return { id, filePath };
    } catch (err) {
      if (err.code === "EEXIST") continue;
      throw err;
    }
  }
  throw new Error("Limite de 999 anomalies atteinte pour aujourd'hui.");
}

function cmdNewBug(busDir, options) {
  if (!options.title) {
    usageError("new-bug requiert --title \"...\"");
  }
  if (options.priority && !PRIORITES_VALIDES.includes(options.priority)) {
    usageError(
      `priorité invalide « ${options.priority} » (attendu : ${PRIORITES_VALIDES.join(" | ")})`,
    );
  }
  const { id, filePath } = createBugFile(bugsDir(busDir), options);
  console.log(id);
  console.log(filePath);
}

// --- Lecture des fichiers de bug ---------------------------------------

function parseBugFile(filePath) {
  const content = fs.readFileSync(filePath, "utf8");
  const titreMatch = content.match(/^# (BUG-\S+) — (.*)$/m);
  const etatMatch = content.match(/^État\s*:\s*(.*)$/m);
  const prioriteMatch = content.match(/^Priorité\s*:\s*(.*)$/m);
  return {
    id: titreMatch ? titreMatch[1] : path.basename(filePath, ".md"),
    titre: titreMatch ? titreMatch[2].trim() : "",
    etat: etatMatch ? etatMatch[1].trim() : "",
    priorite: prioriteMatch ? prioriteMatch[1].trim() : "",
    content,
  };
}

function listBugFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".md"))
    .sort()
    .map((f) => path.join(dir, f));
}

// --- Commande : list ---------------------------------------------------

function cmdList(busDir, options) {
  const bugs = listBugFiles(bugsDir(busDir)).map(parseBugFile);
  const filtres = options.state
    ? bugs.filter((b) => b.etat === options.state)
    : bugs;
  if (filtres.length === 0) {
    console.log("(aucune anomalie)");
    return;
  }
  const largeurId = Math.max(...filtres.map((b) => b.id.length), 2);
  const largeurEtat = Math.max(...filtres.map((b) => b.etat.length), 5);
  const largeurPriorite = Math.max(
    ...filtres.map((b) => b.priorite.length),
    8,
  );
  for (const b of filtres) {
    console.log(
      `${b.id.padEnd(largeurId)} | ${b.etat.padEnd(largeurEtat)} | ${b.priorite.padEnd(largeurPriorite)} | ${b.titre}`,
    );
  }
}

// --- Commande : show -----------------------------------------------------

function findBugFile(busDir, id) {
  const filePath = path.join(bugsDir(busDir), `${id}.md`);
  if (!fs.existsSync(filePath)) return null;
  return filePath;
}

function cmdShow(busDir, positional) {
  const id = positional[0];
  if (!id) usageError("show requiert un ID (ex. BUG-2026-09-27-001)");
  const filePath = findBugFile(busDir, id);
  if (!filePath) usageError(`anomalie inconnue : ${id}`);
  console.log(fs.readFileSync(filePath, "utf8"));
}

// --- Commande : set-state ------------------------------------------------

// Remplace la ligne « État : » et ajoute une ligne d'historique.
function applyStateChange(content, etat, note) {
  const nouveauContenu = content.replace(
    /^État\s*:.*$/m,
    `État : ${etat}`,
  );
  const ligneHistorique = note
    ? `- ${nowIso()} ${etat} — ${note}`
    : `- ${nowIso()} ${etat}`;
  return `${nouveauContenu.trimEnd()}\n${ligneHistorique}\n`;
}

function cmdSetState(busDir, positional, options) {
  const id = positional[0];
  const etat = positional.slice(1).join(" ").trim();
  if (!id || !etat) {
    usageError("set-state requiert <ID> <état> (ex. set-state BUG-... \"prêt au retest\")");
  }
  if (!ETATS_VALIDES.includes(etat)) {
    usageError(`état invalide « ${etat} » (attendu : ${ETATS_VALIDES.join(" | ")})`);
  }
  const filePath = findBugFile(busDir, id);
  if (!filePath) usageError(`anomalie inconnue : ${id}`);
  const content = fs.readFileSync(filePath, "utf8");
  fs.writeFileSync(filePath, applyStateChange(content, etat, options.note));
  console.log(`${id} -> ${etat}`);
}

// --- Commande : revision -------------------------------------------------

function appendRevisionEntry(busDir, options) {
  const lignes = [
    "",
    `## ${nowIso()} — ${options.sha} (${options.branch})`,
    options.url ? `URL : ${options.url}` : null,
    options.fixes ? `Corrige : ${options.fixes}` : null,
    options.note ? `Note : ${options.note}` : null,
  ].filter((l) => l !== null);
  fs.appendFileSync(revisionsFile(busDir), `${lignes.join("\n")}\n`);
}

// Passe chaque anomalie corrigée à « prêt au retest » ; un ID inconnu
// déclenche un avertissement mais ne fait pas échouer la commande.
function marquerCorrections(busDir, fixesCsv, sha) {
  const ids = fixesCsv
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  for (const id of ids) {
    const filePath = findBugFile(busDir, id);
    if (!filePath) {
      console.error(`Avertissement : anomalie inconnue ignorée : ${id}`);
      continue;
    }
    const content = fs.readFileSync(filePath, "utf8");
    fs.writeFileSync(
      filePath,
      applyStateChange(content, "prêt au retest", `correction livrée en ${sha}`),
    );
  }
}

function cmdRevision(busDir, options) {
  if (!options.sha || !options.branch) {
    usageError("revision requiert --sha <sha> --branch <b>");
  }
  appendRevisionEntry(busDir, options);
  if (options.fixes) {
    marquerCorrections(busDir, options.fixes, options.sha);
  }
  console.log(`révision ${options.sha} enregistrée`);
}

// --- Aide -----------------------------------------------------------------

function cmdHelp() {
  console.log(`Usage : node scripts/agent-bus.cjs <commande> [options]

Commandes :
  path                                        affiche le chemin du bus
  init                                        crée l'arborescence du bus
  new-bug --title "..." [--priority ...] [--scenario ...] [--branch ...] [--sha ...] [--url ...]
  list [--state <état>]
  show <ID>
  set-state <ID> <état> [--note "..."]
  revision --sha <sha> --branch <b> [--url <u>] [--fixes ID1,ID2] [--note "..."]
  help

États valides : ${ETATS_VALIDES.join(" | ")}
Priorités valides : ${PRIORITES_VALIDES.join(" | ")}`);
}

// --- Point d'entrée ---------------------------------------------------

function main() {
  const [commande, ...reste] = process.argv.slice(2);
  if (!commande || commande === "help") {
    cmdHelp();
    return;
  }
  if (commande === "path") {
    cmdPath();
    return;
  }

  let busDir;
  try {
    busDir = getBusDir();
    ensureInit(busDir);
  } catch (err) {
    usageError(err.message);
    return;
  }

  const { positional, options } = parseArgs(reste);

  try {
    switch (commande) {
      case "init":
        console.log(busDir);
        break;
      case "new-bug":
        cmdNewBug(busDir, options);
        break;
      case "list":
        cmdList(busDir, options);
        break;
      case "show":
        cmdShow(busDir, positional);
        break;
      case "set-state":
        cmdSetState(busDir, positional, options);
        break;
      case "revision":
        cmdRevision(busDir, options);
        break;
      default:
        usageError(`commande inconnue : ${commande}`);
    }
  } catch (err) {
    usageError(err.message);
  }
}

main();
