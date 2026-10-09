import 'dotenv/config';
import path from 'node:path';
import fs from 'node:fs/promises';
import { createApp } from './app.js';
import { initializeFirebase } from './services/firebase.js';
import { createMetadata } from './services/metadata.js';
import { createBudget } from './services/budget.js';
import { initializeStorage } from './utils/safePath.js';

const root = path.resolve(process.env.STORAGE_ROOT || path.join(import.meta.dirname, 'data'));
const storageRoot = await initializeStorage(path.join(root, 'blobs'));
const stagingRoot = await initializeStorage(path.join(root, 'incoming'));
const publicRoot = await fs.realpath(path.join(import.meta.dirname, 'public'));
for (const directory of [storageRoot, stagingRoot]) {
  const relative = path.relative(publicRoot, directory);
  if (!relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new Error('STORAGE_ROOT must be outside the public web directory.');
  }
}
const lockPath = path.join(root, 'server.lock');
// An exclusive lock deliberately survives abnormal exits. An operator must
// verify no server is running before removing a stale lock.
const lockFile = await fs.open(lockPath, 'wx').catch(() => {
  throw new Error('Storage is locked. See README.md before removing data/server.lock.');
});
await lockFile.writeFile(String(process.pid));
await lockFile.close();
try {
  const { auth, db, clientConfig } = initializeFirebase();
  const reserve = createBudget(path.join(root, 'firestore-budget.json'));
  const repo = createMetadata(db, reserve);
  const app = createApp({ auth, repo, clientConfig, storageRoot, stagingRoot });
  const server = app.listen(Number(process.env.PORT || 3000), process.env.HOST || '0.0.0.0', () => console.log('My Drive is listening on port ' + (process.env.PORT || 3000)));
  server.requestTimeout = 5 * 60 * 1000;
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.once(signal, () => server.close(async () => {
      await fs.unlink(lockPath);
      process.exit(0);
    }));
  }
} catch (err) {
  await fs.unlink(lockPath);
  throw err;
}
