/**
 * The access gate.
 *
 * Fails closed by design. If the Authentik settings are missing the gate
 * rejects every request rather than waving them through, so a half-finished
 * deployment is unreachable instead of wide open. The only way past an
 * unconfigured gate is AUTH_DEV_BYPASS, which is off by default, named for
 * exactly what it does, and refused unless the server is bound to loopback.
 */

import { SESSION_COOKIE, CookieType, openCookie, parseCookies } from './session.js';

/** Group names come from config, but are still text in an HTML page. */
const escapeHtml = (text) => String(text).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

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
  // Demanding the session type is what stops the pre-auth handshake cookie —
  // which /auth/login hands to any anonymous caller — being replayed here.
  return openCookie(jar[SESSION_COOKIE], secret, CookieType.SESSION);
}

/**
 * True when the request wants JSON back rather than a redirect to the login
 * page — an API call from the SPA, as opposed to a browser navigation.
 *
 * @param {import('express').Request} req
 * @returns {boolean}
 */
function wantsJson(req) {
  // originalUrl, not path: the gate is mounted per-route (app.use('/api/
  // purchasing', gate, ...)), so Express strips the prefix and req.path is
  // '/queue'. Testing req.path sent XHR callers a 302 to the login page
  // instead of a 401, which the SPA cannot act on.
  if ((req.originalUrl ?? '').startsWith('/api/')) return true;
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
 * @param {string[]} [params.groups]  Admit members of any of these. Defaults to
 *   `REQUIRE_GROUP` alone (none: rely on Authentik's application binding).
 * @param {Console} [params.logger]
 * @returns {import('express').RequestHandler}
 */
export function requireAuth({ authConfig, host, groups, logger = console }) {
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

  const required = (groups ?? [authConfig.requireGroup]).map((g) => String(g ?? '').trim()).filter(Boolean);
  const named = required.map((g) => `"${g}"`).join(' or ');

  return (req, res, next) => {
    const session = readSession(req, authConfig.sessionSecret);

    if (!session) {
      if (wantsJson(req)) {
        return res.status(401).json({ error: 'Not signed in', status: 401, loginUrl: '/auth/login' });
      }
      const returnTo = encodeURIComponent(req.originalUrl || '/');
      return res.redirect(`/auth/login?returnTo=${returnTo}`);
    }

    // The group check. Authentik's application binding admits the whole team
    // (students and mentors), so this is what keeps a gate narrower than that
    // (the mentor-only pages), and closes the hole where the binding is
    // removed and Authentik would admit any account.
    if (required.length && !required.some((g) => (session.groups ?? []).includes(g))) {
      logger.warn(`Denied ${session.username || session.sub}: not in ${named}`);

      if (wantsJson(req)) {
        return res.status(403).json({ error: `Requires membership of ${named}`, status: 403 });
      }
      return res.status(403).send(
        `<h1>Not authorised</h1><p>This page is limited to members of ${escapeHtml(named)}.</p>`
        + '<p><a href="/auth/logout">Sign out</a></p>',
      );
    }

    req.user = session;
    return next();
  };
}
