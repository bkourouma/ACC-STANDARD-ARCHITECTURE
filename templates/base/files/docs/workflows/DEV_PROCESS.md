# Processus développement

Ce contrat décrit des **rôles**, pas des modèles ni un fournisseur. Il fonctionne
avec tout agent capable de lire le dépôt, de déléguer des tâches et d'exécuter
les commandes du projet. `AGENTS.md` reste prioritaire.

Les commandes du projet (installation, typecheck, lint, tests…) sont listées
dans `AGENTS.md` (section « Commandes ») et dans `commands` d'`acc.config.json`.
Ce document les désigne par leur rôle, pas par leur texte.

## Rôles

| Rôle                       | Responsabilité                                                                                                        |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Coordinateur développement | Comprend la demande, découpe le travail, attribue les fichiers, intègre et vérifie le résultat, reçoit les anomalies. |
| Développeur complexe       | Traite les changements multi-modules, les règles métier, la sécurité et les corrections difficiles.                   |
| Développeur simple         | Traite les changements locaux, déterministes et faciles à vérifier.                                                   |

Le coordinateur choisit le nombre d'agents selon les tâches réellement
indépendantes et les limites du moteur. Un agent ne modifie que les fichiers qui
lui sont attribués ; le coordinateur règle les conflits et garde la responsabilité
du résultat. Les agents de réalisation ne créent pas d'autres agents et ne
lancent aucune commande git qui modifie l'arbre ou l'index.

## Boucle autonome

1. Lire `AGENTS.md`, `docs/workflows/HANDOFF.md`, le besoin et les règles des
   fichiers concernés (`.claude/rules/`). Relever la branche et la révision de
   départ.
2. Définir des critères observables et attribuer des tâches bornées aux agents
   disponibles, par territoire de fichiers. Confier les changements complexes
   au rôle complexe, les changements simples au rôle simple.
3. Intégrer les résultats et exécuter les vérifications adaptées : tests
   ciblés, lint, typecheck et contrôles propres au projet listés dans
   `AGENTS.md`. Les erreurs préexistantes sont distinguées des régressions.
   Pour un diff qui touche un point sensible décrit dans
   `docs/governance/SECURITY.md` (authentification, autorisations, données
   d'autrui, paiements, fichiers téléversés, secrets), faire relire par
   `code-reviewer` et `security-auditor` (ou `/audit`) avant la passation.
4. Si le changement est visible dans l'interface, transmettre au processus
   démo/debug la révision testable (branche et SHA), les changements visibles,
   l'URL de l'instance à tester et les critères de réussite. Option : avec le
   profil `demo-instance`, poser d'abord la révision sur l'instance de démo
   figée (`node scripts/demo-instance.cjs sync <sha>`).
5. Journaliser la livraison avec
   `node scripts/agent-bus.cjs revision --sha <sha> --branch <branche> [--fixes ID,ID]`
   — cette commande passe les anomalies citées à l'état `prêt au retest`. À
   réception d'une anomalie créée par la recette dans le bus d'agents (voir
   [BUG_REPORT_TEMPLATE.md](BUG_REPORT_TEMPLATE.md) pour le format), la
   reproduire, la passer `en correction`, la corriger, puis répéter l'étape 4.
   Continuer jusqu'à ce que le processus démo/debug confirme les cas concernés.
6. Mettre à jour `HANDOFF.md` avec l'état final et les points encore ouverts.
   Le suivi anomalie par anomalie reste dans le bus d'agents, pas dans
   `HANDOFF.md`.

Une correction est terminée lorsque le scénario concerné passe, que les
vérifications adaptées passent et que les autres scénarios touchés n'ont pas
régressé. Ne déclarer aucun résultat non vérifié.

## Coordination

Le canal partagé est le bus d'agents : `.agent-bus/` à la racine du checkout
principal (commun à tous les worktrees, surchargeable par `AGENT_BUS_DIR`),
piloté par `node scripts/agent-bus.cjs <commande>`. Chaque anomalie est un
fichier `bugs/BUG-AAAA-MM-JJ-NNN.md` et `revisions.md` journalise les
livraisons. Le développement y écrit « Correction annoncée » et les états
`en correction` / `prêt au retest` ; ce fichier est la trace de référence, pas
la messagerie de l'outil.

Utiliser en plus la messagerie entre agents ou tâches offerte par
l'environnement uniquement pour réveiller le processus démo/debug en indiquant
l'identifiant de l'anomalie ou de la révision : un message sans entrée
correspondante dans le bus ne compte pas comme passation.

Ne solliciter personne pour des décisions de mise en œuvre réversibles déjà
autorisées. Les permissions de l'environnement et les confirmations exigées
par les outils restent applicables ; signaler seulement un blocage réel. Les
actions de la section « Jamais sans un oui explicite » d'`AGENTS.md` restent
soumises à l'accord de l'utilisateur.
