# ACC-STANDARD-ARCHITECTURE

Met à niveau un projet vers l'architecture agentique standard, en une ligne de
commande : consignes pour agents IA (`AGENTS.md`, `CLAUDE.md`), processus de
développement et de recette, sous-agents Claude Code, hooks de garde-fous,
hooks git, bus d'anomalies, adaptateurs Codex et Cursor.

Le standard est extrait d'ImmoTopia (branche `chore/agentic-architecture`,
commit `81313c5`) et rendu générique.

## Principe

1. **La commande** `acc-standard`, déterministe et sans IA, repère le projet,
   pose les fichiers communs et fusionne les configurations sans rien écraser.
   On peut la relancer sans risque.
2. **La compétence `/acc-adapt`**, installée dans le projet cible, fait
   remplir par Claude ce qui dépend du projet : règles, grille de relecture,
   modèle de menace, RUNBOOK, compétence de lancement.

## Utilisation

Node 20 ou plus récent. Depuis le dossier du projet à mettre à niveau :

```bash
npx github:bkourouma/ACC-STANDARD-ARCHITECTURE detect --write
```

Relire et corriger `acc.config.json`, puis :

```bash
npx github:bkourouma/ACC-STANDARD-ARCHITECTURE plan
```

```bash
npx github:bkourouma/ACC-STANDARD-ARCHITECTURE apply --branch
```

Ensuite : installer les dépendances, `node scripts/install-git-hooks.cjs`,
ouvrir Claude Code dans le projet et lancer `/acc-adapt`, relire, commiter.

Depuis un clone local, remplacer `npx github:…` par
`node D:/APP/ACC-STANDARD-ARCHITECTURE/bin/acc-standard.mjs`.

| Commande | Effet |
| --- | --- |
| `detect [cible] [--write]` | Propose `acc.config.json` à partir du projet |
| `plan [cible] [--json]` | Simulation : `+` créer, `~` mettre à jour, `=` inchangé, `·` seed présent, `»` fusion, `!` conflit |
| `apply [cible] [--branch] [--allow-dirty] [--force]` | Applique et écrit `.acc/manifest.json` ; ne commite jamais |
| `doctor [cible]` | Vérifie hooks installés, fichiers présents, dérives locales, conflits en attente |
| `update [cible]` | Migrations vers la version courante du standard, puis `apply` |

## Modes de propriété

Chaque fichier posé a un propriétaire, ce qui garantit qu'une mise à jour ne
détruit rien :

- **managed** : appartient au standard. Remplacé à la mise à jour, sauf s'il a
  été modifié sur place ; dans ce cas il y a conflit et un fichier `.acc-new`
  est écrit à côté.
- **block** : seules les sections `<!-- acc:begin id -->` … `<!-- acc:end id -->`
  sont gérées ; le reste appartient au projet.
- **seed** : écrit une fois s'il est absent, puis appartient au projet.
- **merge-json** / **merge-lines** : fusion sans suppression (`settings.json`,
  `package.json`, `.mcp.json`, `.gitignore`).

Avec `--force`, le fichier remplacé est d'abord sauvegardé en `.acc-bak`, puis
`.2.acc-bak`, `.3.acc-bak`… : une sauvegarde n'est jamais écrasée.

La spécification complète est dans [docs/CONTRACT.md](docs/CONTRACT.md).

## Portée des garde-fous

Les hooks Claude Code livrés (`validate-bash.sh`, `pre-commit.sh`) sont un
filet contre les accidents, pas une barrière : `validate-bash.sh` est une liste
noire d'expressions régulières qui ne voit ni une branche construite par
variable, ni `git -C`, ni un script, et les deux hooks échouent ouverts. Gardez
la protection de branche de votre hébergeur. Les limites connues sont listées
dans [docs/CONTRACT.md](docs/CONTRACT.md) §8 et écrites en tests `todo`
(`test/hooks.test.mjs`).

## Profils

| Profil | Contenu |
| --- | --- |
| `base` | AGENTS.md, CLAUDE.md, processus (`docs/workflows`), sous-agents, hooks Claude, règles, compétences, hooks git, bus d'anomalies |
| `node` | scripts et devDependencies `package.json`, lint-staged, Repomix, MCP chrome-devtools, CI |
| `adapter-codex` | `.codex/config.toml`, profils d'agents Codex |
| `adapter-cursor` | règle Cursor qui renvoie à AGENTS.md |
| `demo-instance` | instance de démo figée pour la recette navigateur |

## Développer le standard

```bash
npm test
```

```bash
npm run check:generic
```

`check:generic` échoue si un gabarit contient encore une référence propre à
ImmoTopia. Toute évolution de l'interface entre moteur et gabarits passe
d'abord par `docs/CONTRACT.md`. Un renommage ou une suppression de fichier
géré s'accompagne d'une migration `migrations/<version>.mjs` et d'une entrée
dans `CHANGELOG.md`.
