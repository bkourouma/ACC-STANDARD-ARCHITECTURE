# Journal des versions

Format : versionnement sémantique. Une version mineure ou majeure qui renomme
ou supprime un fichier géré fournit `migrations/<version>.mjs`.

## Non publié

- Correction (`apply --force`, `--adopt`) : une sauvegarde existante n'est
  plus jamais écrasée. La première reste `<fichier>.acc-bak`, les suivantes
  sont `<fichier>.2.acc-bak`, `.3.acc-bak`… ; une sauvegarde identique au
  fichier est réutilisée. `apply` liste les sauvegardes créées.
- Correction (`update`) : `removeManaged` ne supprime plus un fichier modifié
  localement, et `renameManaged` n'écrase plus une destination existante. Dans
  les deux cas le fichier est conservé, quitte le manifeste et le journal en
  donne la raison (`docs/CONTRACT.md` §7).
- Sécurité (gabarit `base`) : `.claude/settings.json` refuse à l'agent
  l'édition de `.claude/hooks/**` et demande confirmation avant toute édition
  de `.claude/settings.json` et d'`acc.config.json` (qui porte `guard.*`).
  AGENTS.md et CLAUDE.md disent que les hooks sont un filet contre les
  accidents, pas une barrière. Les limites connues sont décrites dans
  `docs/CONTRACT.md` §8.
- Tests : les hooks `validate-bash.sh` et `pre-commit.sh` sont exécutés pour de
  vrai (`test/hooks.test.mjs`, 7 limites connues en `todo`) et les gabarits
  réels sont appliqués sur les projets factices, avec contrôle d'idempotence
  (`test/templates-reelles.test.mjs`). Jusqu'ici, seuls des gabarits de
  maquette étaient testés.

Retours du premier essai réel (site Next.js 16) :

- Correction (gabarits) : les scripts `.cjs` gérés (`agent-bus`,
  `pre-push-guard`, `install-git-hooks`, `demo-instance`) portent un en-tête
  `/* eslint-disable -- … */` après le shebang ; ils ne font plus échouer le
  lint d'`eslint-config-next` (`@typescript-eslint/no-require-imports`). Un
  projet qui avait posé sa propre exception peut la retirer (sinon ESLint
  signale seulement une directive inutilisée, en avertissement).
- Correction (profil `node`) : le script `prepare` ne lance
  `scripts/install-git-hooks.cjs` que si le fichier existe ; il ne casse
  plus une image Docker qui ne copie que `package*.json` avant
  `npm install`. Un `prepare` existant n'est pas modifié (fusion : la cible
  gagne) : `doctor` signale désormais la forme fragile et donne la forme
  tolérante, et `detect` avertit de la présence d'un `Dockerfile`.
- Nouveauté (mode `block`) : quand `AGENTS.md` ou `CLAUDE.md` existent déjà,
  le fichier complet du standard (tables, « Structure réelle »,
  « Commandes », `TODO(acc-adapt)`) est écrit dans `.acc/skeletons/<fichier>` ;
  `/acc-adapt` y reprend les sections absentes puis le supprime, `doctor`
  signale les squelettes en attente.
- Nouveauté (`apply`, `plan`, `update`) : option `--adopt` pour un projet
  déjà équipé — les fichiers `managed` / `block` en conflit qui n'ont jamais
  été repris par le standard sont remplacés avec sauvegarde `.acc-bak` au
  lieu de produire des `.acc-new` ; un fichier déjà repris puis modifié
  reste un conflit.
- Amélioration (`detect`) : Next.js ≥ 16 → `typecheck` implicite
  `npx next typegen && npx tsc --noEmit`, avertissement si un script
  `typecheck` existant ne lance pas `typegen`, et avertissement sur les
  scripts `prebuild` / `predev` qui peuvent générer des fichiers requis par
  `tsc`.
- Amélioration (`detect`) : `ports` lit aussi `.claude/launch.json` et le
  port par défaut du cadriciel (Next.js 3000, Vite 5173, ou `-p` / `--port`
  du script `dev`), sans doublon de numéro.
- Gabarits : le RUNBOOK recommande d'installer les dépendances dans un
  worktree et réserve la jonction `node_modules` aux outils qui la tolèrent
  (pas Turbopack) ; la CI rend une étape d'avertissement visible quand
  `commands.test` est vide, et `/audit` le signale comme vérification non
  faite au lieu de supposer une commande.

- Correction (`detect`) : `git.mainBranch` ne se rabat plus sur la branche
  courante avant d'avoir cherché une branche locale `main` puis `master`, et
  `git.protectedBranches` n'inclut plus jamais cette branche courante par
  défaut — évite qu'un pre-push bloque la branche de travail elle-même.
- Amélioration (`detect`) : propose `npx tsc --noEmit` comme `typecheck`
  implicite quand TypeScript est détecté sans script dédié, avec le contrôle
  preCommit bloquant correspondant ; le contrôle `lint` reçoit par défaut un
  `whenStaged` sur les fichiers JS/TS au lieu d'un déclenchement systématique.
- Correction (messages) : les invitations à relancer la commande (après
  `detect --write`, dans `--help`, etc.) donnent désormais une commande
  réellement exécutable (`npx github:bkourouma/ACC-STANDARD-ARCHITECTURE`)
  au lieu de `acc-standard` seul, qui suppose une installation locale.
- Correction (`merge-lines`) : quand au moins une ligne de motif est ajoutée,
  les lignes de négation (`!…`) du fragment sont désormais réécrites en bloc
  à la fin, dans l'ordre du fragment, même si elles existent déjà plus haut
  dans le fichier — sinon une négation déjà présente restait avant le motif
  qu'elle réhabilite et perdait son effet (ex. `!.env.example` avant
  `.env.*`, qui redevenait ignoré). Idempotent : sans ligne de motif ajoutée,
  rien ne change.
- Correction (`detect`) : si la cible ne ressemble à aucun projet reconnu et
  qu'un vrai projet est trouvé dans un sous-dossier proche, `--write` n'écrit
  rien et sort en erreur en listant ces sous-dossiers avec la commande à
  relancer dedans ; sans `--write`, le même avertissement s'affiche sur
  stderr en plus de la proposition.

## 0.1.0 — 2026-09-27

Première version, extraite d'ImmoTopia (branche `chore/agentic-architecture`,
commit `81313c5`).

- Commande `acc-standard` : `detect`, `plan`, `apply`, `doctor`, `update`.
- Modes de propriété `managed`, `block`, `seed`, `merge-json`, `merge-lines`
  et manifeste `.acc/manifest.json`.
- Profils `base`, `node`, `adapter-codex`, `adapter-cursor`, `demo-instance`.
- Compétence `/acc-adapt` pour la personnalisation par Claude.
