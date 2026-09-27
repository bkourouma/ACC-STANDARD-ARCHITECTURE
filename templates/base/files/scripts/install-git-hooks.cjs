#!/usr/bin/env node
/* eslint-disable -- script CommonJS géré par acc-standard : require() voulu, hors du lint du projet. */
"use strict";

// Installe les hooks git Lefthook (.lefthook.yml) dans le dépôt courant.
// Lancé par le script `prepare` d'un projet Node (qui ignore l'absence de ce
// fichier, par exemple dans une image Docker qui ne copie que package*.json
// avant l'installation), ou à la main :
//   node scripts/install-git-hooks.cjs
//
// - Hors dépôt git : ne fait rien.
// - Migre la seule valeur de core.hooksPath écrite par Husky (".husky/_"),
//   qui empêcherait Lefthook de s'installer ; toute autre valeur personnalisée
//   est conservée.
// - Cherche Lefthook dans node_modules du projet, puis dans le PATH. Absent :
//   avertissement et code 0, pour ne pas casser une installation de
//   production (dépendances de développement omises) ; `acc-standard doctor`
//   signale ensuite les hooks manquants.
//
// Fichier géré par acc-standard. CommonJS, zéro dépendance, Node 20.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const isWindows = process.platform === "win32";

function git(args) {
  return spawnSync("git", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
}

const top = git(["rev-parse", "--show-toplevel"]);
if (top.status !== 0) {
  process.exit(0);
}
const root = top.stdout.trim();

const hooksPath = git(["config", "--local", "--get", "core.hooksPath"]);
if (hooksPath.status === 0 && hooksPath.stdout.trim() === ".husky/_") {
  const unset = spawnSync(
    "git",
    ["config", "--local", "--unset-all", "core.hooksPath"],
    { stdio: "inherit" },
  );
  if (unset.status !== 0) {
    process.exit(unset.status ?? 1);
  }
  console.log("core.hooksPath (.husky/_) retiré : Lefthook prend le relais.");
}

// Lefthook installé comme dépendance du projet : on passe par le binaire de
// node_modules/.bin (le paquet npm lefthook y dépose le binaire natif).
function localLefthook() {
  const bin = path.join(root, "node_modules", ".bin", isWindows ? "lefthook.cmd" : "lefthook");
  return fs.existsSync(bin) ? bin : null;
}

function commandExists(name) {
  const probe = spawnSync(isWindows ? "where" : "which", [name], {
    stdio: "ignore",
  });
  return probe.status === 0;
}

const command = localLefthook() || (commandExists("lefthook") ? "lefthook" : null);
if (!command) {
  console.warn(
    "Lefthook introuvable : hooks git non installés. Installer Lefthook " +
      "(dépendance de développement « lefthook » ou binaire système), puis " +
      "relancer node scripts/install-git-hooks.cjs.",
  );
  process.exit(0);
}

// Sous Windows, un .cmd ne se lance que par un shell ; le chemin est cité
// parce qu'il peut contenir des espaces.
const install = isWindows
  ? spawnSync(`"${command}" install`, { cwd: root, stdio: "inherit", shell: true })
  : spawnSync(command, ["install"], { cwd: root, stdio: "inherit" });

if (install.error) {
  console.error(`Impossible d'installer Lefthook : ${install.error.message}`);
  process.exit(1);
}

process.exit(install.status ?? 1);
