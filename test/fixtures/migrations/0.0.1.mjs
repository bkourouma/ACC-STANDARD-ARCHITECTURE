// Migration de test : ne doit pas tourner (version <= config).
import fs from 'node:fs';
import path from 'node:path';

export default async function migrate({ target }) {
  fs.writeFileSync(path.join(target, 'migration-0.0.1.txt'), 'ne devait pas tourner\n');
}
