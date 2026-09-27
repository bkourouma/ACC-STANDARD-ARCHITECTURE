# Journal des versions

Format : versionnement sémantique. Une version mineure ou majeure qui renomme
ou supprime un fichier géré fournit `migrations/<version>.mjs`.

## 0.1.0 — 2026-09-27

Première version, extraite d'ImmoTopia (branche `chore/agentic-architecture`,
commit `81313c5`).

- Commande `acc-standard` : `detect`, `plan`, `apply`, `doctor`, `update`.
- Modes de propriété `managed`, `block`, `seed`, `merge-json`, `merge-lines`
  et manifeste `.acc/manifest.json`.
- Profils `base`, `node`, `adapter-codex`, `adapter-cursor`, `demo-instance`.
- Compétence `/acc-adapt` pour la personnalisation par Claude.
