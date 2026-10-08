import express from 'express';
import fs from 'fs/promises';
import path from 'path';
import { safePath, STORAGE_ROOT } from '../utils/safePath.js';
import { handleError } from '../utils/errors.js';
import multer from 'multer';


const router = express.Router();


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

// Finding the file a unique name using a (number / index) system 
async function uniqueName(dir, name) {
  const ext = path.extname(name);
  const base = path.basename(name, ext);
  let candidate = name;
  let i = 1;
  while (await exists(path.join(dir,candidate))){
    candidate = `${base} (${i})${ext}` // name (i).ext
    i++;
  }
  return candidate;
}

const storage = multer.diskStorage({
  async destination(req, file, cb) {

        try {

            const dir = safePath(req.query.path);

            const info = await fs.stat(dir);

            if (!info.isDirectory()) {
                throw new Error("Invalid path");
            }

            cb(null, dir);

        } catch (err) {

            cb(err);
        }
    },
  async filename(req,file,cb){
    try {
      const dir = safePath(req.query.path);
      const clean = validateName(path.basename(file.originalname));
      cb(null, await uniqueName(dir, clean)); // names the file
    } catch (error) {
      cb(error);
    }
  },
});

const upload = multer({storage});

// POST upload files
router.post('/upload', upload.array('files'), (req,res) =>{
  if (!req.files || req.files.length === 0){
    return res.status(400).json({error: ' No files uploaded'});
  }
  res.status(201).json({upload: req.files.map((f) => f.filename)});
})

// GET preview files in browser
router.get('/preview', async (req, res) => {
  try {
    const target = safePath(req.query.path);

    const info = await fs.stat(target);

    if (info.isDirectory()) {
      return res.status(400).json({
        error: 'Cannot preview a folder'
      });
    }

    res.sendFile(target, (err) => {
      if (err && !res.headersSent) {
        handleError(err, res);
      }
    });

  } catch (error) {
    handleError(error, res);
  }
});

// GET download files
router.get('/download', async (req,res) =>{
  try {
    const target = safePath(req.query.path);
    const info = await fs.stat(target);
    if (info.isDirectory()){
      return res.status(400).json({error: 'Canot download a folder'});
    }
    res.download(target, (err) => {
      if (err && !res.headersSent) handleError(err, res);
    });
    
  } catch (error) {
    handleError(error, res);
  }
});

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
// Exp: Body: { "path": "docs", "name": "School" }
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
});

export default router;