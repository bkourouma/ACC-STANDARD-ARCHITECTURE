// Migration de test : ne doit pas tourner (version > paquet).
import fs from 'node:fs';
import path from 'node:path';

export default async function migrate({ target }) {
  fs.writeFileSync(path.join(target, 'migration-0.2.0.txt'), 'ne devait pas tourner\n');
}
