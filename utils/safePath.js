import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
export const STORAGE_ROOT = path.join(__dirname, '..', 'storage');

export function safePath(userPath = '') {
  const resolved = path.resolve(STORAGE_ROOT, userPath);
  const relative = path.relative(STORAGE_ROOT, resolved);

  const escapes =
    relative === '..' ||
    relative.startsWith('..' + path.sep) ||
    path.isAbsolute(relative);

  if (escapes) {
    throw new Error('Invalid path');
  }
  return resolved;
}

