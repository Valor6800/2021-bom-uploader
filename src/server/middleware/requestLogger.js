/**
 * Lightweight request logger. Logs method, path, status, and duration for each
 * request once the response finishes. Intentionally dependency-free.
 */
export function requestLogger(req, res, next) {
  const start = Date.now();
  res.on('finish', () => {
    const ms = Date.now() - start;
    console.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${ms}ms`);
  });
  next();
}
