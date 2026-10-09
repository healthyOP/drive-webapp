import multer from 'multer';

export class ApiError extends Error {
  constructor(status, code, message) { super(message); this.status = status; this.code = code; }
}
export function handleError(err, res) {
  let status = err.status || 500;
  let code = err instanceof ApiError ? err.code : 'SERVER_ERROR';
  let message = err instanceof ApiError ? err.message : 'The server could not complete this request.';
  if (err instanceof multer.MulterError) {
    status = err.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
    code = err.code; message = 'Upload rejected: ' + err.message;
  } else if (err.type === 'entity.parse.failed') {
    status = 400; code = 'INVALID_JSON'; message = 'Send valid JSON.';
  } else if (err.code === 'ENOENT') {
    status = 404; code = 'NOT_FOUND'; message = 'The file is no longer available on this server.';
  } else if (err.code === 8 || err.code === 'RESOURCE_EXHAUSTED') {
    status = 503; code = 'QUOTA_EXCEEDED'; message = 'The free database quota is exhausted. Try again after it resets.';
  }
  if (status >= 500) console.error('Request failed:', code);
  res.status(status).json({ error: { code, message } });
}
