/**
 * End-to-end authentication tests.
 *
 * These drive the real openid-client against a fake Authentik that issues
 * genuinely RS256-signed ID tokens, so discovery, PKCE, client authentication,
 * JWKS signature verification, nonce and state checks are all exercised for
 * real. The point is to catch the things that break on deployment day rather
 * than to confirm a mock was called.
 */

import express from 'express';
import request from 'supertest';
import { startFakeAuthentik } from './fakeAuthentik.js';
import { readAuthConfig, OidcProvider } from '../../src/server/auth/oidcConfig.js';
import { requireAuth } from '../../src/server/auth/requireAuth.js';
import authRoutes from '../../src/server/routes/authRoutes.js';
import { SESSION_COOKIE, OIDC_STATE_COOKIE } from '../../src/server/auth/session.js';

const silent = { log() {}, warn() {}, error() {} };
let authentik;

beforeAll(async () => {
  authentik = await startFakeAuthentik();
});

afterAll(async () => {
  await authentik?.close();
});

beforeEach(() => {
  authentik.setUser({
    sub: 'user-1',
    name: 'Michael Ray',
    preferred_username: 'mray190',
    email: 'mray@example.com',
    groups: ['valor mentors'],
  });
  authentik.signWithWrongKey(false);
  authentik.tamperNonce(false);
  authentik.expireTokens(false);
});

/** Build the app the same way src/server/index.js does. */
function buildApp({ requireGroup = '' } = {}) {
  const env = {
    OIDC_ISSUER: authentik.issuer,
    OIDC_CLIENT_ID: authentik.clientId,
    OIDC_CLIENT_SECRET: authentik.clientSecret,
    OIDC_REDIRECT_URI: 'http://127.0.0.1:9999/auth/callback',
    SESSION_SECRET: 'test-session-secret',
    REQUIRE_GROUP: requireGroup,
    AUTH_COOKIE_INSECURE: 'true',
  };

  const authConfig = readAuthConfig(env);
  const provider = new OidcProvider(authConfig);

  const app = express();
  app.use('/auth', authRoutes({ provider, authConfig }));
  app.use(requireAuth({ authConfig, host: '127.0.0.1', logger: silent }));
  app.get('/api/thing', (req, res) => res.json({ ok: true, user: req.user }));
  app.get('/page', (req, res) => res.send('protected page'));
  return app;
}

/** Pull one cookie's value out of a Set-Cookie header list. */
function cookieValue(setCookie, name) {
  const header = [].concat(setCookie ?? []).find((c) => c.startsWith(`${name}=`));
  if (!header) return null;
  return header.slice(name.length + 1).split(';')[0];
}

/**
 * Run the whole login: follow the redirect to the fake provider, let it
 * redirect back, and hand the callback to the app.
 */
async function signIn(app, { returnTo = '/page' } = {}) {
  const login = await request(app).get(`/auth/login?returnTo=${encodeURIComponent(returnTo)}`);
  expect(login.status).toBe(302);

  const stateCookie = cookieValue(login.headers['set-cookie'], OIDC_STATE_COOKIE);
  expect(stateCookie).toBeTruthy();

  // The browser's trip to Authentik and back.
  const authorizeUrl = new URL(login.headers.location);
  const providerResponse = await fetch(authorizeUrl, { redirect: 'manual' });
  const callbackUrl = new URL(providerResponse.headers.get('location'));

  const callback = await request(app)
    .get(`/auth/callback${callbackUrl.search}`)
    .set('Cookie', `${OIDC_STATE_COOKIE}=${stateCookie}`);

  return { login, callback, authorizeUrl, stateCookie };
}

describe('the authorization request', () => {
  it('sends the browser to Authentik with PKCE, state and nonce', async () => {
    const app = buildApp();
    const { authorizeUrl } = await signIn(app);

    expect(authorizeUrl.pathname).toBe('/application/o/authorize/');
    expect(authorizeUrl.searchParams.get('response_type')).toBe('code');
    expect(authorizeUrl.searchParams.get('code_challenge_method')).toBe('S256');
    expect(authorizeUrl.searchParams.get('code_challenge')).toBeTruthy();
    expect(authorizeUrl.searchParams.get('state')).toBeTruthy();
    expect(authorizeUrl.searchParams.get('nonce')).toBeTruthy();
    expect(authorizeUrl.searchParams.get('client_id')).toBe(authentik.clientId);
  });

  it('requests the groups scope, so the claim is available', async () => {
    const app = buildApp();
    const { authorizeUrl } = await signIn(app);

    expect(authorizeUrl.searchParams.get('scope').split(' ')).toEqual(
      expect.arrayContaining(['openid', 'profile', 'email', 'groups']),
    );
  });

  it('stores the handshake in an HttpOnly cookie', async () => {
    const login = await request(buildApp()).get('/auth/login');
    const header = [].concat(login.headers['set-cookie']).find((c) => c.startsWith(OIDC_STATE_COOKIE));

    expect(header).toContain('HttpOnly');
    expect(header).toContain('SameSite=Lax');
  });
});

describe('a successful sign-in', () => {
  it('establishes a session and returns the user to where they were going', async () => {
    const app = buildApp();
    const { callback } = await signIn(app, { returnTo: '/purchasing' });

    expect(callback.status).toBe(302);
    expect(callback.headers.location).toBe('/purchasing');
    expect(cookieValue(callback.headers['set-cookie'], SESSION_COOKIE)).toBeTruthy();
  });

  it('clears the spent handshake cookie', async () => {
    const { callback } = await signIn(buildApp());
    const header = [].concat(callback.headers['set-cookie'])
      .find((c) => c.startsWith(OIDC_STATE_COOKIE));

    expect(header).toContain('Max-Age=0');
  });

  it('lets that session through the gate, carrying the Authentik claims', async () => {
    const app = buildApp();
    const { callback } = await signIn(app);
    const session = cookieValue(callback.headers['set-cookie'], SESSION_COOKIE);

    const res = await request(app).get('/api/thing').set('Cookie', `${SESSION_COOKIE}=${session}`);

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({
      sub: 'user-1',
      name: 'Michael Ray',
      username: 'mray190',
      email: 'mray@example.com',
      groups: ['valor mentors'],
    });
  });

  it('reports the user on /auth/me', async () => {
    const app = buildApp();
    const { callback } = await signIn(app);
    const session = cookieValue(callback.headers['set-cookie'], SESSION_COOKIE);

    const res = await request(app).get('/auth/me').set('Cookie', `${SESSION_COOKIE}=${session}`);

    expect(res.status).toBe(200);
    expect(res.body.username).toBe('mray190');
    expect(res.body.groups).toEqual(['valor mentors']);
  });

  it('serves a protected page', async () => {
    const app = buildApp();
    const { callback } = await signIn(app);
    const session = cookieValue(callback.headers['set-cookie'], SESSION_COOKIE);

    const res = await request(app).get('/page').set('Cookie', `${SESSION_COOKIE}=${session}`);
    expect(res.text).toBe('protected page');
  });
});

describe('a sign-in that should be rejected', () => {
  it('refuses a callback with no handshake cookie', async () => {
    const app = buildApp();
    const login = await request(app).get('/auth/login');
    const authorizeUrl = new URL(login.headers.location);
    const providerResponse = await fetch(authorizeUrl, { redirect: 'manual' });
    const callbackUrl = new URL(providerResponse.headers.get('location'));

    // No cookie: whoever is calling did not start this login.
    const res = await request(app).get(`/auth/callback${callbackUrl.search}`);

    expect(res.status).toBe(400);
    expect(res.text).toMatch(/Login expired/);
  });

  it('refuses a handshake cookie signed with the wrong secret', async () => {
    const app = buildApp();
    const { callback } = await signIn(app);
    expect(callback.status).toBe(302);

    const forged = Buffer.from(JSON.stringify({
      codeVerifier: 'x', state: 'y', nonce: 'z', returnTo: '/',
      exp: Math.floor(Date.now() / 1000) + 600,
    })).toString('base64url');

    const res = await request(app)
      .get('/auth/callback?code=whatever&state=y')
      .set('Cookie', `${OIDC_STATE_COOKIE}=${forged}.not-a-real-signature`);

    expect(res.status).toBe(400);
  });

  it('refuses an ID token signed by the wrong key', async () => {
    // Proves JWKS verification is genuinely happening.
    authentik.signWithWrongKey();
    const { callback } = await signIn(buildApp());

    expect(callback.status).toBe(403);
    expect(cookieValue(callback.headers['set-cookie'], SESSION_COOKIE)).toBeNull();
  });

  it('refuses an ID token with a mismatched nonce', async () => {
    authentik.tamperNonce();
    const { callback } = await signIn(buildApp());

    expect(callback.status).toBe(403);
  });

  it('refuses an already-expired ID token', async () => {
    authentik.expireTokens();
    const { callback } = await signIn(buildApp());

    expect(callback.status).toBe(403);
  });

  it('refuses a mismatched state', async () => {
    const app = buildApp();
    const login = await request(app).get('/auth/login');
    const stateCookie = cookieValue(login.headers['set-cookie'], OIDC_STATE_COOKIE);
    const authorizeUrl = new URL(login.headers.location);
    const providerResponse = await fetch(authorizeUrl, { redirect: 'manual' });
    const callbackUrl = new URL(providerResponse.headers.get('location'));

    callbackUrl.searchParams.set('state', 'a-different-state');

    const res = await request(app)
      .get(`/auth/callback${callbackUrl.search}`)
      .set('Cookie', `${OIDC_STATE_COOKIE}=${stateCookie}`);

    expect(res.status).toBe(403);
  });

  it('establishes no session for any rejected sign-in', async () => {
    for (const breakIt of ['signWithWrongKey', 'tamperNonce', 'expireTokens']) {
      authentik.signWithWrongKey(false);
      authentik.tamperNonce(false);
      authentik.expireTokens(false);
      authentik[breakIt](true);

      const { callback } = await signIn(buildApp());
      expect(cookieValue(callback.headers['set-cookie'], SESSION_COOKIE)).toBeNull();
    }
  });
});

describe('group enforcement with REQUIRE_GROUP set', () => {
  it('admits a mentor', async () => {
    const app = buildApp({ requireGroup: 'valor mentors' });
    const { callback } = await signIn(app);
    const session = cookieValue(callback.headers['set-cookie'], SESSION_COOKIE);

    expect((await request(app).get('/api/thing').set('Cookie', `${SESSION_COOKIE}=${session}`)).status)
      .toBe(200);
  });

  it('refuses a signed-in student', async () => {
    authentik.setUser({
      sub: 'user-2', name: 'A Student', preferred_username: 'student', groups: ['students'],
    });

    const app = buildApp({ requireGroup: 'valor mentors' });
    const { callback } = await signIn(app);
    const session = cookieValue(callback.headers['set-cookie'], SESSION_COOKIE);

    // Signed in, but not authorised — and told which, not just "denied".
    const res = await request(app).get('/api/thing').set('Cookie', `${SESSION_COOKIE}=${session}`);
    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/valor mentors/);
  });

  it('refuses a user whose token carries no groups claim', async () => {
    // What happens if the Authentik scope mapping is missing.
    authentik.setUser({ sub: 'user-3', name: 'No Groups', preferred_username: 'nogroups' });

    const app = buildApp({ requireGroup: 'valor mentors' });
    const { callback } = await signIn(app);
    const session = cookieValue(callback.headers['set-cookie'], SESSION_COOKIE);

    expect((await request(app).get('/api/thing').set('Cookie', `${SESSION_COOKIE}=${session}`)).status)
      .toBe(403);
  });
});

describe('logout', () => {
  it('clears the session and ends the Authentik session too', async () => {
    const app = buildApp();
    const res = await request(app).get('/auth/logout');

    const header = [].concat(res.headers['set-cookie']).find((c) => c.startsWith(SESSION_COOKIE));
    expect(header).toContain('Max-Age=0');

    // Redirecting to our own root would leave the Authentik session live, so
    // the next visit would silently sign back in.
    expect(res.headers.location).toContain('/application/o/end-session/');
  });

  it('leaves a cleared session unable to pass the gate', async () => {
    const app = buildApp();
    const { callback } = await signIn(app);
    const session = cookieValue(callback.headers['set-cookie'], SESSION_COOKIE);

    await request(app).get('/auth/logout');

    // The cookie is only gone from the browser; the gate must still refuse a
    // request that arrives with no cookie at all.
    expect((await request(app).get('/api/thing')).status).toBe(401);
    // And the old value still works until it expires, which is why logout
    // clears it client-side and ends the provider session.
    expect((await request(app).get('/api/thing').set('Cookie', `${SESSION_COOKIE}=${session}`)).status)
      .toBe(200);
  });
});

describe('provider misconfiguration', () => {
  it('explains an unreachable issuer rather than failing obscurely', async () => {
    const authConfig = readAuthConfig({
      OIDC_ISSUER: 'http://127.0.0.1:1/application/o/nope/',
      OIDC_CLIENT_ID: 'id',
      OIDC_CLIENT_SECRET: 'secret',
      OIDC_REDIRECT_URI: 'http://127.0.0.1:9999/auth/callback',
      SESSION_SECRET: 's',
    });

    await expect(new OidcProvider(authConfig).configuration())
      .rejects.toThrow(/Could not reach Authentik/);
  });

  it('refuses a plain-HTTP issuer that is not on this machine', async () => {
    // Guards the loopback carve-out from becoming "TLS optional".
    const authConfig = readAuthConfig({
      OIDC_ISSUER: 'http://authentik.example.com/application/o/test/',
      OIDC_CLIENT_ID: 'id',
      OIDC_CLIENT_SECRET: 'secret',
      OIDC_REDIRECT_URI: 'https://bom.example.com/auth/callback',
      SESSION_SECRET: 's',
    });

    await expect(new OidcProvider(authConfig).configuration()).rejects.toThrow();
  });
});
