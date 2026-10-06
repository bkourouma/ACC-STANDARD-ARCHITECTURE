---
name: acc-adapt
description: Adapte l'architecture agentique posée par acc-standard au projet réel. Remplit tous les TODO(acc-adapt) et les fichiers seed à partir du code et d'acc.config.json, crée les règles .claude/rules/*.md utiles avec leurs chemins réels (paths), complète la compétence run-<slug>, sans jamais toucher un fichier géré ni un bloc géré, puis lance npx github:bkourouma/ACC-STANDARD-ARCHITECTURE doctor et met à jour HANDOFF.md. À invoquer via /acc-adapt juste après `acc-standard apply` ou `update`, ou quand des TODO(acc-adapt) restent.
disable-model-invocation: true
argument-hint: "[fichier ou section à adapter]"
---

# /acc-adapt — adapter le standard au projet

Tu adaptes à ce projet les parties laissées génériques par `acc-standard`.
Tout ce que tu écris doit être **vérifié dans le code réel** (fichier lu,
commande exécutée) : pas de règle inventée, pas de commande supposée. Écris
dans la langue du projet (`project.language` d'`acc.config.json`).

Si `$ARGUMENTS` désigne un fichier ou une section, limite-toi à ce périmètre ;
sinon, traite tout.

## 0. Ce que tu ne touches jamais

- Un fichier en mode `managed` de la section `files` du manifeste
  `.acc/manifest.json` (agents, hooks, contrats de processus, scripts, cette
  compétence…) : il appartient au standard, une modification locale serait
  signalée comme dérive et bloquerait les mises à jour. Si un contenu géré ne
  convient pas au projet, note-le dans ton rapport comme proposition
  d'évolution du standard.
- Le contenu entre `<!-- acc:begin <id> -->` et `<!-- acc:end <id> -->`
  (blocs gérés d'`AGENTS.md`, `CLAUDE.md`). Tu écris uniquement hors blocs.
- Les fichiers `.env` (hors `.env.example`) : ni lecture ni écriture.
- Aucune commande git qui modifie l'arbre ou l'index ; pas de commit (le
  Pilote ou l'utilisateur commitera).

## 1. Relever l'état

1. Lis `acc.config.json`, `.acc/manifest.json`, `AGENTS.md`, `CLAUDE.md`,
   `docs/workflows/HANDOFF.md`.
2. Liste les `TODO(acc-adapt)` restants :
   `grep -rn "TODO(acc-adapt)" --exclude-dir=node_modules --exclude-dir=.git .`
3. Repère les fichiers `*.acc-new` en attente : ce sont des conflits que
   l'utilisateur doit arbitrer ; ne les fusionne pas toi-même, signale-les.
4. Liste les squelettes `.acc/skeletons/**` : quand `AGENTS.md` ou
   `CLAUDE.md` existaient avant le standard, seuls les blocs gérés y ont été
   ajoutés ; le squelette est le fichier complet que le standard aurait posé
   (tables, « Structure réelle », « Commandes », `TODO(acc-adapt)`…).
5. Repère les sauvegardes `*.acc-bak` laissées par `apply --adopt` : la
   version locale d'un fichier géré remplacée par celle du standard.
6. Repère la section `retired` du manifeste : fichiers repris par le standard
   qui ne sont plus livrés (option `when`, profil ou adaptateur désactivé)
   mais existent encore. Ils appartiennent au projet et ne sont plus mis à
   jour ; signale-les dans ton rapport (les supprimer s'ils ne servent plus
   est une décision de l'utilisateur). Si l'option est réactivée, une
   modification locale ressortira en conflit `.acc-new`, jamais adoptée.

## 2. Explorer le code réel

Lis le manifeste du gestionnaire de paquets (scripts), la configuration du
langage, du lint et des tests, la CI, les fichiers d'exemple d'environnement
(`.env.example`), le README et la structure des dossiers. Pour chaque
convention que tu comptes documenter, trouve au moins un fichier qui
l'illustre. Vérifie chaque commande en la lançant quand c'est sans risque
(typecheck, lint, tests ciblés) et note sa durée et sa dette éventuelle
(nombre d'erreurs préexistantes).

## 3. Compléter acc.config.json si nécessaire

Corrige les valeurs proposées par `detect` qui ne correspondent pas au
projet : `commands.*`, `ports`, `git.mainBranch`, `git.protectedBranches`.
Propose des contrôles `hooks.preCommit` rapides et sûrs (sans `--fix`, sans
écriture) et des motifs `guard.destructiveCommands` pour les outils du projet
qui détruisent des données. Exemples de motifs (regex JS en chaîne JSON) :

```json
{ "pattern": "\\bprisma\\s+migrate\\s+reset\\b", "reason": "remise à zéro destructive de la base" },
{ "pattern": "\\bprisma\\s+db\\s+push\\b.*--(force-reset|accept-data-loss)", "reason": "perte de données possible" }
```

Ajoute aussi à `guard.protectedPaths` les dossiers dont la suppression serait
catastrophique (sources, fichiers téléversés, ressources). Si tu modifies
`commands.*` ou `git.protectedBranches`, signale que `npx github:bkourouma/ACC-STANDARD-ARCHITECTURE apply`
doit être relancé pour que les fichiers rendus (permissions de
`.claude/settings.json`, CI) en tiennent compte.

## 4. Remplir les TODO(acc-adapt) et les fichiers seed

Fichiers concernés (hors blocs gérés) :

- `AGENTS.md` : structure réelle, commandes ciblées, règles propres au
  projet (chacune avec son fichier de référence), pièges connus ;
- `CLAUDE.md` : lignes de la table de chargement progressif pour les
  documents réels du projet (architecture, modèle de données, specs) ;
- `docs/workflows/RUNBOOK.md` : prérequis, environnement, ports, dépannage
  réellement rencontré ;
- `docs/governance/CODING_STANDARDS.md`, `docs/governance/SECURITY.md` :
  mécanismes tels qu'implémentés, avec leurs fichiers ;
- `docs/architecture/adr/ADR-000-template.md` : contraintes transverses ;
- `.claude/rules/review-checklist.md` : `paths:` réels, contrôles et
  recherches mécaniques vérifiées sur le dépôt (avec le nombre de résultats
  attendus aujourd'hui) ;
- `.claude/skills/run-<slug>/SKILL.md` : séquence de lancement vérifiée,
  sonde de disponibilité, comptes de démonstration (sans mot de passe réel),
  pièges.

Un TODO que tu ne peux pas résoudre faute d'information reste en place avec
une note précise de ce qui manque.

Pour chaque squelette `.acc/skeletons/<fichier>` : compare-le, section par
section (titres `##`), au `<fichier>` réel. Chaque section du squelette
absente du fichier réel (hors blocs gérés) y est ajoutée, remplie à partir
du code comme ci-dessus ou laissée en `TODO(acc-adapt)` ; une section déjà
couverte sous un autre titre n'est pas dupliquée. Garde l'ordre et le ton du
fichier existant, ne touche à aucun bloc géré. Le squelette une fois
intégré, supprime-le (il n'est pas recréé). Pour un fichier adopté, la
sauvegarde est `<fichier>.acc-bak` ou `<fichier>.N.acc-bak` (premier nom
libre, ou sauvegarde identique réutilisée : ni le numéro ni la date ne
désignent la bonne). La version remplacée est celle qu'`apply` a listée dans
« Sauvegardes créées » ; sans ce rapport, c'est la sauvegarde identique à la
version du fichier avant l'adoption (`git show HEAD:<fichier>` si
l'adoption n'est pas encore commitée, sinon le commit qui la précède).
Reporte dans les fichiers seed ou hors blocs ce qu'elle contenait de propre
au projet, note dans ton rapport ce qui relèverait d'une évolution du
standard, puis laisse l'utilisateur la supprimer.

## 5. Créer les règles par chemin utiles

Crée dans `.claude/rules/` une règle par domaine où le projet a des
conventions fortes (par exemple style, tests, routes d'API, sécurité,
interface). Chaque règle :

- commence par un frontmatter `paths:` listant des globs **réels** (vérifie
  qu'ils correspondent à des fichiers existants) ;
- renvoie au document détaillé (`CODING_STANDARDS.md`, `SECURITY.md`) plutôt
  que de le recopier ;
- reste courte (moins de 80 lignes) et factuelle.

Ne crée pas de règle sans contenu vérifié.

## 6. Vérifier

1. `grep -rn "TODO(acc-adapt)" --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.acc .` :
   liste ce qui reste et pourquoi (`.acc/skeletons/` doit être vide).
2. `npx github:bkourouma/ACC-STANDARD-ARCHITECTURE doctor` : corrige ce qui relève de l'adaptation
   (config, fichiers attendus) ; signale le reste (hooks git non installés,
   conflits `.acc-new`, dérive d'un fichier géré).
3. Relis `git diff` : aucun fichier géré, aucun bloc géré modifié.

## 7. Passation

Mets à jour `docs/workflows/HANDOFF.md` (section de la branche courante :
fait, reste, pièges, branche, dernier commit) sans l'annoncer, puis rends un
rapport court : fichiers adaptés, règles créées, TODO restants avec leur
cause, résultat de `doctor`, propositions d'évolution du standard.
