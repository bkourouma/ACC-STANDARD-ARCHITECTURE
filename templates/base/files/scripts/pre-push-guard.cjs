#!/usr/bin/env node
"use strict";

// Hook git pre-push (Lefthook, use_stdin) : refuse une poussée directe vers une
// branche protégée, quel que soit l'agent ou l'outil qui la lance. Les hooks
// .claude/ ne couvrent que Claude Code ; celui-ci vaut aussi pour Codex, Cursor
// et un humain. Les changements passent par une pull request.
//
// Fichier géré par acc-standard. Les branches protégées se lisent à
// l'exécution dans acc.config.json (git.protectedBranches, racine du dépôt) ;
// config absente ou illisible : main et master.
// CommonJS, zéro dépendance, Node 20.

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_BRANCHES = ["main", "master"];

function repoRoot() {
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  return r.status === 0 && r.stdout.trim() ? r.stdout.trim() : process.cwd();
}

function protectedBranches() {
  try {
    const config = JSON.parse(
      fs.readFileSync(path.join(repoRoot(), "acc.config.json"), "utf8"),
    );
    const list = config && config.git && config.git.protectedBranches;
    if (Array.isArray(list)) {
      const names = list.filter((b) => typeof b === "string" && b.trim() !== "");
      if (names.length > 0) return names;
    }
  } catch {
    // Config absente ou illisible : valeurs par défaut.
  }
  return DEFAULT_BRANCHES;
}

function readStdin() {
  try {
    return fs.readFileSync(0, "utf8");
  } catch {
    return "";
  }
}

const protectedRefs = new Set(protectedBranches().map((b) => `refs/heads/${b}`));

// Chaque ligne de stdin : <ref locale> <sha local> <ref distante> <sha distant>.
const blocked = readStdin()
  .split(/\r?\n/)
  .filter(Boolean)
  .map((line) => line.split(/\s+/)[2])
  .filter((remoteRef) => protectedRefs.has(remoteRef));

if (blocked.length > 0) {
  console.error(
    `Poussée refusée vers ${blocked.join(", ")} : branche protégée, passer par une branche de travail et une pull request.`,
  );
  process.exit(1);
}
