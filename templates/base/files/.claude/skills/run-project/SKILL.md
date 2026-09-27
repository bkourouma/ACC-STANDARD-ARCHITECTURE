---
name: run-{{project.slug}}
description: Fait tourner {{project.name}} en local et le pilote pour constater qu'une modification fonctionne dans l'application réelle. À utiliser pour démarrer ou relancer l'application, l'ouvrir, en faire une capture, se connecter avec un compte de démonstration, ou diagnostiquer ce qui l'empêche de tourner. Ne sert pas à lancer la suite de tests, à corriger des erreurs de typage ni à déployer. TODO(acc-adapt) — préciser les symptômes typiques qui doivent déclencher cette compétence.
---

# Lancer {{project.name}}

TODO(acc-adapt) : recette vérifiée (date, branche, système) ; chaque piège
documenté ici doit avoir réellement bloqué un démarrage.

## Ce qu'est le projet

TODO(acc-adapt) : un tableau service → rôle → port. Ports déclarés dans
`acc.config.json` (clé `ports`) à reprendre ici.

## Séquence de lancement

```bash
{{#if commands.install}}
{{commands.install}}
{{/if}}
{{#if commands.dev}}
{{commands.dev}}
{{else}}
# TODO(acc-adapt) : commande de lancement
{{/if}}
```

TODO(acc-adapt) : ordre de démarrage si plusieurs services, configuration
`.claude/launch.json` éventuelle.

### Attendre que l'application soit prête

TODO(acc-adapt) : URL de sonde qui répond sans authentification, et boucle
d'attente, par exemple :

```bash
for i in $(seq 1 40); do
  code=$(curl -s -o /dev/null -w "%{http_code}" http://localhost:<port>/<sonde>)
  [ "$code" = "200" ] && echo "prêt (~${i}s)" && break
  sleep 1
done
```

## Se connecter

TODO(acc-adapt) : comptes de démonstration et où trouver leurs identifiants
(fichier de seed ou d'exemple) — jamais de mot de passe réel ici.

## Pièges

TODO(acc-adapt) : pannes réellement rencontrées au démarrage (secret refusé,
port occupé, origine refusée, écran vide…), leur symptôme exact et le
correctif.
