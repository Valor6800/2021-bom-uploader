/**
 * Auth Routes — the Authentik login handshake.
 *
 * GET /auth/login     start the authorization-code flow
 * GET /auth/callback  verify the response and establish a session
 * GET /auth/logout    drop the session (and end the Authentik one if offered)
 * GET /auth/me        who the caller is; used by the SPA to show the user
 *
 * These sit outside the gate — they are how you get through it.
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import {
  SESSION_COOKIE,
  OIDC_STATE_COOKIE,
  SESSION_TTL_SECONDS,
  OIDC_STATE_TTL_SECONDS,
  sealCookie,
  openCookie,
  parseCookies,
  serializeCookie,
} from '../auth/session.js';
import { readSession } from '../auth/requireAuth.js';

/**
 * Only allow redirects back to a path on this site. Without this, a crafted
 * `returnTo` would turn the login endpoint into an open redirect.
 *
 * @param {*} value
 * @returns {string}
 */
export function safeReturnTo(value) {
  const candidate = String(value ?? '/');
  // Must be a single-slash-rooted path: rejects "//evil.com" and "https://…".
  if (!candidate.startsWith('/') || candidate.startsWith('//')) return '/';
  return candidate;
}

/**
 * @param {object} deps
 * @param {import('../auth/oidcConfig.js').OidcProvider} deps.provider
 * @param {ReturnType<typeof import('../auth/oidcConfig.js').readAuthConfig>} deps.authConfig
 * @returns {Router}
 */
export default function authRoutes({ provider, authConfig }) {
  const router = Router();
  const secure = authConfig.cookieSecure;

  router.get('/login', asyncHandler(async (req, res) => {
    if (!authConfig.configured) {
      return res.status(503).send(
        '<h1>Authentication not configured</h1><p>Missing: '
        + `${authConfig.missing.join(', ')}.</p>`,
      );
    }

    const { url, handshake } = await provider.startLogin(safeReturnTo(req.query.returnTo));

    res.setHeader('Set-Cookie', serializeCookie({
      name: OIDC_STATE_COOKIE,
      value: sealCookie(
        { ...handshake, exp: Math.floor(Date.now() / 1000) + OIDC_STATE_TTL_SECONDS },
        authConfig.sessionSecret,
      ),
      maxAgeSeconds: OIDC_STATE_TTL_SECONDS,
      secure,
    }));

    return res.redirect(url);
  }));

  router.get('/callback', asyncHandler(async (req, res) => {
    if (!authConfig.configured) return res.status(503).send('Authentication not configured');

    const jar = parseCookies(req.headers.cookie);
    const handshake = openCookie(jar[OIDC_STATE_COOKIE], authConfig.sessionSecret);

    if (!handshake) {
      // Expired, tampered with, or the user bookmarked the callback.
      return res.status(400).send(
        '<h1>Login expired</h1><p>The sign-in attempt took too long or was interrupted.</p>'
        + '<p><a href="/auth/login">Try again</a></p>',
      );
    }

    // The URL Authentik actually redirected to, rebuilt from the configured
    // redirect URI so a proxy rewriting Host cannot change what is verified.
    const currentUrl = new URL(authConfig.redirectUri);
    currentUrl.search = new URL(req.originalUrl, 'http://placeholder').search;

    let user;
    try {
      user = await provider.completeLogin(currentUrl, handshake);
    } catch (err) {
      // A non-member hits this path: Authentik refuses the authorization, so
      // there is no valid code to exchange.
      return res.status(403).send(
        '<h1>Sign-in refused</h1>'
        + '<p>Authentik did not authorise this account for the parts portal. '
        + 'Access is limited to the mentors group.</p>'
        + `<p class="detail">${escapeHtml(err.message)}</p>`
        + '<p><a href="/auth/login">Try again</a></p>',
      );
    }

    const session = {
      ...user,
      exp: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
    };

    res.setHeader('Set-Cookie', [
      serializeCookie({
        name: SESSION_COOKIE,
        value: sealCookie(session, authConfig.sessionSecret),
        maxAgeSeconds: SESSION_TTL_SECONDS,
        secure,
      }),
      // The handshake is spent.
      serializeCookie({ name: OIDC_STATE_COOKIE, value: '', maxAgeSeconds: 0, secure }),
    ]);

    return res.redirect(safeReturnTo(handshake.returnTo));
  }));

  router.get('/logout', asyncHandler(async (req, res) => {
    res.setHeader('Set-Cookie', [
      serializeCookie({ name: SESSION_COOKIE, value: '', maxAgeSeconds: 0, secure }),
      serializeCookie({ name: OIDC_STATE_COOKIE, value: '', maxAgeSeconds: 0, secure }),
    ]);

    // Clearing our cookie alone would leave the Authentik session live, so the
    // next visit would sign straight back in without a prompt.
    let endSession = null;
    if (authConfig.configured) {
      try {
        endSession = await provider.endSessionUrl();
      } catch {
        endSession = null;
      }
    }

    return res.redirect(endSession ?? '/');
  }));

  router.get('/me', (req, res) => {
    const session = readSession(req, authConfig.sessionSecret);

    if (!session) {
      return res.status(401).json({ error: 'Not signed in', status: 401, loginUrl: '/auth/login' });
    }

    return res.json({
      name: session.name,
      email: session.email,
      username: session.username,
      groups: session.groups ?? [],
    });
  });

  return router;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
