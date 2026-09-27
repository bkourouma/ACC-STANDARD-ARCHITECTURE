# Consignes pour les agents IA — ACC-STANDARD-ARCHITECTURE

Ce dépôt produit la commande `acc-standard`, qui installe l'architecture
agentique standard dans d'autres projets. Ce fichier prime sur tout autre
document du dépôt.

## Structure

```text
bin/acc-standard.mjs   point d'entrée de la commande
src/                   moteur : détection, gabarits, modes de propriété, manifeste
templates/<profil>/    profile.json + files/ : ce qui est posé dans les projets cibles
migrations/            une migration par version qui renomme ou supprime un fichier géré
test/                  tests node:test et projets factices (test/fixtures/)
scripts/check-generic.mjs  refuse toute référence propre à un projet dans templates/
docs/CONTRACT.md       interface moteur ↔ gabarits : la lire avant toute modification
```

## Commandes

```bash
npm test                # tous les tests
npm run check:generic   # gabarits sans référence propre à un projet
```

## Règles

- **Contrat d'abord.** Toute évolution de l'interface entre `src/` et
  `templates/` modifie d'abord `docs/CONTRACT.md`.
- **Zéro dépendance d'exécution**, Node ≥ 20, ESM côté moteur ; CommonJS
  sans dépendance pour les scripts `.cjs` livrés dans les gabarits ; bash
  compatible Git Bash, sans `jq`, pour les hooks.
- **Windows d'abord** : chemins via `node:path`, contenus comparés après
  normalisation des fins de ligne, fichiers écrits en LF.
- **Gabarits génériques.** Aucun nom de projet, port, chemin de monorepo ou
  terme métier en dur : ils viennent de `acc.config.json` (rendu ou lecture à
  l'exécution). `npm run check:generic` doit passer.
- **Ne jamais détruire.** Un fichier modifié localement dans un projet cible
  n'est jamais écrasé sans `--force` (et alors sauvegardé en `.acc-bak`). Le
  moteur ne lance jamais `git add`, `commit` ni `push` dans un projet cible et
  refuse toute destination `.env`.
- **Idempotence.** `apply` lancé deux fois ne change aucun octet la deuxième
  fois ; un test le vérifie pour chaque projet factice.
- **Versions.** Un renommage ou une suppression de fichier géré exige une
  migration et une entrée dans `CHANGELOG.md` ; la version du paquet suit le
  versionnement sémantique.
- Textes, commentaires et messages en français.

## Git

Branche `type/sujet` par changement, commits conventionnels en français, pull
request vers `main`. Jamais de poussée directe ou forcée sur `main`, jamais
`--no-verify`.
