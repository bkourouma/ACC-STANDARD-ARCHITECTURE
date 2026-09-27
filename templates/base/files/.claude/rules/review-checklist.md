---
# TODO(acc-adapt) : remplacer par les chemins réels du code applicatif
# (ex. "src/**/*.ts"). Cette règle se charge quand un fichier couvert est lu
# ou modifié ; code-reviewer et security-auditor la lisent toujours.
paths:
  - "**/*"
---

# Contrôles de relecture propres à {{project.name}}

Complète le tronc commun de `.claude/agents/code-reviewer.md` et
`.claude/agents/security-auditor.md`. AGENTS.md prime en cas de désaccord.
Chaque contrôle cite le fichier de référence qui montre la bonne pratique et,
si possible, une recherche mécanique (`grep`) qui repère l'écart.

## Sécurité et cloisonnement des données

- TODO(acc-adapt) : comment un identifiant reçu est vérifié (fonction à
  appeler, fichier modèle).

## Erreurs

- TODO(acc-adapt) : types d'erreur, enveloppe des contrôleurs, fichier modèle.

## Configuration

- TODO(acc-adapt) : point d'entrée unique des variables d'environnement.

## Interface et textes affichés

- TODO(acc-adapt) : accès réseau, découpage des pages, traduction, mise en
  page, ou « sans objet ».

## Tests obligatoires

- TODO(acc-adapt) : tests d'inventaire ou de couverture à mettre à jour quand
  on ajoute une route, un modèle, un écran.

## Recherches mécaniques

```bash
# TODO(acc-adapt) : une commande par motif à risque, vérifiée sur ce dépôt,
# avec le nombre de résultats attendus aujourd'hui (dette connue).
```
