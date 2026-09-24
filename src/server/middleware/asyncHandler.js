/**
 * Wrap an async route handler so rejected promises are forwarded to Express's
 * error-handling middleware instead of being repeated as per-route try/catch.
 *
 * Usage:
 *   router.get('/', asyncHandler(async (req, res) => { ... }));
 *
 * @param {(req, res, next) => Promise<any>} fn
 * @returns {(req, res, next) => void}
 */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}
