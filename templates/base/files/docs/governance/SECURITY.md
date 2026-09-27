# Modèle de menace — {{project.name}}

En cas de désaccord avec [AGENTS.md](../../AGENTS.md), AGENTS.md prime. Ce
document décrit les mécanismes de sécurité **tels qu'implémentés
aujourd'hui**, avec leur fichier, pas un objectif. Il est lu par l'agent
`security-auditor` et par `/audit` : chaque contrôle listé ici doit pouvoir se
vérifier dans le code.

## 1. Actifs à protéger

TODO(acc-adapt) : données (par propriétaire ou client), fichiers privés,
identifiants et secrets, paiements, données personnelles.

## 2. Acteurs

TODO(acc-adapt) : utilisateurs authentifiés et leurs rôles, administrateurs,
clients externes, anonymes, services tiers qui appellent le projet
(webhooks). Pour chacun : ce à quoi il a droit et le fichier qui le décide.

## 3. Authentification

TODO(acc-adapt) : mécanisme (session, jeton…), durée, stockage côté client,
fichiers concernés.

## 4. Autorisations et cloisonnement des données

TODO(acc-adapt) : comment un utilisateur est limité à ses propres données ;
comment un identifiant reçu dans une requête est vérifié avant lecture ou
écriture (référence d'autrui traitée comme inexistante) ; fonctions à
utiliser.

## 5. Fichiers privés

TODO(acc-adapt) : où sont stockés les fichiers téléversés, comment ils sont
servis (jamais en statique pour un document privé), contrôles d'accès.

## 6. Paiements et webhooks

TODO(acc-adapt) : vérification de signature des notifications entrantes,
source de vérité des montants et statuts, ou « sans objet ».

## 7. Assainissement des entrées et des sorties

TODO(acc-adapt) : validation des entrées, requêtes paramétrées, rendu de
contenu fourni par un utilisateur (pas d'injection HTML), champs sensibles
jamais renvoyés (hash de mot de passe…).

## 8. Secrets et configuration

- Les secrets vivent dans des fichiers `.env` non commités ou dans le
  gestionnaire de secrets de l'hébergeur ; seul un `.env.example` sans valeur
  réelle est versionné.
- Les agents ne lisent ni n'écrivent les `.env` (règle d'`AGENTS.md`, refus
  dans `.claude/settings.json`).

TODO(acc-adapt) : point d'entrée unique de la configuration, validation au
démarrage, variables exposées au client (et interdiction d'y placer un
secret).

## 9. Réseau

TODO(acc-adapt) : origines autorisées, en-têtes de sécurité, limites de débit.

## 10. Données personnelles

TODO(acc-adapt) : données collectées, journalisation (jamais de secret ni de
donnée personnelle dans les journaux), durée de conservation.

## 11. Conduite à tenir en cas de faille

1. Ne pas publier le détail de la faille dans un canal public (ticket, PR
   ouverte, message).
2. Prévenir le responsable du projet. TODO(acc-adapt) : qui, comment.
3. Corriger sur une branche dédiée, avec un test qui reproduit la faille.
4. Évaluer l'exposition (journaux, données touchées) et la documenter.

## 12. Points ouverts

TODO(acc-adapt) : failles ou faiblesses connues non corrigées, avec leur
fichier et leur priorité.
