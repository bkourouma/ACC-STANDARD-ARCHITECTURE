# Démarrer les processus selon l'agent utilisé

Les contrats communs sont [DEV_PROCESS.md](DEV_PROCESS.md),
[DEMO_DEBUG_PROCESS.md](DEMO_DEBUG_PROCESS.md) et
[LEAD_PROCESS.md](LEAD_PROCESS.md). Deux organisations sont possibles :

- **Pilote unique** : une seule session tient le rôle décrit dans
  `LEAD_PROCESS.md`, coordonne elle-même les deux processus via le bus
  d'agents et livre jusqu'à la pull request.
- **Deux sessions** : ouvrir deux sessions ou tâches distinctes sur le même
  projet, une pour le développement et une pour la démo/debug. Leur donner
  accès à la même révision testable, à une instance de test dédiée et au bus
  d'agents (`.agent-bus/`). Chaque processus reste responsable de son rôle ;
  seul le développement écrit dans le code.

Les rôles et les contrats restent valables quel que soit le modèle choisi.
Les choix de modèles ci-dessous sont des préférences propres à chaque
adaptateur, à ajuster aux modèles réellement disponibles.

## Claude Code

Les profils `.claude/agents/*.md` portent les rôles :

| Profil              | Rôle                          | Modèle par défaut | Restrictions                         |
| ------------------- | ----------------------------- | ----------------- | ------------------------------------ |
| `lead`              | Pilote (session principale)   | `opus`, effort `high`   | —                              |
| `dev-orchestrator`  | Coordinateur développement    | `opus`, effort `high`   | —                              |
| `demo-orchestrator` | Coordinateur démo/debug       | `opus`, effort `high`   | ne corrige pas le code         |
| `dev-complex`       | Développeur complexe          | `opus`, effort `medium` | sans outil `Agent`             |
| `dev-simple`        | Développeur simple            | `sonnet`                | sans outil `Agent`             |
| `ui-tester`         | Testeur interface             | `opus`, effort `medium` | sans `Edit`, `Write`, `Agent`  |
| `code-reviewer`     | Relecture qualité             | `sonnet`                | lecture seule                  |
| `security-auditor`  | Relecture sécurité            | `opus`                  | lecture seule                  |

`code-reviewer` et `security-auditor` appliquent un tronc commun puis les
contrôles propres au projet (`.claude/rules/review-checklist.md`,
`docs/governance/SECURITY.md`) ; ils s'invoquent avant une passation qui
touche un point sensible, ou via `/audit`.

Démarrage :

- Pilote : `claude --agent lead`, ou `/lead [objectif]` dans une session déjà
  ouverte (par exemple dans l'application de bureau), ou la clé
  `"agent": "lead"` dans `.claude/settings.local.json` (réglage personnel).
- Deux sessions : `claude --agent dev-orchestrator` et
  `claude --agent demo-orchestrator`. Le canal de passation est le bus
  d'agents ; la messagerie entre agents ne sert qu'à signaler un identifiant
  déjà écrit dans le bus.

Les hooks `.claude/hooks/` (garde des commandes, contrôles avant commit) ne
s'appliquent qu'à Claude Code.

## Codex

Avec le profil `adapter-codex`, `.codex/config.toml` et `.codex/agents/*.toml`
portent les mêmes rôles (`dev_orchestrator`, `demo_orchestrator`,
`dev_complex`, `dev_simple`, `ui_tester`, `code_reviewer`,
`security_auditor`). Aucun modèle n'y est imposé : renseigner `model` selon
les modèles disponibles (voir les commentaires des fichiers). Chaque profil
tourne en `sandbox_mode = "workspace-write"` (lecture seule pour les
relecteurs) : les hooks `.claude/` ne s'appliquent pas à Codex, les garde-fous
communs restent les hooks git Lefthook (`pre-push` qui refuse une poussée vers
une branche protégée, `pre-commit`) et la CI.

Consignes de départ, deux tâches :

```text
Processus développement : lis AGENTS.md et docs/workflows/DEV_PROCESS.md.
Coordonne le développement et la correction des anomalies envoyées par la
tâche démo/debug. Délègue les tâches indépendantes aux rôles adaptés, vérifie
les changements et renvoie chaque révision testable. Poursuis la boucle.
```

```text
Processus démo/debug : lis AGENTS.md et docs/workflows/DEMO_DEBUG_PROCESS.md.
Conçois les scénarios, fais-les exécuter dans le navigateur réel par le rôle
testeur interface, transmets les anomalies à la tâche développement et rejoue
les cas après correction. Poursuis jusqu'à réussite ou blocage documenté.
```

Pilote unique, une seule tâche :

```text
Pilote : lis AGENTS.md et docs/workflows/LEAD_PROCESS.md. Cadre chaque
objectif reçu en critères observables, choisis la voie (développement seul,
développement puis démo/debug, ou exécution directe d'agents de réalisation),
délègue par territoire de fichiers, intègre et vérifie le résultat, fais la
recette si le changement est visible, puis commite, pousse et ouvre la pull
request toi-même. Ne fusionne jamais une PR ni ne pousse sur une branche
protégée sans un oui explicite en conversation. Rends un seul rapport par
objectif.
```

Si les tâches utilisent des worktrees différents, toujours transmettre la
branche et la révision à tester.

## Cursor

Avec le profil `adapter-cursor`, `.cursor/rules/acc-standard.mdc` renvoie à
`AGENTS.md` et aux contrats. Cursor n'a pas de hiérarchie de sous-agents :
utiliser le mode Pilote unique, sans délégation.

## Autres agents

Lire `AGENTS.md` puis les contrats. Associer les rôles aux capacités
locales : coordination, implémentation complexe, tâches simples et navigation
réelle. Choisir les modèles disponibles et garder le bus d'agents comme canal
de passation. Garder le format d'anomalie et les critères de fin identiques.

## Limite d'autonomie

Les processus prennent seuls les décisions de développement réversibles et
réalisent leurs vérifications techniques. Aucun fichier de dépôt ne peut
autoriser un site, fournir un compte manquant ou supprimer une confirmation
imposée par le navigateur ou l'environnement hôte. Dans ces cas, documenter le
blocage précis et reprendre dès que l'accès est disponible.
