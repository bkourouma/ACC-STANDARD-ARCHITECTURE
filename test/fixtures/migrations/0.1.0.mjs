// Migration de test : renomme un fichier géré et marque la config.
export default async function migrate({ config, log, renameManaged }) {
  renameManaged('scripts/old-bus.cjs', 'scripts/agent-bus.cjs');
  log('bus renommé');
  return { ...config, migratedTo: '0.1.0' };
}
