#!/bin/bash
# Hook PreToolUse (matcher Bash|PowerShell) — validation déterministe des
# commandes avant exécution. Bloque (exit 2, raison en français sur stderr) les
# opérations destructrices listées dans AGENTS.md ; laisse tout le reste passer
# (exit 0).
#
# Fichier géré par acc-standard : identique d'un projet à l'autre. Ce qui est
# propre au projet se lit à l'exécution dans acc.config.json (racine du projet,
# $CLAUDE_PROJECT_DIR ou racine git) :
#   - git.protectedBranches      branches où toute poussée est refusée
#                                (défaut : main, master) ;
#   - guard.protectedPaths       dossiers qu'un rm -rf / Remove-Item -Recurse
#                                ne peut pas viser (en plus de /, ~, ., .git,
#                                node_modules) ;
#   - guard.destructiveCommands  [{ "pattern": "<regex JS>", "reason": "…" }]
#                                motifs supplémentaires à refuser.
# Config absente, illisible ou incomplète : valeurs par défaut, jamais d'erreur.
#
# Échec ouvert : toute entrée illisible, tout outil absent (node introuvable,
# fichier temporaire impossible à créer) se traduit par exit 0. On ne bloque
# jamais l'agent à cause d'un bug de ce hook lui-même.
#
# L'extraction du JSON et toute la logique de détection sont faites en Node
# (pas de jq : sa présence n'est pas garantie sous Windows/Git Bash). Le JSON
# reçu sur stdin est écrit dans un fichier temporaire plutôt que transmis par
# variable d'environnement, pour ne pas être limité par la taille d'une
# commande très longue.

set -u

TMP_INPUT="$(mktemp "${TMPDIR:-/tmp}/acc-validate-bash.XXXXXX" 2>/dev/null)"
if [ -z "$TMP_INPUT" ]; then
  # Impossible de créer le fichier temporaire : on vide stdin et on laisse passer.
  cat >/dev/null
  exit 0
fi
cat > "$TMP_INPUT"
trap 'rm -f "$TMP_INPUT"' EXIT

if ! command -v node >/dev/null 2>&1; then
  exit 0
fi

# Le corps du script Node vit dans un heredoc à délimiteur entre apostrophes
# ('NODE_SCRIPT') : bash ne fait alors AUCUNE expansion sur son contenu (ni
# $variable, ni `commande`, ni interprétation des apostrophes françaises).
ACC_HOOK_INPUT_FILE="$TMP_INPUT" node <<'NODE_SCRIPT'
"use strict";
const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

// Toute exception non prévue laisse passer la commande (échec ouvert).
process.on("uncaughtException", () => process.exit(0));

// --- Lecture de l'entrée et de la configuration --------------------------

// Lit tool_input.command depuis le fichier temporaire. Retourne null si le
// JSON est illisible (échec ouvert), "" si aucune commande n'est présente.
function readCommand() {
  try {
    const raw = fs.readFileSync(process.env.ACC_HOOK_INPUT_FILE, "utf8");
    const json = JSON.parse(raw);
    const cmd = json && json.tool_input && json.tool_input.command;
    return typeof cmd === "string" ? cmd : "";
  } catch (e) {
    return null;
  }
}

function projectRoot() {
  if (process.env.CLAUDE_PROJECT_DIR) return process.env.CLAUDE_PROJECT_DIR;
  try {
    const r = spawnSync("git", ["rev-parse", "--show-toplevel"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (r.status === 0 && r.stdout.trim()) return r.stdout.trim();
  } catch (e) {
    // git absent : on retombe sur le dossier courant.
  }
  return process.cwd();
}

function readConfig() {
  try {
    const file = path.join(projectRoot(), "acc.config.json");
    const json = JSON.parse(fs.readFileSync(file, "utf8"));
    return json && typeof json === "object" ? json : {};
  } catch (e) {
    return {};
  }
}

function stringArray(value) {
  return Array.isArray(value) ? value.filter((v) => typeof v === "string" && v.trim() !== "") : [];
}

const config = readConfig();
const git = config.git && typeof config.git === "object" ? config.git : {};
const guard = config.guard && typeof config.guard === "object" ? config.guard : {};

const configuredBranches = stringArray(git.protectedBranches);
const PROTECTED_BRANCHES = configuredBranches.length ? configuredBranches : ["main", "master"];

function normalizeDir(p) {
  return p.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "");
}

// Un dossier est « ciblé » par un rm/Remove-Item si l'argument, une fois
// nettoyé d'un "./" de tête et d'un "/" de fin, correspond exactement à un
// des noms protégés. Ça laisse passer "dist" ou "src/generated", et ne bloque
// que la racine de ces dossiers.
const PROTECTED_DIR_NAMES = Array.from(
  new Set(["/", "~", ".", "..", "*", ".git", "node_modules"].concat(stringArray(guard.protectedPaths).map(normalizeDir)))
).filter((d) => d !== "");

const EXTRA_RULES = (Array.isArray(guard.destructiveCommands) ? guard.destructiveCommands : [])
  .map((rule) => {
    if (!rule || typeof rule.pattern !== "string") return null;
    try {
      return {
        re: new RegExp(rule.pattern),
        reason: typeof rule.reason === "string" && rule.reason ? rule.reason : "commande refusée par guard.destructiveCommands (acc.config.json).",
      };
    } catch (e) {
      return null; // regex invalide : ignorée plutôt que de casser le hook
    }
  })
  .filter(Boolean);

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Début d'une commande git, options globales comprises : « git push »,
// « git -C dossier push », « git --no-pager -c k=v push »… Sans cela,
// `git -C . push origin main` échapperait à toutes les règles ci-dessous.
// Un chemin cité (« -C "mon dossier" ») est déjà masqué en espaces.
const GIT_VALUE = "(?:\"\\s*\"|'\\s*'|\\S+)";
const GIT_OPTION =
  "(?:-[Cc]\\s+" + GIT_VALUE + "|--(?:git-dir|work-tree|namespace|exec-path)(?:=|\\s+)" + GIT_VALUE + "|--[a-z][a-z-]*)";
const GIT = "\\bgit\\s+(?:" + GIT_OPTION + "\\s+)*";

// RegExp commençant par « git [options globales] », suivi de `rest`.
function gitRe(rest, flags) {
  return new RegExp(GIT + rest, flags);
}

// --- Règle 1 : git stash sous toutes ses formes qui modifient l'arbre -----
// list, show, create et apply sont en lecture (ou n'effacent rien) ; push,
// pop, drop, clear, save et le "git stash" nu (équivalent à push) vident ou
// perdent du travail dans un arbre partagé entre agents.
function checkGitStash(cmd) {
  const allowed = ["list", "show", "create", "apply"];
  const re = gitRe("stash(?:\\s+(-{0,2}[a-zA-Z-]+))?", "g");
  let m;
  while ((m = re.exec(cmd)) !== null) {
    const sub = m[1];
    if (!sub || !allowed.includes(sub)) {
      const label = sub ? sub : "sans sous-commande, équivalent à push";
      return (
        "git stash (" + label + ") est bloqué : un stash vide l'arbre de travail " +
        "partagé avec les autres agents. Seuls list, show, create et apply sont " +
        "autorisés ; demande à l'utilisateur pour le reste."
      );
    }
  }
  return null;
}

// --- Règle 2 : git push forcé / vers une branche protégée ----------------
// --force-with-lease est toléré hors branche protégée ; --force et -f nus
// sont toujours bloqués ; une poussée vers une branche protégée est bloquée
// même sans option de force ; --mirror écrase toutes les références distantes.
function targetsProtectedBranch(str) {
  const names = PROTECTED_BRANCHES.map(escapeRegExp).join("|");
  const re = new RegExp("(^|\\s|:|\\+)(refs/heads/)?(" + names + ")(\\s|$|[\"'])");
  return re.test(str);
}

// Découpe la commande en segments (&&, ||, ;, |, retour à la ligne) en gardant
// la position de chacun, pour retrouver le texte non masqué correspondant.
function splitSegments(cmd) {
  const out = [];
  const sep = /&&|\|\||[;|\n]/g;
  let from = 0;
  let m;
  while ((m = sep.exec(cmd)) !== null) {
    out.push({ start: from, text: cmd.slice(from, m.index) });
    from = m.index + m[0].length;
  }
  out.push({ start: from, text: cmd.slice(from) });
  return out;
}

// Les chaînes citées sont vidées par la neutralisation, ce qui cacherait une
// cible citée (`git push origin "main"`). `rawCommand` a la même longueur que
// la commande neutralisée : on y relit les arguments, guillemets retirés.
function unquotedArgs(seg, args) {
  if (!rawCommand || rawCommand.length !== neutralizedLength) return args;
  const begin = seg.start + seg.text.length - args.length;
  return rawCommand.slice(begin, seg.start + seg.text.length).replace(/["']/g, "");
}

function checkGitPush(cmd) {
  for (const seg of splitSegments(cmd)) {
    const m = seg.text.match(gitRe("push\\b(.*)$"));
    if (!m) continue;
    const args = m[1];

    if (targetsProtectedBranch(args) || targetsProtectedBranch(unquotedArgs(seg, args))) {
      return (
        "git push vers une branche protégée (" + PROTECTED_BRANCHES.join(", ") + ") est bloqué : " +
        "passer par une branche de travail et une pull request."
      );
    }
    if (/(^|\s)--mirror\b/.test(args)) {
      return "git push --mirror est bloqué : il écrase toutes les références distantes, branches protégées comprises.";
    }
    const forceTokens = args.match(/--force(-[a-zA-Z-]+)*/g) || [];
    for (const tok of forceTokens) {
      if (tok !== "--force-with-lease" && tok !== "--force-if-includes") {
        return "git push --force est bloqué. Utilise --force-with-lease sur une branche non protégée si c'est vraiment nécessaire.";
      }
    }
    if (/(^|\s)-[a-zA-Z]*f[a-zA-Z]*(\s|$)/.test(args)) {
      return "git push -f est bloqué (équivalent à --force). Utilise --force-with-lease sur une branche non protégée si c'est vraiment nécessaire.";
    }
    if (/(^|\s)\+\S/.test(args)) {
      return "git push avec une référence préfixée par + (poussée forcée) est bloqué.";
    }
  }
  return null;
}

// Supprimer ou renommer une branche protégée en local prépare une poussée qui
// la détruit ou la remplace : `git branch -D main`, `git branch -m main x`.
function checkProtectedBranchRewrite(cmd) {
  for (const seg of splitSegments(cmd)) {
    const m = seg.text.match(gitRe("branch\\b(.*)$"));
    if (!m) continue;
    const args = m[1];
    const rewrites = /(^|\s)(--delete|--move|-[a-zA-Z]*[dDmM][a-zA-Z]*)(\s|$)/.test(args);
    if (rewrites && (targetsProtectedBranch(args) || targetsProtectedBranch(unquotedArgs(seg, args)))) {
      return (
        "supprimer ou renommer une branche protégée (" + PROTECTED_BRANCHES.join(", ") + ") est bloqué : " +
        "demande à l'utilisateur."
      );
    }
  }
  return null;
}

// --- Règle 3 : contournement des hooks git -------------------------------
function checkHookBypass(cmd) {
  const segments = cmd.split(/&&|\|\||[;|\n]/);
  for (const seg of segments) {
    const m = seg.match(gitRe("(commit|push|merge|rebase|am|cherry-pick)\\b(.*)$"));
    if (!m) continue;
    if (/--no-verify\b/.test(m[2])) {
      return "--no-verify est bloqué : les contrôles des hooks git ne se contournent pas, ils se corrigent.";
    }
    // "git commit -n" (ou -an, -nm…) est l'abréviation de --no-verify. Le
    // message cité après -m a déjà été neutralisé et ne peut pas tromper ce test.
    if (m[1] === "commit" && /(^|\s)-[a-zA-Z]*n[a-zA-Z]*(\s|$)/.test(m[2])) {
      return "git commit -n (--no-verify) est bloqué : les contrôles des hooks git ne se contournent pas.";
    }
  }
  if (/(^|[\s;&|])(export\s+)?LEFTHOOK=(0|false)\b/i.test(cmd)) {
    return "LEFTHOOK=0 est bloqué : désactiver Lefthook revient à contourner les hooks git.";
  }
  if (/(^|[\s;&|])(export\s+)?HUSKY=0\b/.test(cmd)) {
    return "HUSKY=0 est bloqué : désactiver les hooks git revient à les contourner.";
  }
  if (gitRe("config\\b[^|;&\\n]*\\bcore\\.hooksPath\\b").test(cmd) && !/--get\\b|--list\\b|(^|\\s)-l(\\s|$)/.test(cmd)) {
    return "modifier core.hooksPath est bloqué : cela désactive les hooks git installés.";
  }
  if (/\bgit\s+(?:\S+\s+)*?-c\s+core\.hooksPath=/.test(cmd)) {
    return "git -c core.hooksPath=… est bloqué : cela contourne les hooks git installés.";
  }
  return null;
}

// --- Règle 4 : abandon de travail sur tout l'arbre -----------------------
function checkTreeWipe(cmd) {
  if (gitRe("reset\\b[^|;&\\n]*--hard\\b").test(cmd)) {
    return "git reset --hard est bloqué : abandon irréversible des modifications de l'arbre de travail partagé. Demande à l'utilisateur.";
  }
  if (gitRe("clean\\b").test(cmd)) {
    const cleanMatch = cmd.match(gitRe("clean\\b[^|;&\\n]*"));
    const segment = cleanMatch ? cleanMatch[0] : cmd;
    if (/(^|\s)-[a-zA-Z]*f[a-zA-Z]*(\s|$)/.test(segment) || /--force\b/.test(segment)) {
      return "git clean -f est bloqué : suppression irréversible des fichiers non suivis.";
    }
  }
  if (gitRe("checkout\\s+(-f\\s+)?--\\s+\\.(\\s|$)").test(cmd)) {
    return "git checkout -- . est bloqué : abandon de toutes les modifications de l'arbre de travail.";
  }
  if (gitRe("checkout\\s+\\.(\\s|$)").test(cmd)) {
    return "git checkout . est bloqué : abandon de toutes les modifications de l'arbre de travail.";
  }
  if (gitRe("restore\\b[^|;&\\n]*\\s\\.(\\s|$)").test(cmd) || gitRe("restore\\s+\\.(\\s|$)").test(cmd)) {
    return "git restore . est bloqué : abandon de toutes les modifications de l'arbre de travail.";
  }
  return null;
}

// --- Règle 5 : destruction de base de données (générique) ---------------
// Les commandes propres à un outil (migrations, ORM…) se déclarent dans
// guard.destructiveCommands d'acc.config.json.
function checkDbDestructive(cmd) {
  if (/\bdrop\s+(database|schema)\b/i.test(cmd)) {
    return "DROP DATABASE / DROP SCHEMA est bloqué : destruction de base de données.";
  }
  if (/\bdropdb\b/.test(cmd)) {
    return "dropdb est bloqué : destruction de base de données.";
  }
  return null;
}

// --- Règle 6 : rm -rf / Remove-Item -Recurse sur un dossier protégé ------
function checkRmRf(cmd) {
  const rmRe = /(?:^|[\s;&|(])rm\s+([^\n]*)/g;
  let m;
  while ((m = rmRe.exec(cmd)) !== null) {
    let rest = m[1];
    const stop = rest.match(/(&&|\|\||[;|])/);
    if (stop) rest = rest.slice(0, stop.index);

    const tokens = rest.split(/\s+/).filter(Boolean);
    let hasR = false;
    let hasF = false;
    const targets = [];
    for (const tok of tokens) {
      if (tok === "--recursive") {
        hasR = true;
      } else if (tok === "--force") {
        hasF = true;
      } else if (/^-[a-zA-Z]+$/.test(tok)) {
        if (/[rR]/.test(tok)) hasR = true;
        if (/f/.test(tok)) hasF = true;
      } else if (/^--/.test(tok)) {
        // autre option longue, non pertinente pour cette règle
      } else {
        targets.push(tok);
      }
    }
    if (hasR && hasF) {
      for (const target of targets) {
        const cleaned = normalizeDir(target.replace(/^["']|["']$/g, ""));
        if (cleaned === "" || PROTECTED_DIR_NAMES.includes(cleaned) || /^(\/|~)\*?$/.test(cleaned)) {
          return (
            "rm -rf vise un dossier protégé (" + target + ") : trop dangereux pour " +
            "être exécuté automatiquement. Cible un sous-dossier précis (dist/, " +
            "coverage/, un dossier temporaire…) si c'est le besoin réel."
          );
        }
      }
    }
  }

  if (/Remove-Item\b/i.test(cmd) && /-Recurse\b/i.test(cmd)) {
    for (const name of PROTECTED_DIR_NAMES) {
      if (name === "/" || name === "~" || name === "." || name === ".." || name === "*") continue;
      const re = new RegExp("(^|[\\s\"'\\\\/])" + escapeRegExp(name) + "([\\s\"'\\\\/]|$)");
      if (re.test(cmd)) {
        return (
          "Remove-Item -Recurse vise un dossier protégé (" + name + ") : trop " +
          "dangereux pour être exécuté automatiquement."
        );
      }
    }
  }
  return null;
}

// --- Règle 7 : motifs propres au projet (guard.destructiveCommands) ------
function checkProjectRules(cmd) {
  for (const rule of EXTRA_RULES) {
    if (rule.re.test(cmd)) return rule.reason;
  }
  return null;
}

// --- Neutralisation préalable : texte cité et corps de heredoc -----------
// Les règles ci-dessus cherchent des motifs comme "git stash" dans la
// commande entière. Sans égard au contexte, ça déclenche sur du texte qui
// n'est PAS exécuté : un motif grep, un message de commit, ou le contenu
// écrit par un heredoc. On neutralise donc, AVANT détection :
//   - le corps de tout heredoc, SAUF s'il est envoyé à un interpréteur qui
//     l'exécuterait réellement (bash, sh, zsh, dash, powershell, pwsh, cmd,
//     eval) ;
//   - le contenu de toute chaîne entre guillemets, SAUF si elle est
//     l'argument d'un `bash -c`, `sh -c`, `powershell -Command`, `pwsh -c`,
//     `eval` ou `cmd /c`, auquel cas son contenu reste analysable.
// Exception : la cible d'un `git push` ou d'un `git branch` est relue sans
// guillemets (unquotedArgs), pour que `git push origin "main"` reste refusé.
// Le hook pre-push de Lefthook reste la garde de dernier recours.

const EXECUTOR_NAMES = ["bash", "sh", "zsh", "dash", "powershell", "powershell.exe", "pwsh", "cmd", "cmd.exe", "eval"];

function stripHeredocs(cmd) {
  const lines = cmd.split("\n");
  const out = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const heredocMatch = line.match(/<<-?\s*(['"]?)([A-Za-z_][A-Za-z0-9_]*)\1/);
    if (!heredocMatch) {
      out.push(line);
      i++;
      continue;
    }
    const delim = heredocMatch[2];
    const beforeHeredoc = line.slice(0, heredocMatch.index);
    const segments = beforeHeredoc.split(/(?:&&|\|\||[;|])/);
    const lastSegment = (segments[segments.length - 1] || "").trim();
    const firstWord = (lastSegment.split(/\s+/)[0] || "").replace(/^.*[\\/]/, "").toLowerCase();
    const isExecutor = EXECUTOR_NAMES.includes(firstWord);

    out.push(line);
    i++;
    const bodyLines = [];
    while (i < lines.length && lines[i].trim() !== delim) {
      bodyLines.push(lines[i]);
      i++;
    }
    if (i < lines.length) {
      out.push(lines[i]);
      i++;
    }
    if (isExecutor) out.push(...bodyLines);
    else out.push(...bodyLines.map(() => ""));
  }
  return out.join("\n");
}

function findProtectedRanges(str) {
  const patterns = [
    /\b(?:bash|sh|zsh|dash)\s+-c\s+(['"])/gi,
    /\beval\s+(['"])/gi,
    /\b(?:powershell(?:\.exe)?|pwsh)\s+(?:-Command|-c)\s+(['"])/gi,
    /\bcmd(?:\.exe)?\s+\/c\s+(['"])/gi,
  ];
  const ranges = [];
  for (const re of patterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(str)) !== null) {
      const quoteChar = m[1];
      const openIdx = m.index + m[0].length - 1;
      let i = openIdx + 1;
      let closeIdx = -1;
      while (i < str.length) {
        if (quoteChar === '"' && str[i] === "\\") {
          i += 2;
          continue;
        }
        if (str[i] === quoteChar) {
          closeIdx = i;
          break;
        }
        i++;
      }
      const end = closeIdx === -1 ? str.length : closeIdx + 1;
      ranges.push([m.index, end]);
      re.lastIndex = end;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const r of ranges) {
    if (merged.length && r[0] <= merged[merged.length - 1][1]) {
      merged[merged.length - 1][1] = Math.max(merged[merged.length - 1][1], r[1]);
    } else {
      merged.push(r);
    }
  }
  return merged;
}

// Remplace le contenu de chaque chaîne citée par des espaces, en conservant
// les guillemets et la longueur totale (pour recoller les plages protégées).
function maskQuotesKeepLength(str) {
  let out = "";
  let i = 0;
  const n = str.length;
  while (i < n) {
    const c = str[i];
    if (c === "'" || c === '"') {
      let j = i + 1;
      while (j < n) {
        if (c === '"' && str[j] === "\\") {
          j += 2;
          continue;
        }
        if (str[j] === c) break;
        j++;
      }
      const hasClose = j < n && str[j] === c;
      const spanEnd = hasClose ? j : n - 1;
      const spanLen = spanEnd - i + 1;
      const middleLen = hasClose ? spanLen - 2 : spanLen - 1;
      out += c + " ".repeat(Math.max(0, middleLen)) + (hasClose ? c : "");
      i = spanEnd + 1;
      continue;
    }
    out += c;
    i++;
  }
  return out;
}

// Commande après retrait des heredocs, avant masquage des guillemets : même
// longueur que la commande neutralisée (voir unquotedArgs).
let rawCommand = "";
let neutralizedLength = -1;

function neutralizeCommand(rawCmd) {
  const working = stripHeredocs(rawCmd);
  rawCommand = working;
  const protectedRanges = findProtectedRanges(working);
  let shielded = working;
  if (protectedRanges.length) {
    const chars = working.split("");
    for (const [s, e] of protectedRanges) {
      for (let k = s; k < e; k++) chars[k] = "X";
    }
    shielded = chars.join("");
  }
  const maskedGeneric = maskQuotesKeepLength(shielded);
  const finalChars = maskedGeneric.split("");
  for (const [s, e] of protectedRanges) {
    for (let k = s; k < e; k++) finalChars[k] = working[k];
  }
  neutralizedLength = finalChars.length;
  return finalChars.join("");
}

// --- Point d'entrée ------------------------------------------------------

const cmd = readCommand();
if (cmd === null || !cmd) {
  process.exit(0);
}

const neutralizedCmd = neutralizeCommand(cmd);

const checks = [
  checkGitStash,
  checkGitPush,
  checkProtectedBranchRewrite,
  checkHookBypass,
  checkTreeWipe,
  checkDbDestructive,
  checkRmRf,
  checkProjectRules,
];

for (const check of checks) {
  let reason = null;
  try {
    reason = check(neutralizedCmd);
  } catch (e) {
    reason = null; // une règle défaillante ne bloque rien
  }
  if (reason) {
    console.error(reason);
    process.exit(2);
  }
}

process.exit(0);
NODE_SCRIPT

exit $?
