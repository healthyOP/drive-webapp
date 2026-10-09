import path from 'node:path';
import fs from 'node:fs/promises';
import { ApiError } from './errors.js';

export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateId(id, allowRoot = false) {
  if (allowRoot && (id === undefined || id === null || id === '')) return null;
  if (typeof id !== 'string' || !UUID.test(id)) throw new ApiError(400, 'INVALID_ID', 'Invalid file or folder ID.');
  return id;
}
export function validateName(value) {
  if (typeof value !== 'string') throw new ApiError(400, 'INVALID_NAME', 'Enter a filename.');
  const name = value.normalize('NFC').trim();
  if (!name || name === '.' || name === '..' || /[\\/\x00-\x1f\x7f<>:"|?*\u202a-\u202e\u2066-\u2069]/u.test(name) || /[. ]$/.test(name) || Buffer.byteLength(name) > 255) {
    throw new ApiError(400, 'INVALID_NAME', 'Use a name up to 255 UTF-8 bytes without slashes, control characters or <>:"|?*.');
  }
  return name;
}
// Busboy defaults to Latin-1 for multipart filename parameters. Decode only a
// lossless UTF-8 round trip, leaving already-Unicode and legacy Latin-1 alone.
export function decodeUploadName(name) {
  if ([...name].some(c => c.codePointAt(0) > 255)) return validateName(name);
  const bytes = Buffer.from(name, 'latin1');
  const decoded = bytes.toString('utf8');
  return validateName(!decoded.includes('\uFFFD') && Buffer.from(decoded, 'utf8').equals(bytes) ? decoded : name);
}
export async function initializeStorage(root) {
  await fs.mkdir(root, { recursive: true, mode: 0o700 });
  if ((await fs.lstat(root)).isSymbolicLink()) throw new Error('Storage root must not be a symbolic link.');
  return fs.realpath(root);
}
export function storagePath(root, id) { return path.join(root, validateId(id)); }
export async function existingFile(root, id) {
  const target = storagePath(root, id);
  const info = await fs.lstat(target);
  if (!info.isFile() || info.isSymbolicLink()) throw new ApiError(400, 'INVALID_STORAGE', 'Stored file is unavailable.');
  return target;
}

