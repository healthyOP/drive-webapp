import express from 'express';
import path from 'node:path';
import helmet from 'helmet';
import { rateLimit } from 'express-rate-limit';
import { createFilesRouter } from './routes/files.js';
import { requireAuth } from './middleware/auth.js';
import { ApiError, handleError } from './utils/errors.js';

export function createApp(options) {
  const app = express();
  app.disable('x-powered-by');
  app.use(helmet({
    // LAN HTTP is supported for local experiments; use HTTPS for real accounts.
    strictTransportSecurity: false,
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], styleSrc: ["'self'"],
      connectSrc: ["'self'", 'https://identitytoolkit.googleapis.com', 'https://securetoken.googleapis.com', 'https://www.googleapis.com'],
      imgSrc: ["'self'", 'blob:'], mediaSrc: ["'self'", 'blob:'], frameSrc: ['blob:'],
      objectSrc: ["'none'"], baseUri: ["'none'"], frameAncestors: ["'none'"],
      upgradeInsecureRequests: null
    } }
  }));
  app.use('/api', (req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
  app.get('/api/config', (req, res) => res.json({ firebase: options.clientConfig, maxFileSize: options.maxFileSize || 104857600, maxFiles: 10 }));
  app.use('/api', rateLimit({ windowMs: 60000, limit: 120, standardHeaders: 'draft-8', legacyHeaders: false,
    handler: (req, res) => handleError(new ApiError(429, 'RATE_LIMIT', 'Too many requests. Wait a minute and try again.'), res) }));
  app.use('/api', requireAuth(options.auth));
  app.use('/api', express.json({ limit: '16kb' }));
  app.use('/api', createFilesRouter(options));
  app.use('/api', (req, res) => handleError(new ApiError(404, 'ENDPOINT_NOT_FOUND', 'This action is unavailable. Refresh the app and try again.'), res));
  app.use(express.static(path.join(import.meta.dirname, 'public'), { dotfiles: 'deny' }));
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    handleError(err, res);
  });
  return app;
}
