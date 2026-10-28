/**
 * Minimal CORS middleware (dependency-free).
 *
 * In production the SPA is served same-origin from this server, so no CORS
 * headers are needed at all — and that is the default. Previously this
 * defaulted to `Access-Control-Allow-Origin: *`, which let any site open in
 * the operator's browser call these endpoints; since they can transition Jira
 * tickets and write the team budget sheet, the default is now same-origin.
 *
 * Set CORS_ORIGIN to a specific origin to allow a cross-origin client (e.g. a
 * separately-hosted Vite dev server). The local `npm run dev` setup does not
 * need it — Vite proxies /api to this server, so requests are same-origin.
 */
export function cors(req, res, next) {
  const origin = process.env.CORS_ORIGIN;

  if (origin) {
    res.set('Access-Control-Allow-Origin', origin);
    res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    res.set('Vary', 'Origin');
  }

  // Short-circuit preflight requests.
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
}
