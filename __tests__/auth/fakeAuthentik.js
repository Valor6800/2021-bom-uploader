/**
 * A minimal stand-in for Authentik, good enough to exercise the real
 * openid-client against a real signed ID token.
 *
 * This is what makes the auth tests meaningful rather than decorative: the
 * code under test performs genuine discovery, a genuine PKCE code exchange,
 * and genuine JWKS signature verification. Mocking openid-client instead would
 * prove only that the mock was called.
 *
 * It serves the same endpoints Authentik does:
 *   /application/o/test/.well-known/openid-configuration
 *   /application/o/test/jwks/
 *   /application/o/authorize/
 *   /application/o/token/
 *   /application/o/end-session/
 */

import crypto from 'node:crypto';
import express from 'express';
import { createServer } from 'node:http';

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

/** Export an RSA public key as a JWK. */
function toJwk(publicKey, kid) {
  const jwk = publicKey.export({ format: 'jwk' });
  return { ...jwk, kid, use: 'sig', alg: 'RS256' };
}

/** Sign a JWT with RS256, the algorithm Authentik uses by default. */
function signJwt(payload, privateKey, kid) {
  const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid }));
  const body = base64url(JSON.stringify(payload));
  const signingInput = `${header}.${body}`;

  const signature = crypto
    .sign('RSA-SHA256', Buffer.from(signingInput), privateKey)
    .toString('base64url');

  return `${signingInput}.${signature}`;
}

/**
 * Start a fake provider on an ephemeral loopback port.
 *
 * @param {object} [options]
 * @param {string} [options.clientId]
 * @param {string} [options.clientSecret]
 * @returns {Promise<object>} Handle with `issuer`, `setUser`, `close`, etc.
 */
export async function startFakeAuthentik({
  clientId = 'valorbom',
  clientSecret = 'test-client-secret',
} = {}) {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const kid = 'test-key-1';

  const app = express();
  app.use(express.urlencoded({ extended: false }));

  /** Authorization requests seen, so tests can assert on PKCE/state/nonce. */
  const authorizeRequests = [];
  /** code -> the request that produced it. */
  const issuedCodes = new Map();

  const state = {
    /** Claims the next ID token will carry. */
    user: {
      sub: 'user-1',
      name: 'Michael Ray',
      preferred_username: 'mray190',
      email: 'mray@example.com',
      groups: ['valor mentors'],
    },
    /** Set to break the signature, to prove verification is real. */
    signWithWrongKey: false,
    /** Set to issue a mismatched nonce, to prove the nonce is checked. */
    tamperNonce: false,
    /** Set to issue an already-expired token. */
    expired: false,
  };

  let issuer;

  app.get('/application/o/test/.well-known/openid-configuration', (req, res) => {
    res.json({
      issuer: `${issuer}/application/o/test/`,
      authorization_endpoint: `${issuer}/application/o/authorize/`,
      token_endpoint: `${issuer}/application/o/token/`,
      jwks_uri: `${issuer}/application/o/test/jwks/`,
      end_session_endpoint: `${issuer}/application/o/end-session/`,
      response_types_supported: ['code'],
      subject_types_supported: ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      token_endpoint_auth_methods_supported: ['client_secret_post', 'client_secret_basic'],
      code_challenge_methods_supported: ['S256'],
      scopes_supported: ['openid', 'profile', 'email', 'groups'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
    });
  });

  app.get('/application/o/test/jwks/', (req, res) => {
    res.json({ keys: [toJwk(publicKey, kid)] });
  });

  // Stands in for the user signing in and consenting.
  app.get('/application/o/authorize/', (req, res) => {
    authorizeRequests.push({ ...req.query });

    const code = `code-${crypto.randomUUID()}`;
    issuedCodes.set(code, { ...req.query });

    const redirect = new URL(String(req.query.redirect_uri));
    redirect.searchParams.set('code', code);
    redirect.searchParams.set('state', String(req.query.state ?? ''));
    // Authentik echoes the issuer back; openid-client checks it when present.
    redirect.searchParams.set('iss', `${issuer}/application/o/test/`);

    res.redirect(redirect.href);
  });

  app.post('/application/o/token/', (req, res) => {
    const body = req.body ?? {};

    // Client authentication, by either method the metadata advertises.
    let presentedId = body.client_id;
    let presentedSecret = body.client_secret;

    const authHeader = req.headers.authorization;
    if (authHeader?.startsWith('Basic ')) {
      const decoded = Buffer.from(authHeader.slice(6), 'base64').toString('utf8');
      const split = decoded.indexOf(':');
      presentedId = decodeURIComponent(decoded.slice(0, split));
      presentedSecret = decodeURIComponent(decoded.slice(split + 1));
    }

    if (presentedId !== clientId || presentedSecret !== clientSecret) {
      return res.status(401).json({ error: 'invalid_client' });
    }

    const original = issuedCodes.get(body.code);
    if (!original) return res.status(400).json({ error: 'invalid_grant' });
    issuedCodes.delete(body.code);

    // Verify PKCE exactly as a real provider does.
    const challenge = crypto
      .createHash('sha256')
      .update(String(body.code_verifier ?? ''))
      .digest('base64url');

    if (challenge !== original.code_challenge) {
      return res.status(400).json({ error: 'invalid_grant', error_description: 'PKCE mismatch' });
    }

    const now = Math.floor(Date.now() / 1000);
    const claims = {
      iss: `${issuer}/application/o/test/`,
      sub: state.user.sub,
      aud: clientId,
      iat: now,
      exp: state.expired ? now - 60 : now + 300,
      nonce: state.tamperNonce ? 'not-the-nonce' : original.nonce,
      ...state.user,
    };

    const key = state.signWithWrongKey
      ? crypto.generateKeyPairSync('rsa', { modulusLength: 2048 }).privateKey
      : privateKey;

    return res.json({
      access_token: 'fake-access-token',
      token_type: 'Bearer',
      expires_in: 300,
      id_token: signJwt(claims, key, kid),
    });
  });

  app.get('/application/o/end-session/', (req, res) => res.send('signed out'));

  const server = createServer(app);
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  issuer = `http://127.0.0.1:${server.address().port}`;

  return {
    get issuer() { return `${issuer}/application/o/test/`; },
    clientId,
    clientSecret,
    authorizeRequests,
    /** Replace the claims the next ID token will carry. */
    setUser(user) { state.user = user; },
    signWithWrongKey(value = true) { state.signWithWrongKey = value; },
    tamperNonce(value = true) { state.tamperNonce = value; },
    expireTokens(value = true) { state.expired = value; },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}
