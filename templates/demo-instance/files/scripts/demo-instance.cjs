#!/usr/bin/env node
/**
 * Instance de démo figée sur une révision précise.
 *
 * Un worktree git détaché (par défaut `<racine>/.claude/worktrees/demo`) est
 * posé sur la révision demandée ; la recette y teste une version stable
 * pendant que le développement continue dans le checkout principal, qui n'est
 * jamais modifié.
 *
 *   node scripts/demo-instance.cjs sync <ref> [--migrate] [--install]
 *   node scripts/demo-instance.cjs status
 *
 * Fichier géré par acc-standard. Tout ce qui est propre au projet se lit à
 * l'exécution dans la clé `demo` d'acc.config.json (racine du checkout
 * principal). Toutes les clés sont facultatives :
 *
 *   "demo": {
 *     "worktree": ".claude/worktrees/demo",
 *         // dossier du worktree, relatif à la racine du checkout principal
 *     "links": ["node_modules"],
 *         // dossiers liés (jonction sous Windows, lien symbolique ailleurs)
 *         // vers ceux du checkout principal, pour éviter une installation
 *     "install": "npm ci",
 *         // avec --install : liens retirés (le lien seul, jamais sa cible),
 *         // puis cette commande lancée dans le worktree (dépendances propres)
 *     "copyFiles": [{ "from": "config/demo.env", "to": "config/.env" }],
 *         // fichiers copiés du checkout principal vers le worktree à chaque
 *         // sync (configuration de démo) ; leur contenu n'est jamais affiché
 *     "distinctValues": [{ "demo": "config/demo.env", "dev": "config/.env",
 *                          "variable": "DATABASE_URL" }],
 *         // garde : refuse la synchronisation si la variable a la même valeur
 *         // dans les deux fichiers (la démo exige une base dédiée)
 *     "prepare": ["npm run build"],
 *         // commandes lancées dans le worktree à chaque sync
 *     "migrate": "npm run db:migrate:deploy",
 *         // avec --migrate : commande lancée dans le worktree (migrations
 *         // non destructrices sur la base de démo)
 *     "health": [{ "name": "web", "url": "http://localhost:3300" }],
 *         // URL sondées par `status`
 *     "startHint": "Démarrer les services de démo depuis le worktree."
 *         // rappel affiché à la fin de `sync`
 *   }
 *
 * Les commandes sont lancées par le shell du système, depuis la racine du
 * worktree. Aucune valeur de fichier de configuration n'est jamais affichée.
 * CommonJS, zéro dépendance, Node 20.
 */
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const https = require("node:https");
const { execFileSync, spawnSync } = require("node:child_process");

const HTTP_TIMEOUT_MS = 2000;
const DEFAULT_WORKTREE = ".claude/worktrees/demo";
const MODE_INSTALL = "install";
const MODE_LINKS = "links";

class DemoError extends Error {}

// --- Git ------------------------------------------------------------------

function git(args, cwd) {
  return execFileSync("git", args, {
    cwd,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function tryGit(args, cwd) {
  try {
    return git(args, cwd);
  } catch {
    return null;
  }
}

/** Racine du checkout principal, même lancé depuis un worktree. */
function projectRoot() {
  const commonDir = tryGit(
    ["rev-parse", "--path-format=absolute", "--git-common-dir"],
    process.cwd(),
  );
  if (!commonDir) throw new DemoError("Pas de dépôt git ici.");
  return path.dirname(path.resolve(commonDir));
}

// --- Configuration --------------------------------------------------------

function isObject(v) {
  return v !== null && typeof v === "object" && !Array.isArray(v);
}

function strings(v) {
  return Array.isArray(v)
    ? v.filter((s) => typeof s === "string" && s.trim() !== "")
    : [];
}

function objects(v) {
  return Array.isArray(v) ? v.filter(isObject) : [];
}

function text(v) {
  return typeof v === "string" ? v.trim() : "";
}

/** Chemin relatif sûr : pas absolu, pas de remontée hors de la racine. */
function safeRelative(rel, label) {
  const normalized = path.normalize(rel);
  if (path.isAbsolute(normalized) || normalized.split(path.sep).includes("..")) {
    throw new DemoError(`${label} doit être un chemin relatif sans « .. » : ${rel}`);
  }
  return normalized;
}

function loadDemoConfig(root) {
  let config = {};
  try {
    config = JSON.parse(
      fs.readFileSync(path.join(root, "acc.config.json"), "utf8"),
    );
  } catch {
    config = {};
  }
  const demo = isObject(config.demo) ? config.demo : {};
  return {
    worktree: safeRelative(text(demo.worktree) || DEFAULT_WORKTREE, "demo.worktree"),
    links: strings(demo.links).map((p) => safeRelative(p, "demo.links")),
    install: text(demo.install),
    copyFiles: objects(demo.copyFiles)
      .filter((f) => text(f.from) && text(f.to))
      .map((f) => ({
        from: safeRelative(text(f.from), "demo.copyFiles.from"),
        to: safeRelative(text(f.to), "demo.copyFiles.to"),
      })),
    distinctValues: objects(demo.distinctValues).filter(
      (d) => text(d.demo) && text(d.dev) && text(d.variable),
    ),
    prepare: strings(demo.prepare),
    migrate: text(demo.migrate),
    health: objects(demo.health).filter((h) => text(h.url)),
    startHint: text(demo.startHint),
  };
}

// --- Worktree -------------------------------------------------------------

function worktreeExists(wt) {
  return fs.existsSync(path.join(wt, ".git"));
}

function resolveSha(ref, root) {
  const sha = tryGit(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], root);
  if (!sha) throw new DemoError(`Référence introuvable ou pas un commit : ${ref}`);
  return sha;
}

/** Entrées de `git status` hors chemins posés par ce script (liens, copies). */
function dirtyEntries(wt, cfg) {
  const tolerated = new Set(
    [...cfg.links, ...cfg.copyFiles.map((f) => f.to)].map((p) =>
      p.split(path.sep).join("/"),
    ),
  );
  const out = git(["status", "--porcelain", "--untracked-files=all"], wt);
  return out
    .split("\n")
    .filter(Boolean)
    .filter((line) => {
      const file = line.slice(3).replace(/\/$/, "").replace(/^"|"$/g, "");
      return !tolerated.has(file);
    });
}

function checkoutWorktree(root, wt, sha, cfg) {
  if (!worktreeExists(wt)) {
    console.log(`Création du worktree démo : ${wt}`);
    git(["worktree", "add", "--detach", wt, sha], root);
    return;
  }
  const dirty = dirtyEntries(wt, cfg);
  if (dirty.length > 0) {
    throw new DemoError(
      `Le worktree démo contient des modifications, synchronisation refusée :\n  ${dirty.join("\n  ")}\n` +
        `Nettoyer ${wt} à la main avant de relancer.`,
    );
  }
  git(["checkout", "--detach", sha], wt);
}

// --- Liens vers les dépendances du checkout principal ---------------------

function isLink(p) {
  try {
    return fs.lstatSync(p).isSymbolicLink();
  } catch {
    return false;
  }
}

function isRealDir(p) {
  try {
    const st = fs.lstatSync(p);
    return st.isDirectory() && !st.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Retire un lien sans jamais parcourir ni vider sa cible. */
function removeLinkOnly(link) {
  if (!isLink(link)) throw new DemoError(`Pas un lien, retrait refusé : ${link}`);
  try {
    fs.unlinkSync(link);
  } catch {
    fs.rmdirSync(link);
  }
}

function ensureLinks(root, wt, cfg) {
  for (const rel of cfg.links) {
    const target = path.join(root, rel);
    const link = path.join(wt, rel);
    if (isRealDir(link)) {
      console.log(`${rel} est un vrai dossier (dépendances propres) : aucun lien posé.`);
      continue;
    }
    if (!fs.existsSync(target) || isLink(link)) continue;
    fs.mkdirSync(path.dirname(link), { recursive: true });
    fs.symlinkSync(target, link, process.platform === "win32" ? "junction" : "dir");
    console.log(`Lien posé : ${rel}`);
  }
}

function runShell(command, cwd, label) {
  console.log(`> ${command}`);
  const result = spawnSync(command, { cwd, stdio: "inherit", shell: true });
  if (result.status !== 0) throw new DemoError(`${label} a échoué (${command}).`);
}

function installOwnDependencies(wt, cfg) {
  if (!cfg.install) {
    throw new DemoError("--install demandé mais demo.install est vide dans acc.config.json.");
  }
  for (const rel of cfg.links) {
    const link = path.join(wt, rel);
    if (isLink(link)) {
      removeLinkOnly(link);
      console.log(`Lien retiré (cible intacte) : ${rel}`);
    }
  }
  runShell(cfg.install, wt, "Installation des dépendances de la démo");
}

// --- Fichiers de configuration -------------------------------------------

/** Lit une variable d'un fichier KEY=VALUE sans jamais l'afficher. */
function readVar(file, name) {
  if (!fs.existsSync(file)) return null;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/);
  for (const raw of lines) {
    const line = raw.trim().replace(/^export\s+/, "");
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0 || line.slice(0, eq).trim() !== name) continue;
    let value = line.slice(eq + 1).trim();
    const quoted = /^(['"])(.*)\1$/.exec(value);
    value = quoted ? quoted[2] : value.replace(/\s+#.*$/, "");
    return value;
  }
  return null;
}

function checkDistinctValues(root, cfg) {
  for (const rule of cfg.distinctValues) {
    const demoFile = path.join(root, safeRelative(rule.demo, "demo.distinctValues.demo"));
    const devFile = path.join(root, safeRelative(rule.dev, "demo.distinctValues.dev"));
    if (!fs.existsSync(demoFile)) {
      throw new DemoError(
        `Fichier ${rule.demo} absent : le créer (à la main) avec une valeur de ${rule.variable} dédiée à la démo.`,
      );
    }
    const demoValue = readVar(demoFile, rule.variable);
    if (!demoValue) throw new DemoError(`${rule.variable} manquant dans ${rule.demo}.`);
    const devValue = readVar(devFile, rule.variable);
    if (devValue && devValue === demoValue) {
      throw new DemoError(
        `${rule.demo} et ${rule.dev} ont la même valeur de ${rule.variable} : la démo exige une ressource dédiée.`,
      );
    }
  }
}

function copyFiles(root, wt, cfg) {
  for (const f of cfg.copyFiles) {
    const source = path.join(root, f.from);
    if (!fs.existsSync(source)) {
      console.log(`${f.from} absent du checkout principal : non copié.`);
      continue;
    }
    const dest = path.join(wt, f.to);
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(source, dest);
    console.log(`${f.from} copié vers le worktree démo (${f.to}).`);
  }
}

// --- Révision et mode enregistrés (dans le dossier git du worktree) ------

function stateFile(wt, name) {
  const gitDir = git(["rev-parse", "--path-format=absolute", "--git-dir"], wt);
  return path.join(gitDir, name);
}

function writeState(wt, name, value) {
  fs.writeFileSync(stateFile(wt, name), `${value}\n`);
}

function readState(wt, name) {
  try {
    return fs.readFileSync(stateFile(wt, name), "utf8").trim() || null;
  } catch {
    return null;
  }
}

function describeMode(wt, cfg) {
  const mode = readState(wt, "demo-mode");
  if (mode === MODE_INSTALL) return "dépendances propres";
  if (mode === MODE_LINKS) return cfg.links.length ? "liens (partagé)" : "aucun lien configuré";
  return "inconnu";
}

// --- Commandes ------------------------------------------------------------

function sync(ref, options) {
  if (!ref) throw new DemoError("Usage : sync <ref> [--migrate] [--install]");
  const root = projectRoot();
  const cfg = loadDemoConfig(root);
  const wt = path.join(root, cfg.worktree);
  const sha = resolveSha(ref, root);

  // Contrôler la ressource dédiée avant tout travail long.
  checkDistinctValues(root, cfg);
  checkoutWorktree(root, wt, sha, cfg);

  if (options.install) {
    installOwnDependencies(wt, cfg);
    writeState(wt, "demo-mode", MODE_INSTALL);
  } else {
    ensureLinks(root, wt, cfg);
    if (readState(wt, "demo-mode") !== MODE_INSTALL) writeState(wt, "demo-mode", MODE_LINKS);
  }

  copyFiles(root, wt, cfg);
  for (const command of cfg.prepare) runShell(command, wt, "Préparation");
  if (options.migrate) {
    if (!cfg.migrate) throw new DemoError("--migrate demandé mais demo.migrate est vide dans acc.config.json.");
    runShell(cfg.migrate, wt, "Migration de la démo");
  }
  writeState(wt, "demo-revision", sha);

  console.log(`\nWorktree démo sur ${sha} (${wt}).`);
  console.log(cfg.startHint || "(Re)démarrer les services de démo depuis ce worktree pour servir cette révision.");
}

function probe(url) {
  return new Promise((resolve) => {
    const client = url.startsWith("https:") ? https : http;
    let req;
    try {
      req = client.get(url, { timeout: HTTP_TIMEOUT_MS }, (res) => {
        res.resume();
        resolve(`HTTP ${res.statusCode}`);
      });
    } catch (err) {
      resolve(`URL invalide (${err.message})`);
      return;
    }
    req.on("timeout", () => req.destroy(new Error("délai dépassé")));
    req.on("error", (err) => resolve(`injoignable (${err.code || err.message})`));
  });
}

async function status() {
  const root = projectRoot();
  const cfg = loadDemoConfig(root);
  const wt = path.join(root, cfg.worktree);
  if (worktreeExists(wt)) {
    const sha = git(["rev-parse", "HEAD"], wt);
    const recorded = readState(wt, "demo-revision");
    const dirty = dirtyEntries(wt, cfg);
    console.log(`Worktree démo : ${wt}`);
    console.log(`Révision      : ${sha}${recorded && recorded !== sha ? ` (dernier sync : ${recorded})` : ""}`);
    console.log(`État          : ${dirty.length === 0 ? "propre" : `sale (${dirty.length} entrée(s))`}`);
    console.log(`Dépendances   : ${describeMode(wt, cfg)}`);
  } else {
    console.log(`Worktree démo : absent (${wt})`);
  }
  const results = await Promise.all(cfg.health.map((h) => probe(text(h.url))));
  cfg.health.forEach((h, i) => {
    console.log(`${(text(h.name) || "service").padEnd(14)}: ${text(h.url)} -> ${results[i]}`);
  });
  if (cfg.health.length === 0) console.log("Aucune URL de santé configurée (demo.health).");
}

async function main(argv) {
  const [command, ...rest] = argv;
  if (command === "sync") {
    const ref = rest.find((arg) => !arg.startsWith("--"));
    return sync(ref, {
      migrate: rest.includes("--migrate"),
      install: rest.includes("--install"),
    });
  }
  if (command === "status") return status();
  throw new DemoError(
    "Usage : node scripts/demo-instance.cjs sync <ref> [--migrate] [--install] | status",
  );
}

main(process.argv.slice(2)).catch((err) => {
  const message = err instanceof DemoError ? err.message : `Erreur inattendue : ${err.message}`;
  console.error(`\n${message}`);
  process.exitCode = 1;
});
