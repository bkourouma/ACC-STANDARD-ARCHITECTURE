# Passation de session — {{project.name}}

Carnet de reprise entre sessions d'agents. **Lire en premier** en début de
session ; **mettre à jour sans l'annoncer** avant de conclure tout tour en
plusieurs étapes (règle posée dans AGENTS.md et CLAUDE.md).

## Mode d'emploi

- Une section par branche, la plus récente en haut. Réécrire la section de sa
  branche au lieu d'empiler des entrées : ce fichier décrit l'état présent, pas
  l'historique (l'historique, c'est `git log`).
- Supprimer la section d'une branche une fois fusionnée dans
  `{{git.mainBranch}}`.
- Dates absolues (`AAAA-MM-JJ`), jamais « hier ».
- Chaque worktree a sa copie : en cas de conflit à la fusion, garder les deux
  sections de branche, elles sont indépendantes.
- Le suivi anomalie par anomalie vit dans le bus d'agents (`.agent-bus/`), pas
  ici.
- Pas de secret, pas de donnée personnelle, pas de contenu de `.env`.

Modèle de section :

```markdown
## Branche `type/sujet` — AAAA-MM-JJ

**État :** en cours | prêt à relire | bloqué
**Dernier commit :** `abc1234` résumé

Fait :

- …

Reste à faire :

- …

Pièges et décisions :

- …
```

---

## Installation du standard agentique — {{standard.version}}

**État :** à adapter
**Dernier commit :** à renseigner après le commit d'installation

Fait :

- Architecture agentique `acc-standard` {{standard.version}} posée
  (profils : {{profiles}}).

Reste à faire :

- Lancer `/acc-adapt` pour remplir les `TODO(acc-adapt)` et les fichiers seed.
- Installer les hooks git (`node scripts/install-git-hooks.cjs`) puis
  vérifier avec `npx github:bkourouma/ACC-STANDARD-ARCHITECTURE doctor`.

Pièges et décisions :

- Les fichiers gérés (voir `.acc/manifest.json`) ne se modifient pas
  localement : `npx github:bkourouma/ACC-STANDARD-ARCHITECTURE update` les remplacerait ou signalerait un
  conflit.
