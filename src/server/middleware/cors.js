/**
 * Minimal CORS middleware (dependency-free).
 *
 * In production the SPA is served same-origin from this server, so CORS is not
 * strictly required. It is useful for local development (a separate Vite dev
 * server) and for other internal clients calling the API.
 *
 * Set CORS_ORIGIN to lock this down to a specific origin; defaults to "*".
 */
export function cors(req, res, next) {
  const origin = process.env.CORS_ORIGIN || '*';
  res.set('Access-Control-Allow-Origin', origin);
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  // Short-circuit preflight requests.
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
}
