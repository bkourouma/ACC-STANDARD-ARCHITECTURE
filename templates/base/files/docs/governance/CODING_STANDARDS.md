# Conventions de code — {{project.name}}

En cas de désaccord avec [AGENTS.md](../../AGENTS.md), AGENTS.md prime. Ce
document décrit les conventions **observées dans le code**, avec un fichier de
référence pour chacune, pas un idéal.

## 1. Organisation du dépôt

TODO(acc-adapt) : dossiers principaux, frontières entre modules (qui peut
importer quoi), où vit la configuration.

## 2. Nommage

TODO(acc-adapt) : conventions de nommage des fichiers, dossiers, types et
fonctions, avec un exemple réel pour chacune.

## 3. Couches et responsabilités

TODO(acc-adapt) : rôle de chaque couche (routes, services, accès aux données,
composants…) et ce qui n'y a pas sa place.

## 4. Erreurs

TODO(acc-adapt) : comment une erreur est levée, propagée et présentée ;
fichier modèle.

## 5. Configuration

TODO(acc-adapt) : point d'entrée unique des variables d'environnement, fichier
d'exemple, règles sur les valeurs par défaut (jamais pour un secret).

## 6. Textes affichés et internationalisation

TODO(acc-adapt) : langue(s) de l'interface, mécanisme de traduction, règles de
mise en page (sens de lecture), ou « sans objet ».

## 7. Tests

TODO(acc-adapt) : outils, emplacement des tests, ce qui doit être testé pour
un changement de comportement, commandes ciblées.

## 8. Taille et forme du code

- Une fonction nouvellement écrite vise moins de 50 lignes ; au-delà, se
  demander si un découpage est possible. Ce n'est pas une réécriture
  rétroactive du code existant.
- Un changement de comportement est accompagné d'au moins un test qui
  l'exerce.
- Pas de nouvelle erreur de typage ou de lint dans un fichier qui en était
  exempt.

## 9. Branches et commits

- Une branche `type/sujet` par changement, partant de `{{git.mainBranch}}`.
- Commits conventionnels (`feat(module): …`, `fix(module): …`,
  `docs: …`, `chore: …`), dans la langue du projet.
- Jamais de poussée directe ni forcée sur une branche protégée
  ({{git.protectedBranches}}), jamais `--no-verify`.

## 10. Dette connue

TODO(acc-adapt) : dette identifiée à ne pas aggraver (erreurs préexistantes,
gros fichiers, zones sans tests), avec son ordre de grandeur.
