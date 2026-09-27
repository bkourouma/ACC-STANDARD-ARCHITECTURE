// Migration de référence de la version 0.1.0 : première version du standard,
// rien à renommer ni à supprimer. Elle fixe la signature attendue par
// `acc-standard update` (voir docs/CONTRACT.md, §7) :
//
//   export default async function migrate({ target, config, log }) {}
//
// - `target` : chemin absolu du projet cible ;
// - `config` : contenu d'acc.config.json (objet) ;
// - `log`    : fonction d'affichage d'une ligne.
//
// Une migration peut renommer ou supprimer des fichiers **gérés** et modifier
// `config` ; elle retourne alors la config modifiée. Ne rien retourner laisse
// la config inchangée.

export default async function migrate({ target, config, log }) {
  void target;
  void log;
  return config;
}
