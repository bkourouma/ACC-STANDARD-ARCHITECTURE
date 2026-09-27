# Rapport d'anomalie — modèle de passation

`node scripts/agent-bus.cjs new-bug --title "..." [--priority ...] [--scenario ...]
[--branch ...] [--sha ...] [--url ...]` crée directement le fichier
`.agent-bus/bugs/BUG-AAAA-MM-JJ-NNN.md` dans ce format, à l'état `nouveau`. Le
fichier est la trace de référence ; la messagerie de l'outil ne sert qu'à
signaler l'identifiant. Un rapport correspond à un comportement distinct ;
garder son identifiant pendant tous les cycles de correction et de retest.

```text
ID : BUG-AAAA-MM-JJ-001
État : nouveau | en correction | prêt au retest | passé | bloqué
Priorité : bloquant | important | mineur
Scénario : <identifiant et titre>
Branche / révision testée : <branche, SHA>
Instance / URL : <URL testée>
Rôle et données de test : <sans secret ni donnée personnelle>
Préconditions : <état nécessaire>
Étapes :
1. ...
2. ...
Attendu : <résultat observable>
Observé : <résultat réellement vu>
Preuve : <capture, journal expurgé ou lien accessible>
Fréquence : <nombre de reproductions / essais>
Correction annoncée : <révision, cause, changements> (rempli par le développement)
Retest : <date, révision, résultat et preuve> (rempli par la recette)

## Historique

<horodatage> — <nouvel état> (<note>, le cas échéant)
```

Propriété des champs : la recette crée l'anomalie et écrit Scénario,
Préconditions, Étapes, Attendu, Observé, Preuve, Fréquence, ainsi que les
états `passé`, `bloqué` et le retest ; le développement écrit Correction
annoncée et les états `en correction` / `prêt au retest`, via
`node scripts/agent-bus.cjs set-state <ID> <état> [--note "..."]` ou
`node scripts/agent-bus.cjs revision --sha <sha> --branch <b> [--fixes ID,ID]`.
Le changement d'état s'ajoute à l'Historique avec horodatage, il ne remplace
pas l'entrée précédente.

Ne jamais inclure mot de passe, jeton, contenu de `.env` ou donnée client réelle.
