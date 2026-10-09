import { ApiError } from '../utils/errors.js';
export function requireAuth(auth) {
  return async (req, res, next) => {
    const match = /^Bearer (\S+)$/.exec(req.headers.authorization || '');
    if (!match) return next(new ApiError(401, 'UNAUTHORIZED', 'Log in to continue.'));
    try {
      // Verify signature, expiry, revoked sessions and disabled accounts.
      req.user = await auth.verifyIdToken(match[1], true);
      next();
    } catch {
      next(new ApiError(401, 'UNAUTHORIZED', 'Your session expired. Please log in again.'));
    }
  };
}
