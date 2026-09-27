# ADR-000 : Titre de la décision

<!-- Modèle d'Architecture Decision Record pour {{project.name}}. Copier ce
fichier sous un nouveau numéro ; ne pas modifier le modèle lui-même. -->

## Statut

Proposé | Accepté | Rejeté | Remplacé par ADR-NNN | Obsolète

## Date

AAAA-MM-JJ

## Contexte

Quel problème se pose, dans quel module, depuis quand. Quelles contraintes
pèsent sur la décision (sécurité, compatibilité, dette technique existante,
lot déjà livré…). Pas de jugement ici, seulement les faits qui rendent la
décision nécessaire.

TODO(acc-adapt) : contraintes transverses propres au projet à rappeler dans
chaque ADR, s'il y en a.

## Décision

Ce qui a été décidé, formulé sans ambiguïté. Si plusieurs éléments sont
décidés ensemble, les lister.

## Conséquences positives

- …

## Conséquences négatives

- Ce que la décision coûte, complique ou reporte. Une décision sans
  conséquence négative n'a probablement pas été assez creusée.

## Alternatives écartées

- **Alternative A** — pourquoi elle a été écartée.
- **Alternative B** — pourquoi elle a été écartée.

## Liens

- Fichiers ou dossiers concernés.
- Spécification, audit, autre ADR.
- PR ou commit d'implémentation, une fois connue.

---

## Numérotation

Un ADR par fichier : `ADR-NNN-titre-en-kebab.md`, `NNN` sur trois chiffres,
strictement croissant, jamais réutilisé même si un ADR est rejeté ou rendu
obsolète (on le marque comme tel dans son statut, on ne renumérote pas).
`titre-en-kebab` est un résumé court en minuscules, mots séparés par des
tirets, sans accents ni articles superflus — par exemple
`ADR-007-cache-des-sessions-en-memoire.md`.
