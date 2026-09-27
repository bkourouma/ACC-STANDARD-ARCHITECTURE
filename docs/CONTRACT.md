# Contrat entre le moteur et les gabarits

Ce document fixe l'interface entre le moteur (`bin/`, `src/`) et les gabarits
(`templates/`, `migrations/`). Les deux côtés s'y conforment ; toute évolution
passe d'abord par ce fichier.

Version du standard : `0.1.0` (champ `version` du `package.json`).
Source d'extraction : dépôt ImmoTopia, branche `chore/agentic-architecture`,
commit `81313c5`.

## 1. Environnement

- Node ≥ 20, ESM (`"type": "module"`), **zéro dépendance d'exécution**.
- Tests : `node --test` (module `node:test`), aucune bibliothèque externe.
- Windows, macOS, Linux. Chemins construits avec `node:path`, comparaisons de
  contenu après normalisation `\r\n` → `\n`. Fichiers écrits en LF, UTF-8 sans
  BOM, avec une fin de ligne finale.
- Les scripts livrés dans les gabarits (`.cjs`, `.sh`) tournent dans le projet
  cible : CommonJS, zéro dépendance, Node 20 ; bash compatible Git Bash, sans
  `jq`.

## 2. `acc.config.json` (à la racine du projet cible, commité)

```jsonc
{
  "standardVersion": "0.1.0",
  "project": {
    "name": "MonProjet",          // nom affiché
    "slug": "monprojet",          // [a-z0-9-], dérivé du nom
    "description": "",
    "language": "fr"              // seule valeur gérée pour l'instant
  },
  "profiles": ["base", "node"],   // voir §4 ; "base" toujours présent
  "adapters": ["claude"],         // "claude" | "codex" | "cursor"
  "stack": {
    "packageManager": "npm",      // npm | pnpm | yarn | bun | none
    "workspaces": false,
    "typescript": true,
    "eslint": true,
    "prettier": true,
    "languages": ["javascript"]   // javascript | typescript | python | go | …
  },
  "commands": {                   // chaîne vide = absente
    "install": "npm install",
    "dev": "npm run dev",
    "build": "npm run build",
    "typecheck": "npm run typecheck",
    "lint": "npm run lint",
    "test": "npm test"
  },
  "ports": {},                    // ex. { "web": 3000, "api": 8001 }
  "git": {
    "mainBranch": "main",
    "protectedBranches": ["main", "master"]
  },
  "hooks": {
    "preCommit": [                // lancés par .claude/hooks/pre-commit.sh
      {                           // avant un `git commit` d'un agent
        "name": "typecheck",
        "command": "npm run typecheck",
        "blocking": true,         // false = avertissement seulement
        "whenStaged": ["**/*.ts", "**/*.tsx"] // glob ; vide = toujours
      }
    ]
  },
  "guard": {                      // lus par .claude/hooks/validate-bash.sh
    "protectedPaths": ["src"],    // `rm -rf` refusé sur ces dossiers
    "destructiveCommands": [      // regex JS (chaîne) + raison
      { "pattern": "\\bprisma\\s+migrate\\s+reset\\b", "reason": "…" }
    ]
  },
  "options": {
    "agentBus": true,             // scripts/agent-bus.cjs + .agent-bus/
    "demoInstance": false         // profil optionnel demo-instance
  },
  "demo": {}                      // réservé au profil demo-instance
}
```

Règles :

- `detect` propose toutes ces clés ; l'humain relit. Les clés inconnues sont
  conservées telles quelles par le moteur.
- Les scripts des gabarits lisent `acc.config.json` **à l'exécution** (depuis
  `$CLAUDE_PROJECT_DIR` ou la racine git) et tolèrent son absence ou une clé
  manquante (valeurs par défaut sûres, jamais d'exception non rattrapée).
  Ainsi un fichier `managed` est identique d'un projet à l'autre et ne
  nécessite pas de rendu.

## 3. Arborescence des gabarits

```text
templates/<profil>/profile.json
templates/<profil>/files/<chemin source>
```

### `profile.json`

```jsonc
{
  "id": "base",
  "description": "Architecture agentique commune",
  "requires": [],                 // profils à appliquer avant
  "files": [
    {
      "src": "AGENTS.md",         // relatif à files/
      "dest": "AGENTS.md",        // relatif à la racine cible ; peut contenir {{…}}
      "mode": "block",            // managed | block | seed | merge-json | merge-lines
      "render": true,             // passe par le moteur de gabarit (défaut false)
      "when": "options.agentBus", // condition facultative (chemin dans la config)
      "executable": false         // chmod 755 après écriture (sans effet Windows)
    }
  ],
  "nextSteps": ["Lancer /acc-adapt dans Claude Code"] // affichés après apply
}
```

Sélection des profils : `config.profiles` + `adapter-<a>` pour chaque adapter
autre que `claude` + `demo-instance` si `options.demoInstance`. Les `requires`
sont résolus d'abord, sans doublon, dans l'ordre de déclaration. Si deux
profils visent la même `dest`, c'est une erreur de gabarit sauf en mode
`merge-json` ou `merge-lines` (les fragments se cumulent dans l'ordre).

### Moteur de gabarit (`render: true`)

- `{{chemin.dans.config}}` → valeur ; tableau → éléments joints par `, ` ;
  absent → chaîne vide.
- `{{#if chemin}}…{{else}}…{{/if}}` et `{{#unless chemin}}…{{/unless}}`,
  imbriquables. Vrai = valeur non vide, non nulle, non `false`, tableau non
  vide.
- `{{#each chemin}}…{{this}}…{{/each}}` pour un tableau de chaînes ; pour un
  tableau d'objets, `{{this.cle}}`.
- `\{{` produit un `{{` littéral.
- Contexte disponible : la config entière, plus `standard.version` et
  `standard.sourceCommit`.
- Les lignes ne contenant qu'une balise de bloc (`{{#if}}`, `{{/if}}`, …)
  disparaissent entièrement (pas de ligne vide résiduelle).

## 4. Profils prévus

| Profil           | Contenu                                                    |
| ---------------- | ---------------------------------------------------------- |
| `base`           | AGENTS.md, CLAUDE.md, docs/workflows, .claude (agents, hooks, rules, skills, settings), scripts git et bus, .lefthook.yml, .gitignore, .editorconfig, .gitattributes |
| `node`           | fragments package.json (scripts, devDependencies, lint-staged), repomix, .mcp.json, CI GitHub Actions |
| `adapter-codex`  | .codex/config.toml, .codex/agents/*.toml                   |
| `adapter-cursor` | .cursor/rules/acc-standard.mdc                             |
| `demo-instance`  | scripts/demo-instance.cjs piloté par `config.demo`         |

## 5. Modes de propriété

Toute comparaison se fait après normalisation des fins de ligne. `hash` =
SHA-256 hexadécimal du contenu normalisé.

| Mode          | Cible absente | Cible présente |
| ------------- | ------------- | -------------- |
| `managed`     | créer | si contenu = nouveau → rien ; sinon si `hash(actuel)` = hash du manifeste → remplacer ; sinon **conflit** : écrire `<dest>.acc-new`, ne pas toucher `<dest>` (avec `--force` : copier `<dest>` en `<dest>.acc-bak` puis remplacer) |
| `block`       | créer (fichier rendu complet) | pour chaque bloc du gabarit : bloc présent dans la cible → remplacer son contenu si son hash actuel = hash du manifeste (ou s'il n'y a pas d'entrée et que le contenu est identique), sinon conflit de bloc ; bloc absent → l'ajouter en fin de fichier précédé d'une ligne vide. Les blocs de la cible absents du gabarit sont laissés tels quels. En cas de conflit : écrire `<dest>.acc-new` (fichier proposé complet) et ne rien modifier dans `<dest>` |
| `seed`        | créer | ne jamais toucher |
| `merge-json`  | créer (JSON du fragment) | fusion profonde, voir ci-dessous |
| `merge-lines` | créer | ajouter les lignes absentes à la fin, sous un en-tête `# acc-standard` ajouté une seule fois |

Marqueurs de bloc (Markdown) :

```text
<!-- acc:begin <id> -->
…contenu géré…
<!-- acc:end <id> -->
```

Le contenu d'un bloc = texte strictement entre les deux lignes marqueurs. Le
texte hors blocs d'un gabarit `block` n'est utilisé qu'à la création : il est
ensuite la propriété du projet (et contient des `TODO(acc-adapt)` que la
compétence `/acc-adapt` remplace).

Fusion `merge-json` :

- objets : fusion récursive ; clé absente → ajoutée ; scalaire présent des
  deux côtés → **la cible gagne**.
- tableaux de scalaires : union, ordre de la cible puis nouveautés.
- tableaux d'objets possédant une clé `matcher` (hooks Claude Code) : fusion
  des entrées de même `matcher` ; dans une entrée, le tableau `hooks` est
  uni en dédoublonnant par `command`.
- autres tableaux d'objets : union par égalité profonde.
- sortie : indentation détectée de la cible (2 espaces par défaut), ordre des
  clés de la cible conservé, nouvelles clés à la fin, fin de ligne finale.
- JSON cible illisible → conflit (`<dest>.acc-new` contient le fragment).

Interdit absolu : aucune `dest` ne peut correspondre à `.env` ou `.env.*`
(sauf `.env.example`) ; le moteur refuse le gabarit.

## 6. Manifeste `.acc/manifest.json` (commité dans le projet cible)

```json
{
  "standardVersion": "0.1.0",
  "sourceCommit": "81313c5",
  "appliedAt": "2026-09-27T12:00:00.000Z",
  "files": {
    ".claude/hooks/validate-bash.sh": { "mode": "managed", "profile": "base", "hash": "…" },
    "AGENTS.md": { "mode": "block", "profile": "base", "blocks": { "agent-workflows": "…" } },
    "docs/workflows/HANDOFF.md": { "mode": "seed", "profile": "base" },
    ".claude/settings.json": { "mode": "merge-json", "profile": "base" }
  }
}
```

En cas de conflit, l'entrée du manifeste garde l'ancien hash (le fichier n'a
pas été repris par le standard).

## 7. Commandes

```text
acc-standard detect [cible] [--write] [--force]
acc-standard plan   [cible] [--json]
acc-standard apply  [cible] [--branch] [--allow-dirty] [--force] [--dry-run]
acc-standard doctor [cible] [--json]
acc-standard update [cible] [--allow-dirty] [--force]
acc-standard --help | --version
Options communes : --templates <dossier> (défaut templates/ du paquet,
ou variable ACC_TEMPLATES_DIR)
```

- `cible` par défaut : dossier courant.
- `detect` affiche la config proposée ; `--write` l'écrit si absente
  (`--force` pour remplacer).
- `plan` et `apply` exigent `acc.config.json` (sinon message qui propose
  `detect --write`, code 1).
- `plan` : une ligne par fichier — `+` créer, `~` mettre à jour, `=`
  inchangé, `·` seed déjà présent, `»` fusion, `!` conflit — puis un total.
- `apply` refuse un dépôt git sale (`git status --porcelain` non vide) ou
  l'absence de dépôt git, sauf `--allow-dirty`. `--branch` crée
  `chore/acc-standard-v<version>` (`git switch -c`) avant d'écrire.
  `--dry-run` = `plan`. Ne lance jamais `git add`, `commit`, `push`. Écrit le
  manifeste, puis affiche les `nextSteps` des profils et la commande de commit
  suggérée.
- `doctor` : config valide, manifeste présent, fichiers du manifeste présents,
  dérive des `managed` (modifiés localement), `.acc-new` en attente, hooks git
  installés (`.git/hooks/pre-commit` et `pre-push` mentionnent lefthook), hooks
  Claude déclarés dans `.claude/settings.json`, version du standard.
- `update` : exécute `migrations/<version>.mjs` pour chaque version strictement
  supérieure à `config.standardVersion` et inférieure ou égale à la version du
  paquet (ordre semver), puis `apply`, puis met `standardVersion` à jour.
  Signature d'une migration :
  `export default async function migrate({ target, config, log }) {}` ; elle
  peut renommer ou supprimer des fichiers **gérés** et modifier `config`
  (retourner la config modifiée).

Codes de sortie : `0` succès, `1` erreur, `2` terminé avec conflits (ou
`doctor` en échec).
