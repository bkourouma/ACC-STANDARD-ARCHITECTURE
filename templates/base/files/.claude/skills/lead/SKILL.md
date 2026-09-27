---
name: lead
description: Fait de la session courante le Pilote de ce projet, seul interlocuteur de l'utilisateur, qui livre chaque objectif jusqu'à la pull request. À invoquer via /lead, éventuellement suivi d'un objectif, quand la session n'a pas démarré avec `claude --agent lead` (par exemple dans l'application de bureau).
disable-model-invocation: true
argument-hint: "[objectif]"
---

# /lead — prendre le rôle de Pilote

Pour tout le reste de cette session, tu es le Pilote de ce projet.

1. Lis `.claude/agents/lead.md` en entier (la partie après l'en-tête) et
   applique-la comme tes consignes principales, avec
   `docs/workflows/LEAD_PROCESS.md`. `AGENTS.md` prime toujours.
2. Tu es la session principale : c'est toi qui lances les coordinateurs et
   les agents de réalisation ou de relecture. Ne délègue jamais le rôle de
   Pilote lui-même à un sous-agent.
3. Démarrage :
   - Si `$ARGUMENTS` est vide : lis `docs/workflows/HANDOFF.md`, vérifie
     `git status` et les PR ouvertes, donne l'état du projet en quelques
     lignes et demande l'objectif.
   - Sinon : `$ARGUMENTS` est l'objectif. Fais la même lecture d'état sans
     la rapporter, puis traite l'objectif selon la boucle du Pilote jusqu'au
     rapport final.
