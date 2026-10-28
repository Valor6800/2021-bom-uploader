/**
 * Signed-cookie sessions.
 *
 * Stateless on purpose: the signed cookie carries the identity Authentik
 * already vouched for, so there is no session store to run, and a server
 * restart does not log everyone out.
 *
 * The cookie is signed, not encrypted — its contents are readable by the
 * browser that holds it, which is fine because they are that user's own
 * identity. What matters is that it cannot be forged or altered, which the
 * HMAC guarantees, and that it expires.
 *
 * Every payload carries a `typ` claim naming what it is for, and reads demand
 * the type they expect. Without that, two cookies signed with the same secret
 * are interchangeable: the pre-auth handshake cookie handed to any anonymous
 * caller by /auth/login could be replayed as a session cookie, which is a
 * complete authentication bypass.
 *
 * This is not invented authentication: the credential is an Authentik ID
 * token, verified against Authentik's JWKS before anything is written here.
 * The cookie only carries the result forward.
 */

import crypto from 'node:crypto';

/** Cookie holding the authenticated session. */
export const SESSION_COOKIE = 'valorbom_session';

/** Short-lived cookie holding the in-flight OIDC handshake state. */
export const OIDC_STATE_COOKIE = 'valorbom_oidc';

/** How long a session lasts before the user is sent back to Authentik. */
export const SESSION_TTL_SECONDS = 12 * 60 * 60;

/** How long the login handshake may take. */
export const OIDC_STATE_TTL_SECONDS = 10 * 60;

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function sign(payload, secret) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64url');
}

/**
 * What a sealed payload is for. Checked on every read so one kind of cookie
 * can never be presented as another.
 */
export const CookieType = Object.freeze({
  SESSION: 'session',
  OIDC_STATE: 'oidc-state',
});

/**
 * Encode and sign a payload for transport in a cookie.
 *
 * @param {object} payload
 * @param {string} secret
 * @param {string} typ  One of CookieType; stamped into the payload
 * @returns {string} `<base64url payload>.<signature>`
 */
export function sealCookie(payload, secret, typ) {
  if (!typ) throw new Error('sealCookie requires a cookie type');
  const encoded = base64url(JSON.stringify({ ...payload, typ }));
  return `${encoded}.${sign(encoded, secret)}`;
}

/**
 * Verify and decode a cookie value.
 *
 * Returns null for anything that is not exactly a valid, unexpired,
 * correctly-signed payload of the expected type — a tampered or
 * wrong-purpose cookie is indistinguishable from no cookie at all, so callers
 * cannot accidentally treat one as partial trust.
 *
 * @param {string|undefined} value
 * @param {string} secret
 * @param {string} expectedType  One of CookieType
 * @returns {object|null}
 */
export function openCookie(value, secret, expectedType) {
  if (!expectedType) throw new Error('openCookie requires an expected cookie type');
  if (!value || typeof value !== 'string') return null;

  const separator = value.lastIndexOf('.');
  if (separator <= 0) return null;

  const encoded = value.slice(0, separator);
  const signature = value.slice(separator + 1);
  const expected = sign(encoded, secret);

  // Constant-time compare; bail if the lengths differ, since timingSafeEqual
  // throws on mismatched buffers.
  const given = Buffer.from(signature);
  const want = Buffer.from(expected);
  if (given.length !== want.length) return null;
  if (!crypto.timingSafeEqual(given, want)) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  } catch {
    return null;
  }

  if (typeof payload?.exp !== 'number' || payload.exp * 1000 <= Date.now()) return null;

  // The purpose check. A correctly-signed cookie of the wrong kind is refused.
  if (payload.typ !== expectedType) return null;

  return payload;
}

/**
 * Serialize a Set-Cookie header value.
 *
 * `Secure` is set unless explicitly disabled, which is needed for plain-HTTP
 * loopback development; in every other case the cookie must not travel
 * unencrypted.
 *
 * @param {object} options
 * @returns {string}
 */
export function serializeCookie({ name, value, maxAgeSeconds, secure = true, path = '/' }) {
  const parts = [
    `${name}=${value}`,
    `Path=${path}`,
    'HttpOnly',
    // Lax rather than Strict: the browser arrives here via a redirect from
    // Authentik, and Strict would drop the cookie on that navigation.
    'SameSite=Lax',
  ];

  if (secure) parts.push('Secure');
  if (maxAgeSeconds === 0) parts.push('Max-Age=0', 'Expires=Thu, 01 Jan 1970 00:00:00 GMT');
  else if (maxAgeSeconds) parts.push(`Max-Age=${maxAgeSeconds}`);

  return parts.join('; ');
}

/**
 * Parse a Cookie request header.
 *
 * @param {string|undefined} header
 * @returns {Record<string, string>}
 */
export function parseCookies(header) {
  const jar = {};
  if (!header) return jar;

  for (const piece of header.split(';')) {
    const eq = piece.indexOf('=');
    if (eq < 0) continue;
    const name = piece.slice(0, eq).trim();
    if (name) jar[name] = piece.slice(eq + 1).trim();
  }

  return jar;
}
