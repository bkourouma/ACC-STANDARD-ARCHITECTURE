---
name: audit
description: Audite un périmètre de ce projet (un chemin donné en argument, ou par défaut le diff de la branche courante contre la branche principale) en enchaînant typecheck/lint/tests pertinents, les recherches mécaniques propres au projet, puis une revue par les sous-agents code-reviewer et security-auditor. Produit un rapport unique classé par gravité. À invoquer via /audit avant une PR, ou pour un état des lieux de sécurité et de qualité sur une zone du code.
---

# /audit — audit d'un périmètre

Argument optionnel : `$ARGUMENTS` est soit un chemin (fichier ou dossier),
soit vide. Vide veut dire : le diff de la branche courante contre la branche
principale (`git.mainBranch` d'`acc.config.json`, `main` par défaut).

## 1. Déterminer le périmètre

- Si `$ARGUMENTS` est un chemin existant : le périmètre est ce chemin (et son
  contenu s'il s'agit d'un dossier).
- Sinon : `git diff --name-only <branche principale>...HEAD` donne la liste
  des fichiers modifiés. Si la branche courante EST la branche principale ou
  que la liste est vide, dis-le et arrête-toi plutôt que d'auditer tout le
  dépôt par défaut — ce n'est pas le même travail et ça ne doit jamais partir
  sans le dire.

Déduis du périmètre quels paquets ou modules sont touchés (voir la structure
dans `AGENTS.md`).

## 2. Typecheck / lint / tests pertinents

Lis `commands` dans `acc.config.json` et la section « Commandes »
d'`AGENTS.md`. Ne lance que ce que le périmètre justifie, en ciblant le paquet
ou les fichiers concernés quand le projet le permet :

- `commands.typecheck` et `commands.lint` ;
- `commands.test`, au minimum sur les tests proches des fichiers modifiés.

Une commande vide (`""`) dans `commands` veut dire que le projet ne la
fournit pas : ne pas en inventer une (pas de `npm test` supposé), ne pas la
compter comme réussie. Si `commands.test` est vide, le rapport le dit
explicitement dans les vérifications non faites (« aucun test automatisé
configuré ») et, pour chaque changement de comportement du périmètre,
indique le scénario de vérification manuelle qui le couvre ou signale son
absence comme constat Important. Même règle pour `typecheck` et `lint`.

S'il existe une dette préexistante (erreurs connues, voir « Pièges connus »
d'`AGENTS.md`), compare le compte avant/après plutôt que d'exiger zéro : une
**nouvelle** erreur dans un fichier du périmètre qui en était exempt est
bloquante pour ton rapport ; les erreurs déjà connues ne le sont pas.

## 3. Recherches mécaniques

Lance les recherches de la section « Recherches mécaniques » de
`.claude/rules/review-checklist.md`, restreintes au périmètre. Si ce fichier
n'en contient pas encore (`TODO(acc-adapt)`), dis-le dans le rapport et
applique au moins ces recherches génériques sur les fichiers du périmètre :

```bash
# Lignes de débogage ajoutées par le diff.
git diff <branche principale>...HEAD -- <périmètre> | grep -E "^\+.*(console\.log|debugger|print\()"

# Secrets écrits en dur (à confirmer à la lecture : beaucoup de faux positifs).
grep -rniE "(api[_-]?key|secret|password|token)\s*[:=]\s*['\"][^'\"]{8,}" <périmètre>

# Marqueurs laissés par le diff.
git diff <branche principale>...HEAD -- <périmètre> | grep -E "^\+.*(TODO|FIXME|XXX)"
```

Si une commande remonte un flot de faux positifs sur le périmètre, dis-le
dans le rapport plutôt que de lister chaque faux positif comme un constat.

## 4. Délégation aux sous-agents de revue

Lance en parallèle, sur le même périmètre :

- `code-reviewer` (`.claude/agents/code-reviewer.md`) : règles du projet,
  taille des fonctions, tests, régressions de typage et de lint.
- `security-auditor` (`.claude/agents/security-auditor.md`) : modèle de
  menace de `docs/governance/SECURITY.md`.

Donne-leur explicitement le périmètre déterminé à l'étape 1 (liste de
fichiers ou chemin), pas « le dépôt entier » implicite.

## 5. Rapport unique

Fusionne : résultats typecheck/lint/tests, recherches mécaniques (dédupliquées
avec les constats déjà remontés par les sous-agents), constats des deux
sous-agents. Classe le tout par gravité (Bloquant/Critique, Important,
Mineur), avec `fichier:ligne`, un scénario d'échec concret et une correction
proposée pour chaque constat — jamais un constat sans preuve vérifiée.

Si le projet tient un registre de dette (audit, section « Dette connue » de
`docs/governance/CODING_STANDARDS.md`, « Points ouverts » de `SECURITY.md`) :
un constat déjà connu et non aggravé par le périmètre est mentionné à part,
hors du compte des constats nouveaux.

Termine par une synthèse courte : périmètre audité, nombre de constats par
gravité, la liste des vérifications qui n'ont rien trouvé (pour que
l'absence de mention ne se lise pas comme un oubli) et celle des
vérifications non faites faute de commande configurée.
