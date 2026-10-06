// Migration de référence de la version 0.1.0 : première version du standard,
// rien à renommer ni à supprimer. Elle fixe la signature attendue par
// `acc-standard update` (voir docs/CONTRACT.md, §7) :
//
//   export default async function migrate({ target, config, log, renameManaged,
//     removeManaged }) {}
//
// - `target`        : chemin absolu du projet cible ;
// - `config`        : contenu d'acc.config.json (objet) ;
// - `log`           : fonction d'affichage d'une ligne ;
// - `renameManaged` : renameManaged(from, to), chemins relatifs ; n'écrase
//                     jamais une destination existante ;
// - `removeManaged` : removeManaged(rel) ; ne supprime qu'un fichier `managed`
//                     resté identique au manifeste, sinon le conserve.
//
// Une migration peut renommer ou supprimer des fichiers **gérés** — toujours
// par ces deux aides, jamais directement par `fs` — et modifier `config` ;
// elle retourne alors la config modifiée. Ne rien retourner laisse la config
// inchangée.

export default async function migrate({ target, config, log }) {
  void target;
  void log;
  return config;
}
