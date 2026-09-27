#!/usr/bin/env node
// Vérifie que les gabarits (templates/) ne contiennent aucune référence propre
// au projet d'origine ni à un projet particulier : nom, ports, chemins de
// monorepo, termes métier. Échoue (code 1) en listant fichier:ligne.
//
// Seule exception : les exemples de `guard.destructiveCommands` (motifs regex
// sous forme de chaîne JSON) listés dans ALLOWED_SNIPPETS, qui peuvent citer
// un outil de base de données à titre d'illustration.
//
// ESM, zéro dépendance, Node >= 20.

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const TEMPLATES = join(ROOT, 'templates');

// Motifs interdits. `tenant` est borné à gauche pour ne pas attraper
// « maintenant » ; les ports ne doivent pas faire partie d'un nombre plus long.
const FORBIDDEN = [
  { label: 'immotopia', re: /immotopia/i },
  { label: 'tenant', re: /\btenant/i },
  { label: 'prisma', re: /prisma/i },
  { label: '8001', re: /(?<!\d)8001(?!\d)/ },
  { label: '3002', re: /(?<!\d)3002(?!\d)/ },
  { label: 'apps/web', re: /apps[\\/]web/i },
  { label: 'packages/api', re: /packages[\\/]api/i },
  { label: 'bkourouma (hors adresse du standard)', re: /bkourouma(?!\/ACC-STANDARD-ARCHITECTURE)/i },
  { label: 'PaySecure', re: /paysecure/i },
  { label: 'syndic', re: /syndic/i },
];

// Liste blanche : fragments exacts retirés de la ligne avant contrôle. Ce
// sont des exemples de `guard.destructiveCommands` (regex JS en chaîne JSON).
const ALLOWED_SNIPPETS = [
  '\\\\bprisma\\\\s+migrate\\\\s+reset\\\\b',
  '\\\\bprisma\\\\s+db\\\\s+push\\\\b.*--(force-reset|accept-data-loss)',
];

// Extensions binaires ignorées (aucune attendue dans les gabarits).
const BINARY = /\.(png|jpe?g|gif|ico|woff2?|ttf|pdf|zip)$/i;

function walk(dir, out = []) {
  let entries;
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (!BINARY.test(name)) out.push(full);
  }
  return out;
}

function scanFile(file) {
  const findings = [];
  // Le chemin lui-même compte aussi (un dossier nommé d'après un projet).
  const rel = relative(ROOT, file).split('\\').join('/');
  for (const { label, re } of FORBIDDEN) {
    if (re.test(rel)) findings.push(`${rel}:0 — « ${label} » dans le chemin`);
  }
  const lines = readFileSync(file, 'utf8').replace(/\r\n/g, '\n').split('\n');
  lines.forEach((raw, i) => {
    let line = raw;
    for (const snippet of ALLOWED_SNIPPETS) line = line.split(snippet).join('');
    for (const { label, re } of FORBIDDEN) {
      if (re.test(line)) {
        findings.push(`${rel}:${i + 1} — « ${label} » : ${raw.trim().slice(0, 120)}`);
      }
    }
  });
  return findings;
}

const files = walk(TEMPLATES);
if (files.length === 0) {
  console.error('check-generic : aucun fichier trouvé dans templates/.');
  process.exit(1);
}

const findings = files.flatMap(scanFile);
if (findings.length > 0) {
  console.error(`check-generic : ${findings.length} référence(s) propre(s) à un projet :`);
  for (const f of findings) console.error(`  ${f}`);
  process.exit(1);
}

console.log(`check-generic : ${files.length} fichier(s) de gabarit vérifié(s), aucune référence propre à un projet.`);
