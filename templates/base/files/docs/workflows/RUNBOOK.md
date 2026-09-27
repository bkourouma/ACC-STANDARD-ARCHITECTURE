# Runbook — {{project.name}}

Lancer, configurer et dépanner le projet. En cas de désaccord avec
[AGENTS.md](../../AGENTS.md), AGENTS.md prime.

## Prérequis

TODO(acc-adapt) : versions des outils (runtime, gestionnaire de paquets, base
de données, services externes) et comment les vérifier.

## Installation

```bash
{{#if commands.install}}
{{commands.install}}
{{else}}
# TODO(acc-adapt) : commande d'installation
{{/if}}
node scripts/install-git-hooks.cjs    # hooks git Lefthook
```

### Fichiers d'environnement

TODO(acc-adapt) : fichiers `.env.example` à copier, variables obligatoires et
leur rôle (jamais leur valeur). Les agents ne lisent ni n'écrivent les `.env` :
leur création revient à l'utilisateur.

## Lancer

```bash
{{#if commands.dev}}
{{commands.dev}}
{{else}}
# TODO(acc-adapt) : commande de lancement en développement
{{/if}}
```

## Ports

TODO(acc-adapt) : un tableau service → port, aligné sur `ports` dans
`acc.config.json`, et les variables qui doivent rester cohérentes entre
services (origines autorisées, URL d'API…).

## Commandes quotidiennes

```bash
{{#if commands.typecheck}}
{{commands.typecheck}}
{{/if}}
{{#if commands.lint}}
{{commands.lint}}
{{/if}}
{{#if commands.test}}
{{commands.test}}
{{/if}}
{{#if commands.build}}
{{commands.build}}
{{/if}}
```

{{#if options.agentBus}}
## Bus d'agents

`.agent-bus/` (racine du checkout principal, commun à tous les worktrees,
ignoré par git, surchargeable par `AGENT_BUS_DIR`) porte les anomalies et le
journal des révisions échangés entre développement et recette :

```bash
node scripts/agent-bus.cjs help
node scripts/agent-bus.cjs list --state "prêt au retest"
```

{{/if}}
## Worktrees git (`.claude/worktrees/*`)

Un `git worktree` n'a pas ses propres dépendances installées : les hooks git
(Lefthook, lint-staged) et les commandes du projet y échouent tant qu'elles ne
sont pas résolvables. Avant tout `git commit` dans un worktree, installer les
dépendances dans le worktree (choix par défaut, toujours sûr).

Un lien vers les dépendances du checkout principal (sous Windows, une
jonction : `mklink /J "<worktree>\node_modules" "<checkout principal>\node_modules"`)
évite une installation, mais seulement pour des outils qui suivent les liens
sans vérifier où ils mènent (hooks git, lint, typecheck). Il est à proscrire
quand un outil refuse un `node_modules` situé hors de la racine du projet :
c'est le cas de Turbopack (bundler par défaut de Next.js à partir de la
version 16), qui échoue au `dev` comme au `build` avec un lien symbolique ou
une jonction qui sort du dossier. Un lien partagé désynchronise aussi les
artefacts générés dans `node_modules` (client de base de données, types
générés…) quand les deux checkouts sont sur des révisions différentes.

TODO(acc-adapt) : préciser les dossiers de dépendances du projet, si un lien
est acceptable ici (bundler, outils) et les artefacts générés qu'il
désynchronise.

## Dépannage

### Hooks Lefthook

`.lefthook.yml` déclare un hook `pre-push` (`scripts/pre-push-guard.cjs`) qui
refuse une poussée vers une branche protégée (`git.protectedBranches`
d'`acc.config.json`). Un refus se corrige (passer par une branche puis une
PR), il ne se contourne pas. `npx github:bkourouma/ACC-STANDARD-ARCHITECTURE doctor` vérifie que les hooks
sont installés.

{{#if stack.eslint}}
### `lint-staged` bloqué sous Windows

Les commandes de `lint-staged` appellent les points d'entrée JS des outils
(`node node_modules/eslint/bin/eslint.js`) plutôt que les raccourcis
`node_modules/.bin/*.cmd` : sous Windows, `lint-staged` peut se bloquer sans
erreur quand un raccourci `.cmd` reçoit de nombreux fichiers en arguments. Ne
pas revenir à ces raccourcis.

{{else}}
{{#if stack.prettier}}
### `lint-staged` bloqué sous Windows

Les commandes de `lint-staged` appellent les points d'entrée JS des outils
(`node node_modules/prettier/bin/prettier.cjs`) plutôt que les raccourcis
`node_modules/.bin/*.cmd` : sous Windows, `lint-staged` peut se bloquer sans
erreur quand un raccourci `.cmd` reçoit de nombreux fichiers en arguments. Ne
pas revenir à ces raccourcis.

{{/if}}
{{/if}}
### Autres pannes connues

TODO(acc-adapt) : symptômes réellement rencontrés, cause et correctif (port
occupé, secret refusé au démarrage, origine refusée, tests lents…).
