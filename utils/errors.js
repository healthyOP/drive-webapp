import multer from 'multer';

export function handleError(err, res) {
  if (err.message === 'Invalid path' || err.message === 'Invalid name')
    return res.status(400).json({ error: err.message });

  if (err.type === 'entity.parse.failed')
    return res.status(400).json({ error: 'Malformed JSON' });

  if (err instanceof multer.MulterError) {
    const status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    return res.status(status).json({ error: err.message });
  }

  if (err.code === 'ENOENT')
    return res.status(404).json({ error: 'Not found' });
  if (err.code === 'ENOTDIR')
    return res.status(400).json({ error: 'Not a folder' });
  if (err.code === 'EEXIST' || err.code === 'ENOTEMPTY')
    return res.status(409).json({ error: 'Already exists or not empty' });

  console.error(err);
  res.status(500).json({ error: 'Server error' });
}