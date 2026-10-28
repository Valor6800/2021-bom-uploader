/**
 * The access gate.
 *
 * Fails closed by design. If the Authentik settings are missing the gate
 * rejects every request rather than waving them through, so a half-finished
 * deployment is unreachable instead of wide open. The only way past an
 * unconfigured gate is AUTH_DEV_BYPASS, which is off by default, named for
 * exactly what it does, and refused unless the server is bound to loopback.
 */

import { SESSION_COOKIE, openCookie, parseCookies } from './session.js';

/** Hosts that mean "not reachable from the network". */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']);

/**
 * @param {string|undefined} host
 * @returns {boolean}
 */
export function isLoopbackHost(host) {
  return LOOPBACK_HOSTS.has(String(host ?? '').trim());
}

/**
 * Decide whether the dev bypass may be used, and say why not when it may not.
 *
 * The bypass existing is not enough: it is only honoured when nothing outside
 * this machine can reach the server. Otherwise a stray env var would silently
 * publish the pages, which is the exact failure this is meant to prevent.
 *
 * @param {{ devBypass: boolean }} authConfig
 * @param {string} host  The interface the server is bound to
 * @returns {{ allowed: boolean, reason: string|null }}
 */
export function evaluateDevBypass(authConfig, host) {
  if (!authConfig.devBypass) return { allowed: false, reason: null };

  if (!isLoopbackHost(host)) {
    return {
      allowed: false,
      reason: `AUTH_DEV_BYPASS is set but the server is bound to ${host}, which is reachable `
        + 'beyond this machine. The bypass is ignored and every request will be rejected. '
        + 'Either bind HOST=127.0.0.1 or configure Authentik properly.',
    };
  }

  return { allowed: true, reason: null };
}

/**
 * Read the signed session cookie off a request.
 *
 * @param {import('express').Request} req
 * @param {string} secret
 * @returns {object|null}
 */
export function readSession(req, secret) {
  if (!secret) return null;
  const jar = parseCookies(req.headers.cookie);
  return openCookie(jar[SESSION_COOKIE], secret);
}

/**
 * True when the request wants JSON back rather than a redirect to the login
 * page — an API call from the SPA, as opposed to a browser navigation.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function wantsJson(req) {
  if (req.path.startsWith('/api/')) return true;
  if (req.xhr) return true;
  const accept = String(req.headers.accept ?? '');
  return accept.includes('application/json') && !accept.includes('text/html');
}

/**
 * Build the gate middleware.
 *
 * @param {object} params
 * @param {ReturnType<typeof import('./oidcConfig.js').readAuthConfig>} params.authConfig
 * @param {string} params.host  Interface the server is bound to
 * @param {Console} [params.logger]
 * @returns {import('express').RequestHandler}
 */
export function requireAuth({ authConfig, host, logger = console }) {
  const bypass = evaluateDevBypass(authConfig, host);

  if (bypass.reason) logger.error(`SECURITY: ${bypass.reason}`);

  if (bypass.allowed) {
    logger.warn(
      'AUTH_DEV_BYPASS is on and the server is loopback-only: requests are not authenticated. '
      + 'Never set this on a deployment.',
    );

    return (req, res, next) => {
      req.user = { sub: 'dev-bypass', name: 'Developer (bypass)', email: '', username: 'dev', groups: [] };
      next();
    };
  }

  if (!authConfig.configured) {
    logger.error(
      `SECURITY: authentication is not configured (missing ${authConfig.missing.join(', ')}). `
      + 'Every request will be rejected until it is. See README "Authentication".',
    );

    return (req, res) => {
      res.status(503).json({
        error: 'This server is not configured for authentication yet, so it is refusing all '
          + `requests. Missing: ${authConfig.missing.join(', ')}.`,
        status: 503,
      });
    };
  }

  const required = authConfig.requireGroup.trim();

  return (req, res, next) => {
    const session = readSession(req, authConfig.sessionSecret);

    if (!session) {
      if (wantsJson(req)) {
        return res.status(401).json({ error: 'Not signed in', status: 401, loginUrl: '/auth/login' });
      }
      const returnTo = encodeURIComponent(req.originalUrl || '/');
      return res.redirect(`/auth/login?returnTo=${returnTo}`);
    }

    // Optional second check. Authentik's application binding is the primary
    // enforcement; this closes the hole where that binding is removed and the
    // app would otherwise admit any Authentik account.
    if (required && !(session.groups ?? []).includes(required)) {
      logger.warn(`Denied ${session.username || session.sub}: not in "${required}"`);

      if (wantsJson(req)) {
        return res.status(403).json({ error: `Requires membership of "${required}"`, status: 403 });
      }
      return res.status(403).send(
        `<h1>Not authorised</h1><p>This tool is limited to members of "${required}".</p>`
        + '<p><a href="/auth/logout">Sign out</a></p>',
      );
    }

    req.user = session;
    return next();
  };
}
