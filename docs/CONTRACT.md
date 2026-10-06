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
- Chaque script `.cjs` livré porte, juste après le shebang, l'en-tête
  `/* eslint-disable -- … */` : les `require()` voulus d'un script CommonJS
  ne doivent pas faire échouer le lint du projet cible (par exemple
  `@typescript-eslint/no-require-imports` d'`eslint-config-next`). La
  désactivation est globale et non ciblée : citer une règle d'un greffon
  absent du projet ferait échouer ESLint (« Definition for rule … was not
  found »).

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

Script `prepare` du fragment `node` : il ne lance
`scripts/install-git-hooks.cjs` que si le fichier existe
(`node -e "require('fs').existsSync(…)&&require(…)"`), pour ne pas casser
une installation où `scripts/` n'est pas encore copié (image Docker qui ne
copie que `package*.json` avant `npm install`). Une commande vide dans
`commands` (par exemple `commands.test`) est gérée explicitement par les
gabarits qui l'utilisent : la CI rend une étape d'avertissement visible au
lieu d'omettre silencieusement les tests, et `/audit` le signale comme
vérification non faite.
| `adapter-codex`  | .codex/config.toml, .codex/agents/*.toml                   |
| `adapter-cursor` | .cursor/rules/acc-standard.mdc                             |
| `demo-instance`  | scripts/demo-instance.cjs piloté par `config.demo`         |

## 5. Modes de propriété

Toute comparaison se fait après normalisation des fins de ligne. `hash` =
SHA-256 hexadécimal du contenu normalisé.

| Mode          | Cible absente | Cible présente |
| ------------- | ------------- | -------------- |
| `managed`     | créer | si contenu = nouveau → rien ; sinon si `hash(actuel)` = hash du manifeste → remplacer ; sinon **conflit** : écrire `<dest>.acc-new`, ne pas toucher `<dest>` (avec `--force`, ou `--adopt` si le fichier n'a jamais été repris — voir ci-dessous : sauvegarder `<dest>` en `<dest>.acc-bak` ou `<dest>.N.acc-bak` puis remplacer) |
| `block`       | créer (fichier rendu complet) | pour chaque bloc du gabarit : bloc présent dans la cible → remplacer son contenu si son hash actuel = hash du manifeste (ou s'il n'y a pas d'entrée et que le contenu est identique), sinon conflit de bloc ; bloc absent → l'ajouter en fin de fichier précédé d'une ligne vide. Les blocs de la cible absents du gabarit sont laissés tels quels. En cas de conflit : écrire `<dest>.acc-new` (fichier proposé complet) et ne rien modifier dans `<dest>` (même règle `--force` / `--adopt` que `managed`). Écrit en plus le squelette `.acc/skeletons/<dest>`, voir ci-dessous |
| `seed`        | créer | ne jamais toucher |
| `merge-json`  | créer (JSON du fragment) | fusion profonde, voir ci-dessous |
| `merge-lines` | créer | ajouter les lignes absentes à la fin, sous un en-tête `# acc-standard` ajouté une seule fois |

Sauvegardes `--force` et `--adopt` (`managed` et `block`) : avant de
remplacer `<dest>`, le moteur le copie en sauvegarde et **n'écrase jamais une
sauvegarde existante**.
La première s'appelle `<dest>.acc-bak` ; si elle existe déjà avec un contenu
différent de `<dest>`, la suivante est `<dest>.2.acc-bak`, puis
`<dest>.3.acc-bak`, etc. Si une sauvegarde existante a déjà exactement le
contenu de `<dest>`, aucune nouvelle copie n'est faite (relancer la même
commande ne multiplie pas les fichiers). Toutes les formes se terminent par
`.acc-bak` : le motif `*.acc-bak` du `.gitignore` posé les couvre. Le plan
annonce le nom réel de la sauvegarde (`forcé, sauvegarde <dest>.2.acc-bak`…)
et `apply` liste dans son rapport chaque sauvegarde créée.

Fusion `merge-lines` — ordre des négations : les lignes de négation du
fragment (commençant par `!`, ex. `!.env.example`) doivent rester après le
motif qu'elles réhabilitent, sans quoi elles perdent leur effet. Si au moins
une ligne non-négation du fragment est ajoutée à la cible, **toutes** les
lignes de négation du fragment sont (ré)écrites à la fin du bloc ajouté, dans
l'ordre du fragment, même si elles existent déjà plus haut dans le fichier
(elles y restent en double : la dernière occurrence fait foi pour Git). Si
aucune ligne non-négation n'est ajoutée, rien n'est écrit — idempotence
stricte, un `apply` répété ne modifie aucun octet.

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

Squelette d'un fichier `block` déjà présent : quand la cible existe avant
que le standard l'ait repris (aucune entrée au manifeste pour `<dest>`) et
qu'elle diffère du fichier rendu, le moteur n'y ajoute que les blocs ; le
texte hors blocs du gabarit (tables, sections « Structure », « Commandes »,
`TODO(acc-adapt)`…) serait perdu. Il écrit donc le fichier rendu complet
dans `.acc/skeletons/<dest>` (même chemin relatif sous `.acc/skeletons/`).
Ce squelette appartient au moteur et n'est jamais une destination de
gabarit ; la compétence `/acc-adapt` y reprend les sections absentes de
`<dest>` (hors blocs, avec leurs `TODO(acc-adapt)`), puis le supprime. Aux
`apply` suivants (entrée présente au manifeste), un squelette encore présent
est tenu à jour ; un squelette supprimé n'est pas recréé. `doctor` signale
les squelettes en attente.

Adoption (`--adopt`) d'un projet déjà équipé : un fichier `managed` ou
`block` en conflit **qui n'a jamais été repris par le standard** — pas
d'entrée au manifeste, ou entrée sans `hash` (`managed`) ou sans hash pour
chaque bloc en conflit (`block`) — est traité comme avec `--force` :
sauvegarde (même numérotation, voir « Sauvegardes » ci-dessus), puis version
du standard posée. Un fichier déjà repris puis modifié localement reste un
conflit (`.acc-new`) ; un `block` aux marqueurs invalides aussi. Le plan
affiche `adopté, sauvegarde <dest>.acc-bak` (ou `<dest>.N.acc-bak`).
L'utilisateur relit ensuite `git diff` (le dépôt était propre) et reporte ce
qui doit l'être (fichiers `seed`, hors blocs) ou propose une évolution du
standard.

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
acc-standard plan   [cible] [--json] [--adopt]
acc-standard apply  [cible] [--branch] [--allow-dirty] [--force] [--adopt] [--dry-run]
acc-standard doctor [cible] [--json]
acc-standard update [cible] [--allow-dirty] [--force] [--adopt]
acc-standard --help | --version
Options communes : --templates <dossier> (défaut templates/ du paquet,
ou variable ACC_TEMPLATES_DIR)
```

- `cible` par défaut : dossier courant.
- `detect` affiche la config proposée ; `--write` l'écrit si absente
  (`--force` pour remplacer).
  - `git.mainBranch` : `refs/remotes/origin/HEAD`, sinon une branche locale
    `main`, sinon `master`, sinon la branche courante, sinon `main`.
    `git.protectedBranches` contient toujours `main` et `master` ; le nom
    obtenu pour `mainBranch` ne s'y ajoute que s'il vient d'`origin/HEAD` —
    jamais un simple repli sur la branche courante ou sur la valeur par
    défaut, pour ne pas protéger la branche de travail sur laquelle `detect`
    est lancé (ce qui bloquerait son propre pre-push).
  - Si TypeScript est détecté (dépendance ou `tsconfig.json`) sans script
    `typecheck`, `commands.typecheck` propose `npx tsc --noEmit` et
    `hooks.preCommit` reçoit le contrôle bloquant correspondant
    (`whenStaged: ["**/*.ts", "**/*.tsx"]`). Le contrôle `lint` (non
    bloquant) reçoit par défaut `whenStaged: ["**/*.{js,jsx,mjs,cjs,ts,tsx}"]`.
  - Next.js ≥ 16 (version majeure lue dans la dépendance `next` du
    `package.json` racine) : le `typecheck` implicite devient
    `npx next typegen && npx tsc --noEmit`, car `tsc` a besoin des types de
    routes générés par Next. Si un script `typecheck` existe sans mentionner
    `typegen`, un avertissement le signale (le script est gardé tel quel).
  - Scripts `prebuild` ou `predev` présents : avertissement — s'ils génèrent
    des fichiers requis par `tsc` ou par les tests, `commands.typecheck`, les
    contrôles `hooks.preCommit` et la CI doivent les lancer d'abord.
  - `Dockerfile` (ou `Dockerfile.*`, `*.Dockerfile`) à la racine ou dans un
    workspace, pour un projet Node : avertissement sur le script `prepare`
    (il tourne pendant l'installation des dépendances de l'image, souvent
    avant la copie de `scripts/`).
  - `ports`, dans cet ordre, sans écraser une clé déjà trouvée : variables
    `PORT` / `<NOM>_PORT` des `.env.example` / `env.example` (racine puis
    workspaces ; jamais un `.env` réel) ; `configurations[].port` de
    `.claude/launch.json` (clé = `name` réduit en slug, `app` à défaut) ; port
    par défaut du cadriciel de chaque paquet — Next.js 3000, Vite 5173 — ou
    celui passé par `-p` / `--port` dans son script `dev` (clé `app` à la
    racine, nom du dossier pour un workspace), sauf si ce numéro figure déjà
    dans `ports`.
  - Si la cible ne ressemble à aucun projet reconnu (aucun de `package.json`,
    `pyproject.toml`, `requirements.txt`, `go.mod`, `Cargo.toml`, aucun dépôt
    git) **et** qu'un vrai projet existe dans un sous-dossier direct
    (profondeur 1 ou 2, hors `node_modules`, `.git`, dossiers cachés — un
    sous-dossier contenant lui-même un `.git` ou un `package.json`) :
    `--write` n'écrit rien et sort en code 1 en listant ces sous-dossiers avec
    la commande à relancer dedans ; sans `--write`, le même avertissement va
    sur stderr en plus de la proposition habituelle. Une cible vide sans
    aucun sous-projet à proximité reste un projet « vierge » ordinaire
    (profil `base`), pas une erreur.
  - Les messages qui invitent à relancer l'outil (ici et dans les autres
    commandes) utilisent la commande réellement exécutable
    `npx github:bkourouma/ACC-STANDARD-ARCHITECTURE`, pas `acc-standard` seul
    (non publié sur le registre npm).
- `plan` et `apply` exigent `acc.config.json` (sinon message qui propose
  `detect --write`, code 1).
- `plan` : une ligne par fichier — `+` créer, `~` mettre à jour, `=`
  inchangé, `·` seed déjà présent, `»` fusion, `!` conflit — puis un total.
- `apply` refuse un dépôt git sale (`git status --porcelain` non vide) ou
  l'absence de dépôt git, sauf `--allow-dirty`. `--branch` crée
  `chore/acc-standard-v<version>` (`git switch -c`) avant d'écrire.
  `--dry-run` = `plan`. `--adopt` : adoption d'un projet déjà équipé (§5).
  Ne lance jamais `git add`, `commit`, `push`. Écrit le manifeste, puis
  affiche les squelettes écrits, les fichiers adoptés, les `nextSteps` des
  profils et la commande de commit suggérée.
- `doctor` : config valide, manifeste présent, fichiers du manifeste présents,
  dérive des `managed` (modifiés localement), `.acc-new` en attente, hooks git
  installés (`.git/hooks/pre-commit` et `pre-push` mentionnent lefthook), hooks
  Claude déclarés dans `.claude/settings.json`, version du standard. En
  avertissement (sans échec) : squelettes `.acc/skeletons/` en attente, et
  script `prepare` du `package.json` qui lance directement
  `node scripts/install-git-hooks.cjs` (forme fragile des projets équipés
  avant la forme tolérante du fragment `node`, voir §4).
- `update` : exécute `migrations/<version>.mjs` pour chaque version strictement
  supérieure à `config.standardVersion` et inférieure ou égale à la version du
  paquet (ordre semver), puis `apply` (avec `--force` / `--adopt` s'ils sont
  donnés), puis met `standardVersion` à jour.
  Signature d'une migration :
  `export default async function migrate({ target, config, log, renameManaged,
  removeManaged }) {}` ; elle peut renommer ou supprimer des fichiers
  **gérés** et modifier `config` (retourner la config modifiée). Les deux
  aides ne détruisent jamais de travail local :
  - `removeManaged(rel)` ne supprime le fichier que s'il est en mode `managed`
    au manifeste **et** que son hash actuel est celui du manifeste. Sinon
    (modifié localement, sans entrée de hash, `seed`, `block`…) le fichier est
    conservé, son entrée quitte le manifeste (il devient propriété du projet)
    et la raison est journalisée. Fichier déjà absent : l'entrée du manifeste
    est simplement retirée.
  - `renameManaged(from, to)` ne remplace jamais une destination existante :
    si `to` existe, `from` reste en place, son entrée quitte le manifeste, un
    message est journalisé, et le `apply` qui suit signale `to` comme conflit
    s'il diffère du gabarit (avec `--force`, ou `--adopt` si `to` n'a pas de
    hash au manifeste, `to` est sauvegardé puis remplacé, comme tout fichier
    en conflit). Si `from` est modifié localement mais que `to`
    est libre, le renommage a lieu et l'entrée du manifeste (ancien hash) est
    reportée sur `to` : la modification locale ressortira en conflit au
    `apply` suivant au lieu d'être écrasée.

Codes de sortie : `0` succès, `1` erreur, `2` terminé avec conflits (ou
`doctor` en échec).

## 8. Garde-fous Claude Code livrés : portée et limites

`.claude/settings.json` (fusionné) et les hooks `.claude/hooks/*.sh` (gérés)
sont un **filet contre les accidents**, pas une barrière contre un agent qui
contourne. Ce qu'ils garantissent et ce qu'ils ne garantissent pas :

- `validate-bash.sh` est une liste noire d'expressions régulières appliquée au
  texte de la commande. Il lit les options globales de git (`git -C dossier
  push`, `git -c k=v …`), la cible d'une poussée citée (`git push origin
  "main"`), `push --mirror` et la suppression ou le renommage d'une branche
  protégée (`git branch -D main`). Il ne voit pas ce qui est construit
  dynamiquement (variable, `git push origin HEAD` depuis une branche protégée,
  scripts, `node -e`…) ni le reste de ce qui est cité entre guillemets.
  `docs/governance/SECURITY.md` et la protection de branche de l'hébergeur
  restent la protection de dernier recours.
- Les deux hooks **échouent ouverts** : outil absent, entrée illisible ou
  exception → `exit 0`. Sous Windows sans bash, le hook n'est pas exécuté.
- `settings.json` empêche l'agent de modifier ses propres garde-fous :
  `permissions.deny` refuse Edit et Write sur `.claude/hooks/**`, et
  `permissions.ask` impose une confirmation humaine pour Edit et Write sur
  `.claude/settings.json` et `acc.config.json` (qui contient `guard.*`,
  `git.protectedBranches` et `hooks.preCommit`). `ask` et non `deny` : la
  compétence `/acc-adapt` doit pouvoir proposer des corrections à
  `acc.config.json`. Ces règles ne couvrent pas une modification faite par
  une commande shell (`sed -i`, redirection…).
- Le moteur (`acc-standard apply`) n'est pas concerné par ces règles : il
  tourne hors de Claude Code, sous la responsabilité de l'humain.
- Le comportement des hooks est vérifié par `test/hooks.test.mjs`. Une limite
  connue y est écrite comme test `todo` : elle se corrige en retirant le
  `todo`, jamais en l'effaçant.
