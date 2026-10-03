import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { safePath, STORAGE_ROOT } from '../utils/safePath.js';

const router = express.Router();

// Handles try catch errors
function handleError(err, res) {
  if (err.message === 'Invalid path' || err.message === 'Invalid name')
    return res.status(400).json({ error: err.message });
  if (err.code === 'ENOENT')
    return res.status(404).json({ error: 'Not found' });
  if (err.code === 'EEXIST' || err.code === 'ENOTEMPTY')
    return res.status(409).json({ error: 'Already exists or not empty' });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
}

// Makes sure the name is usable
function validateName(name) {
  if (typeof name !== 'string' || !name.trim() || /[\\/]/.test(name) || name === '.' || name === '..') {
    throw new Error('Invalid name');
  }
  return name.trim();
}

// Checks if the path exists
async function exists(p) {
  try {
    await fs.access(p);
    return true;
  } catch (err) {
    if (err.code === 'ENOENT') return false;
    throw err; 
  }
}

// GET files in specific path OR storage dir
router.get('/files', async (req, res) => {
  try {
    const dir = safePath(req.query.path);
    const entries = await fs.readdir(dir, { withFileTypes: true });

    const items = await Promise.all(
      entries.map(async (entry) => {
        const info = await fs.stat(path.join(dir, entry.name));
        return {
          name: entry.name,
          isDirectory: entry.isDirectory(),
          size: info.size,
          modified: info.mtime,
        };
      })
    );

    res.json({ path: req.query.path || '', items });
  } catch (err) {
    handleError(err, res);
  }
});

// POST creates a folder
// Body: { "path": "docs", "name": "School" }
router.post('/folders', async (req,res) => {
    try {
        const parent = safePath(req.body.path);
        const name = validateName(req.body.name);
        await fs.mkdir(path.join(parent,name));
        res.status(201).json({ok:true});
    } catch (error) {
        handleError(error, res);
    }
});

// PATCH renames the file
//Body: { "path": "docs/old.txt", "newName": "new.txt" }
router.patch('/rename', async (req, res) =>{
    try {
        const source = safePath(req.body.path);
        const newName = validateName(req.body.newName);
        const target = path.join(path.dirname(source), newName);
        safePath(path.relative(STORAGE_ROOT, target)); // verify destenation again

        const caseOnlyChange = source.toLowerCase() === target.toLowerCase();
        if (!caseOnlyChange && await exists(target)) {
            return res.status(409).json({ error: 'A file with that name already exists' }); // 409 = duplicate
        }

        await fs.rename(source, target);
        res.json({ ok: true });
    } catch (error) {
        handleError(error, res);
    }
});

// DELETE deletes a file
// /api/files?path=...
router.delete('/delete', async (req,res) => {
    try {
        const target = safePath(req.query.path)
        if (target === STORAGE_ROOT) {
            return res.status(400).json({error:'Cannot delete the root'});
        }
        await fs.rm(target, {recursive: true});
        res.json({ok: true});
    } catch (error) {
        handleError(error,res);
    }
})

export default router;