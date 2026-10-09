import express from 'express';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import multer from 'multer';
import { ApiError } from '../utils/errors.js';
import { validateId, validateName, decodeUploadName, storagePath, existingFile } from '../utils/safePath.js';
import { createLock } from '../utils/lock.js';
import { permissionContext, publicItem, MAX_DEPTH } from '../services/permissions.js';

const PAGE_SIZE = 50;
const MAX_DELETE = 200;
const now = () => new Date().toISOString();

export function createFilesRouter({ repo, auth, storageRoot, stagingRoot, maxFileSize = 100 * 1024 * 1024 }) {
  const router = express.Router();
  const lock = createLock();
  let activeUploads = 0;
  router.use((req, res, next) => {
    if (['/folders', '/rename', '/move', '/shares'].includes(req.path) && ['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method) &&
        (!req.body || typeof req.body !== 'object' || Array.isArray(req.body))) {
      return next(new ApiError(400, 'INVALID_BODY', 'Send a JSON object for this action.'));
    }
    // Old path-based clients must not silently upload into the wrong folder.
    if ('path' in req.query || (req.body && 'path' in req.body)) return next(new ApiError(400, 'LEGACY_PATH', 'Refresh the app. File operations now use IDs instead of paths.'));
    req.permissions = permissionContext(repo, req.user.uid);
    next();
  });
  const storage = multer.diskStorage({
    destination: stagingRoot,
    filename(req, file, cb) {
      try { file.displayName = decodeUploadName(file.originalname); cb(null, randomUUID()); }
      catch (err) { cb(err); }
    }
  });
  const upload = multer({ storage, preservePath: true, limits: { fileSize: maxFileSize, files: 10, fields: 0, parts: 10, fieldNameSize: 50 } }).array('files', 10);
  const newItem = (name, kind, ownerId, parentId) => ({
    id: randomUUID(), name, kind, ownerId, parentId, size: 0, mimeType: null,
    storageId: null, created: now(), modified: now(), grants: {}, sharedWith: []
  });
  async function descendants(item) {
    const found = [item];
    for (let index = 0; index < found.length; index++) {
      if (found[index].kind !== 'folder') continue;
      const children = await repo.list({ ownerId: item.ownerId, parentId: found[index].id, limit: MAX_DELETE + 1 });
      found.push(...children);
      if (found.length > MAX_DELETE) throw new ApiError(409, 'TREE_TOO_LARGE', 'This folder contains over 200 items. Delete or move smaller groups first.');
    }
    return found;
  }

  router.get('/files', async (req, res) => {
    const parentId = validateId(req.query.parentId, true);
    const after = validateId(req.query.after, true);
    const shared = req.query.view === 'shared';
    const folder = shared ? null : await req.permissions.folder(parentId);
    const rows = await repo.list(shared
      ? { sharedUid: req.user.uid, after, limit: PAGE_SIZE + 1 }
      : { ownerId: folder.ownerId, parentId, after, limit: PAGE_SIZE + 1 });
    const items = [];
    for (const item of rows.slice(0, PAGE_SIZE)) {
      // In a folder, ownership and inherited grant were checked once above.
      const directRole = item.grants?.[req.user.uid]?.role;
      const role = item.ownerId === req.user.uid ? 'owner'
        : folder?.role === 'editor' || directRole === 'editor' ? 'editor' : 'viewer';
      items.push(publicItem(item, role));
    }
    const crumbs = [];
    if (folder?.item) {
      // Never leak names of ancestors outside the shared subtree.
      let visible = folder.role === 'owner';
      for (const ancestor of [...folder.ancestors].reverse().concat(folder.item)) {
        if (ancestor.grants?.[req.user.uid]) visible = true;
        if (visible) crumbs.push({ id: ancestor.id, name: ancestor.name });
      }
    }
    res.json({ parentId, items, breadcrumbs: crumbs, role: folder?.role || 'viewer',
      nextCursor: rows.length > PAGE_SIZE ? rows[PAGE_SIZE - 1].id : null });
  });

  router.post('/upload', async (req, res) => {
    const parentId = validateId(req.query.parentId, true);
    await req.permissions.folder(parentId, 'editor'); // BEFORE reading the upload body
    if (activeUploads >= 2) throw new ApiError(429, 'UPLOAD_BUSY', 'Two uploads are already in progress. Try again shortly.');
    activeUploads++;
    const moved = [];
    let commitStarted = false;
    try {
      await new Promise((resolve, reject) => upload(req, res, err => err ? reject(err) : resolve()));
      if (!req.files?.length) throw new ApiError(400, 'NO_FILES', 'Select at least one file.');
      const items = await lock('mutations', async () => {
        // Recheck after streaming: a share or folder may have changed meanwhile.
        const folder = await permissionContext(repo, req.user.uid).folder(parentId, 'editor');
        if (folder.ancestors.length >= MAX_DEPTH) throw new ApiError(400, 'MAX_DEPTH', 'Maximum folder depth reached.');
        const records = [];
        for (const file of req.files) {
          const item = newItem(file.displayName, 'file', folder.ownerId, parentId);
          item.storageId = file.filename;
          item.size = file.size;
          item.mimeType = /^[\w.+-]+\/[\w.+-]+$/.test(file.mimetype) ? file.mimetype : 'application/octet-stream';
          const destination = storagePath(storageRoot, item.storageId);
          // UUID destination + exclusive hard link: never overwrite an existing blob.
          await fs.link(file.path, destination);
          moved.push(destination);
          await fs.unlink(file.path);
          records.push(item);
        }
        commitStarted = true;
        await repo.commit({ puts: records });
        return records;
      });
      res.status(201).json({ items: items.map(i => publicItem(i, i.ownerId === req.user.uid ? 'owner' : 'editor')) });
    } finally {
      activeUploads--;
      await Promise.all((req.files || []).map(f => fs.rm(f.path, { force: true }).catch(() => {})));
      // An acknowledged failure before commit is safe to roll back. A network
      // failure DURING commit may have committed: retain blobs for reconciliation.
      if (!commitStarted) await Promise.all(moved.map(p => fs.rm(p, { force: true })));
    }
  });

  router.post('/folders', async (req, res) => {
    const parentId = validateId(req.body.parentId, true);
    const name = validateName(req.body.name);
    const item = await lock('mutations', async () => {
      const folder = await req.permissions.folder(parentId, 'editor');
      if (folder.ancestors.length >= MAX_DEPTH - 1) throw new ApiError(400, 'MAX_DEPTH', 'Maximum folder depth reached.');
      const item = newItem(name, 'folder', folder.ownerId, parentId);
      await repo.commit({ puts: [item] });
      return item;
    });
    res.status(201).json({ item: publicItem(item, item.ownerId === req.user.uid ? 'owner' : 'editor') });
  });

  router.patch('/rename', async (req, res) => {
    const id = validateId(req.body.id);
    const name = validateName(req.body.newName);
    await lock('mutations', async () => {
      const { item } = await req.permissions.access(id, 'editor');
      await repo.commit({ puts: [{ ...item, name, modified: now() }] });
    });
    res.json({ ok: true });
  });

  router.patch('/move', async (req, res) => {
    const id = validateId(req.body.id);
    const parentId = validateId(req.body.parentId, true);
    await lock('mutations', async () => {
      const { item } = await req.permissions.access(id, 'owner');
      const folder = await req.permissions.folder(parentId, 'owner');
      if (folder.ownerId !== item.ownerId) throw new ApiError(403, 'PERMISSION_DENIED', 'Move items only within your own drive.');
      if (parentId === id || folder.ancestors.some(p => p.id === id)) throw new ApiError(400, 'FOLDER_CYCLE', 'A folder cannot be moved inside itself.');
      const subtree = item.kind === 'folder' ? await descendants(item) : [item];
      const byId = new Map(subtree.map(row => [row.id, row]));
      for (const child of subtree) {
        let depth = parentId ? folder.ancestors.length + 1 : 0;
        let cursor = child;
        while (cursor.id !== item.id) { depth++; cursor = byId.get(cursor.parentId); }
        if (depth >= MAX_DEPTH) throw new ApiError(400, 'MAX_DEPTH', 'This move would exceed the maximum folder depth.');
      }
      await repo.commit({ puts: [{ ...item, parentId, modified: now() }] });
    });
    res.json({ ok: true });
  });

  router.delete('/delete', async (req, res) => {
    const id = validateId(req.query.id);
    let cleanupPending = false;
    await lock('mutations', async () => {
      const { item } = await req.permissions.access(id, 'owner');
      const subtree = await descendants(item);
      // Atomic metadata deletion revokes all access before local file cleanup.
      // If the database fails, every local blob is retained.
      await repo.commit({ deletes: subtree.map(i => i.id) });
      for (const child of subtree) {
        if (!child.storageId) continue;
        try { await fs.unlink(await existingFile(storageRoot, child.storageId)); }
        catch (err) { if (err.code !== 'ENOENT') cleanupPending = true; }
      }
    });
    res.json({ ok: true, cleanupPending });
  });

  router.get('/shares', async (req, res) => {
    const { item } = await req.permissions.access(validateId(req.query.id), 'owner');
    res.json({ shares: Object.entries(item.grants).map(([uid, grant]) => ({ uid, ...grant })) });
  });
  router.put('/shares', async (req, res) => {
    const id = validateId(req.body.id);
    const { email, role } = req.body;
    if (typeof email !== 'string' || email.length > 254 || !['viewer', 'editor'].includes(role)) throw new ApiError(400, 'INVALID_SHARE', 'Enter an existing account email and select viewer or editor.');
    await lock('mutations', async () => {
      const { item } = await req.permissions.access(id, 'owner');
      let user;
      try { user = await auth.getUserByEmail(email.trim()); }
      catch { throw new ApiError(400, 'INVALID_RECIPIENT', 'This account cannot receive a share. Ask them to register first.'); }
      if (user.disabled || user.uid === item.ownerId) throw new ApiError(400, 'INVALID_RECIPIENT', 'Choose another active account.');
      if (!user.emailVerified) throw new ApiError(400, 'UNVERIFIED_RECIPIENT', 'Ask the recipient to verify their account email before sharing.');
      // UIDs from Firebase are not used as raw Firestore field paths.
      const grants = { ...item.grants, [user.uid]: { role, email: user.email } };
      if (Object.keys(grants).length > 20) throw new ApiError(400, 'SHARE_LIMIT', 'Share each item with at most 20 people.');
      await repo.commit({ puts: [{ ...item, grants, sharedWith: Object.keys(grants), modified: now() }] });
    });
    res.json({ ok: true });
  });
  router.delete('/shares', async (req, res) => {
    const id = validateId(req.body.id);
    if (typeof req.body.uid !== 'string') throw new ApiError(400, 'INVALID_RECIPIENT', 'Select a recipient.');
    await lock('mutations', async () => {
      const { item } = await req.permissions.access(id, 'owner');
      const grants = { ...item.grants };
      delete grants[req.body.uid];
      await repo.commit({ puts: [{ ...item, grants, sharedWith: Object.keys(grants), modified: now() }] });
    });
    res.json({ ok: true });
  });

  for (const endpoint of ['download', 'preview']) {
    router.get('/' + endpoint, async (req, res, next) => {
      const { item } = await req.permissions.access(validateId(req.query.id));
      if (item.kind !== 'file') throw new ApiError(400, 'NOT_A_FILE', 'Open the folder to select a file.');
      const target = await existingFile(storageRoot, item.storageId);
      res.set('Cache-Control', 'private, no-store');
      // Every transfer is an attachment. Safe previews are built from blobs/text
      // by the UI, never by executing uploaded HTML/SVG on the app origin.
      res.type('application/octet-stream');
      res.download(target, item.name, { dotfiles: 'deny' }, err => { if (err) next(err); });
    });
  }
  return router;
}
