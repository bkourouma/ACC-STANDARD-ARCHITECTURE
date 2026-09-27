// Lance les tests node:test sans motif glob : `node --test "test/**/*.test.mjs"`
// ne développe pas `**` sous Node 20 (fonction arrivée en Node 21).
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

const files = readdirSync('test')
  .filter((name) => name.endsWith('.test.mjs'))
  .sort()
  .map((name) => join('test', name));

if (files.length === 0) {
  console.error('Aucun fichier test/*.test.mjs trouvé.');
  process.exit(1);
}

const result = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit' });
process.exit(result.status ?? 1);
