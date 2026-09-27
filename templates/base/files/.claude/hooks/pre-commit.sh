#!/bin/bash
# Hook PreToolUse (matcher Bash) — contrôles avant un `git commit` lancé par
# l'agent, en complément des hooks git Lefthook, qui continuent de tourner
# normalement.
#
# Fichier géré par acc-standard : identique d'un projet à l'autre. Les
# contrôles se lisent à l'exécution dans acc.config.json, clé hooks.preCommit :
#
#   "hooks": { "preCommit": [
#     { "name": "typecheck", "command": "npm run typecheck",
#       "blocking": true, "whenStaged": ["**/*.ts", "src/**/*.{ts,tsx}"] }
#   ] }
#
#   - command     commande lancée depuis la racine du projet (shell du système) ;
#   - blocking    true (défaut) : un échec bloque le commit (exit 2, 40
#                 premières lignes de sortie sur stderr) ; false : simple
#                 avertissement remonté à l'agent, le commit continue ;
#   - whenStaged  globs sur les fichiers INDEXÉS (git diff --cached) ; le
#                 contrôle ne tourne que si au moins un fichier correspond ;
#                 vide ou absent : toujours. Syntaxe : `**` (tout sous-chemin),
#                 `*` (hors /), `?`, `{a,b}`. Un motif sans `/` s'applique au
#                 nom du fichier, quel que soit son dossier.
#
# Ne fait rien (exit 0 immédiat) si la commande n'est pas un `git commit`, si
# aucun fichier n'est indexé, ou si acc.config.json est absent ou sans
# contrôle. Ce script ne modifie jamais l'index ni l'arbre de travail — les
# commandes configurées ne doivent pas le faire non plus (pas de --fix).
#
# Échec ouvert : node absent, entrée illisible, config invalide → exit 0.

set -u

TMP_INPUT="$(mktemp "${TMPDIR:-/tmp}/acc-pre-commit.XXXXXX" 2>/dev/null)"
if [ -z "$TMP_INPUT" ]; then
  cat >/dev/null
  exit 0
fi
cat > "$TMP_INPUT"
trap 'rm -f "$TMP_INPUT"' EXIT

if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

ACC_HOOK_INPUT_FILE="$TMP_INPUT" node <<'NODE_SCRIPT'
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

process.on("uncaughtException", () => process.exit(0));

function readCommand() {
  try {
    const json = JSON.parse(fs.readFileSync(process.env.ACC_HOOK_INPUT_FILE, "utf8"));
    const cmd = json && json.tool_input && json.tool_input.command;
    return typeof cmd === "string" ? cmd : "";
  } catch (e) {
    return "";
  }
}

// Vrai si la commande lance réellement un git commit. Le texte entre
// guillemets est ignoré (un message ou un motif grep qui cite "git commit").
function isGitCommit(cmd) {
  const unquoted = cmd.replace(/'[^']*'/g, "''").replace(/"(?:\\.|[^"\\])*"/g, '""');
  return /\bgit\s+(?:-C\s+\S+\s+)?commit\b/.test(unquoted);
}

function projectRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  return process.cwd();
}

function readChecks(root) {
  try {
    const config = JSON.parse(fs.readFileSync(path.join(root, "acc.config.json"), "utf8"));
    const list = config && config.hooks && config.hooks.preCommit;
    if (!Array.isArray(list)) return [];
    return list.filter((c) => c && typeof c.command === "string" && c.command.trim() !== "");
  } catch (e) {
    return [];
  }
}

// --- Matcher glob minimal : **, *, ?, {a,b} -------------------------------

// Découpe le contenu d'accolades sur les virgules de premier niveau.
function splitAlternatives(body) {
  const parts = [];
  let depth = 0;
  let current = "";
  for (const ch of body) {
    if (ch === "{") depth++;
    if (ch === "}") depth--;
    if (ch === "," && depth === 0) {
      parts.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  parts.push(current);
  return parts;
}

function globToRegexSource(glob) {
  let out = "";
  let i = 0;
  while (i < glob.length) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        // "**/" : zéro ou plusieurs dossiers ; "**" seul : n'importe quoi.
        if (glob[i + 2] === "/") {
          out += "(?:.*/)?";
          i += 3;
        } else {
          out += ".*";
          i += 2;
        }
      } else {
        out += "[^/]*";
        i += 1;
      }
    } else if (c === "?") {
      out += "[^/]";
      i += 1;
    } else if (c === "{") {
      // Cherche l'accolade fermante correspondante.
      let depth = 0;
      let j = i;
      for (; j < glob.length; j++) {
        if (glob[j] === "{") depth++;
        else if (glob[j] === "}") {
          depth--;
          if (depth === 0) break;
        }
      }
      if (j >= glob.length) {
        out += "\\{";
        i += 1;
      } else {
        const alts = splitAlternatives(glob.slice(i + 1, j)).map(globToRegexSource);
        out += "(?:" + alts.join("|") + ")";
        i = j + 1;
      }
    } else {
      out += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
      i += 1;
    }
  }
  return out;
}

function globMatches(glob, file) {
  const normalized = file.replace(/\\/g, "/");
  const g = glob.replace(/\\/g, "/").replace(/^\.\//, "");
  const target = g.includes("/") ? normalized : normalized.split("/").pop();
  try {
    return new RegExp("^" + globToRegexSource(g) + "$").test(target);
  } catch (e) {
    return false;
  }
}

function shouldRun(check, staged) {
  const globs = Array.isArray(check.whenStaged) ? check.whenStaged.filter((g) => typeof g === "string" && g) : [];
  if (globs.length === 0) return true;
  return staged.some((file) => globs.some((g) => globMatches(g, file)));
}

// --- Exécution -----------------------------------------------------------

function main() {
  if (!isGitCommit(readCommand())) return 0;

  const root = projectRoot();
  const checks = readChecks(root);
  if (checks.length === 0) return 0;

  const diff = spawnSync("git", ["diff", "--cached", "--name-only", "--diff-filter=ACMR"], {
    cwd: root,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  if (diff.status !== 0) return 0;
  const staged = diff.stdout.split(/\r?\n/).filter(Boolean);
  if (staged.length === 0) return 0;

  const warnings = [];
  for (const check of checks) {
    if (!shouldRun(check, staged)) continue;
    const name = typeof check.name === "string" && check.name ? check.name : check.command;
    const result = spawnSync(check.command, {
      cwd: root,
      shell: true,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 64 * 1024 * 1024,
    });
    if (result.error) {
      warnings.push(`${name} : impossible de lancer « ${check.command} » (${result.error.message}).`);
      continue;
    }
    if (result.status === 0) continue;

    const output = `${result.stdout || ""}${result.stderr || ""}`.split(/\r?\n/).slice(0, 40).join("\n");
    if (check.blocking === false) {
      warnings.push(`${name} (« ${check.command} ») en échec, non bloquant :\n${output}`);
    } else {
      console.error(`Contrôle avant commit « ${name} » (${check.command}) en échec : corrige avant de recommiter.`);
      console.error("40 premières lignes :");
      console.error(output);
      return 2;
    }
  }

  if (warnings.length) {
    // Avertissement non bloquant : remonté à l'agent via le JSON de sortie
    // du hook (systemMessage + additionalContext), exit 0.
    const msg = "Avertissements avant commit (non bloquants) :\n" + warnings.join("\n\n");
    process.stdout.write(
      JSON.stringify({
        systemMessage: msg,
        hookSpecificOutput: { hookEventName: "PreToolUse", additionalContext: msg },
      })
    );
  }
  return 0;
}

let code = 0;
try {
  code = main();
} catch (e) {
  code = 0;
}
process.exit(code);
NODE_SCRIPT

exit $?
