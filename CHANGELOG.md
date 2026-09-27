# Journal des versions

Format : versionnement sémantique. Une version mineure ou majeure qui renomme
ou supprime un fichier géré fournit `migrations/<version>.mjs`.

## Non publié

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
