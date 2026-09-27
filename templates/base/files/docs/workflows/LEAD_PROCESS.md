# Processus pilotage (agent unique)

Ce contrat décrit un **rôle**, pas un modèle ni un fournisseur. Il s'applique à
tout agent capable de tenir seul, dans une session, l'ensemble du cycle décrit
ci-dessous. `AGENTS.md` reste prioritaire ; ce document complète
[DEV_PROCESS.md](DEV_PROCESS.md) et
[DEMO_DEBUG_PROCESS.md](DEMO_DEBUG_PROCESS.md) sans les remplacer : le mode
deux sessions qu'ils décrivent reste utilisable.

Les commandes de vérification du projet sont celles d'`AGENTS.md` (section
« Commandes ») et de `commands` dans `acc.config.json`. La branche principale
et les branches protégées sont dans `git` d'`acc.config.json`.

## Rôle et hiérarchie

| Rôle   | Responsabilité                                                                                                                   |
| ------ | -------------------------------------------------------------------------------------------------------------------------------- |
| Pilote | Seul interlocuteur de l'utilisateur. Cadre l'objectif, choisit la voie, délègue, intègre, vérifie, commite, pousse, ouvre la PR. |

Le Pilote est la session principale. Il délègue soit aux deux coordinateurs
(développement, démo/debug) qui appliquent leurs contrats respectifs et
délèguent à leur tour à leurs agents, soit directement à des agents de
réalisation ou de relecture pour une tâche assez petite pour ne pas justifier
un coordinateur. Les agents de réalisation ne délèguent jamais : la
profondeur maximale sous la session principale est de trois niveaux (Pilote →
coordinateur → agent de réalisation). Quand le Pilote fait tourner les deux
processus, il tient lui-même le rôle de canal entre eux : la coordination
passe par le bus d'agents (`.agent-bus/`, voir [DEV_PROCESS.md](DEV_PROCESS.md))
exactement comme dans le mode à deux sessions.

## Boucle autonome

1. **Cadrer** l'objectif reçu de l'utilisateur en critères observables : ce
   qui doit être vrai à la fin, vérifiable dans le code, les tests ou
   l'interface. Lire `AGENTS.md`, `docs/workflows/HANDOFF.md` et vérifier
   `git status` avant toute modification.
2. **Choisir la voie** selon la taille et la nature de l'objectif :
   - le processus développement seul, quand rien de visible en interface
     n'a besoin d'être rejoué ;
   - développement puis démo/debug en boucle, quand un changement visible
     mérite une recette avant la PR ;
   - l'exécution directe d'agents de réalisation ou de relecture, pour une
     tâche bornée à un ou deux territoires de fichiers, sans coordinateur.
3. **Préparer la branche** : `type/sujet` en partant de la branche principale
   distante à jour, ou empilée sur la branche parente si l'objectif en dépend
   (la PR vise alors cette branche). Poser un worktree
   `.claude/worktrees/<sujet>` pour un objectif mené en parallèle d'un autre,
   en suivant [RUNBOOK.md](RUNBOOK.md) pour ses dépendances.
4. **Déléguer** par territoire de fichiers, jamais deux agents sur le même
   fichier, en suivant les contrats des coordinateurs quand ils sont engagés.
   Chaque prompt de réalisation interdit les commandes git qui modifient
   l'arbre ou l'index et le lancement d'autres agents.
5. **Intégrer et vérifier** : tests ciblés, typecheck, lint et contrôles
   propres au projet. Faire relire par `code-reviewer` et `security-auditor`
   (ou `/audit`) tout diff touchant un point sensible de
   `docs/governance/SECURITY.md`. Un rapport d'agent n'est pas une preuve.
6. **Recette** si le changement est visible en interface : soit via le
   processus démo/debug (scénarios numérotés, anomalies dans le bus), soit
   directement par le Pilote avec l'outil de navigation disponible, pour une
   tâche trop petite pour justifier un coordinateur dédié.
7. **Commit** conventionnel (`feat(module): …`), dans la langue du projet, à
   chaque étape cohérente et vérifiée, jamais pendant qu'un agent écrit dans
   les fichiers concernés, jamais avec `--no-verify`. Un refus de hook se
   corrige, il ne se contourne pas.
8. **Push** de la branche de travail après chaque lot de commits vérifié.
9. **Pull request** (par exemple `gh pr create`) : contexte, changements,
   vérifications faites, ce qui n'a pas été vérifié, points ouverts.
10. **Suivi CI** avec les outils disponibles dans l'environnement ; corriger
    les échecs sur la branche.
11. **Rapport unique** à l'utilisateur en fin d'objectif (voir « Rapport »).
12. **Passation** : le Pilote met à jour `HANDOFF.md` — c'est le seul rôle du
    processus développement qui l'écrit quand le Pilote est engagé. L'état
    anomalie par anomalie reste dans le bus d'agents.

## Git

Une branche `type/sujet` par objectif. Worktree dédié pour un objectif mené
en parallèle d'un autre. Commits conventionnels, à chaque étape cohérente et
vérifiée, jamais pendant qu'un agent écrit, jamais `--no-verify` : un refus de
hook Lefthook se corrige. Push après chaque lot de commits. PR décrivant le
contexte, les changements, les vérifications effectuées, ce qui reste non
vérifié et les points ouverts. Le Pilote suit la CI et corrige les échecs sur
la branche.

## Ce que le Pilote ne fait jamais sans un « oui » explicite de l'utilisateur

La liste qui fait foi est la section « Jamais sans un oui explicite »
d'`AGENTS.md`. En résumé :

- fusionner une pull request ;
- pousser sur une branche protégée (de toute façon refusé par le hook
  `pre-push`) ;
- forcer une poussée ;
- déployer ;
- toucher une base de données non dédiée, ou des données de production ;
- lire ou écrire un fichier `.env` ;
- engager une dépense ;
- envoyer un message externe (e-mail, message client, notification hors de
  l'environnement de développement).

Tout le reste de réversible se décide seul, sans solliciter de validation
pour une action déjà autorisée par ces contrats.

## Quand interroger l'utilisateur

Uniquement en cas d'ambiguïté produit réelle qui changerait le résultat
livré, ou avant l'une des actions listées ci-dessus. Dans tous les autres
cas, le Pilote travaille jusqu'au bout de l'objectif et rend un seul rapport.

## Rapport

Le rapport final tient en une réponse et couvre :

- l'objectif traité ;
- le ou les liens de pull request ouverts ;
- ce qui a été vérifié et comment (tests, typecheck, lint, contrôles du
  projet, recette, relecture) ;
- ce qui n'a pas été vérifié ;
- les blocages rencontrés et à qui ils reviennent.
