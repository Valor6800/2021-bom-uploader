/**
 * Regression tests for the defects a code review found after the first
 * implementation. Each one reproduces the original failure end to end, so a
 * future change that reintroduces it fails here rather than in production.
 */

import express from 'express';
import request from 'supertest';
import { startFakeAuthentik } from './fakeAuthentik.js';
import { readAuthConfig, OidcProvider } from '../../src/server/auth/oidcConfig.js';
import { requireAuth } from '../../src/server/auth/requireAuth.js';
import authRoutes from '../../src/server/routes/authRoutes.js';
import { SESSION_COOKIE, OIDC_STATE_COOKIE } from '../../src/server/auth/session.js';
import { SheetSyncScheduler } from '../../src/server/sheetSyncScheduler.js';

const silent = { log() {}, warn() {}, error() {} };
let authentik;

beforeAll(async () => { authentik = await startFakeAuthentik(); });
afterAll(async () => { await authentik?.close(); });

/**
 * Mounted exactly as src/server/index.js mounts things, including the
 * per-route gate — the prefix stripping that causes matters here.
 */
function buildApp({ requireGroup = '' } = {}) {
  const authConfig = readAuthConfig({
    OIDC_ISSUER: authentik.issuer,
    OIDC_CLIENT_ID: authentik.clientId,
    OIDC_CLIENT_SECRET: authentik.clientSecret,
    OIDC_REDIRECT_URI: 'http://127.0.0.1:9999/auth/callback',
    SESSION_SECRET: 'test-session-secret',
    REQUIRE_GROUP: requireGroup,
    AUTH_COOKIE_INSECURE: 'true',
  });

  const gate = requireAuth({ authConfig, host: '127.0.0.1', logger: silent });
  const app = express();
  app.use('/auth', authRoutes({ provider: new OidcProvider(authConfig), authConfig }));
  app.use('/api/purchasing', gate, (req, res) => res.json({ ok: true, user: req.user }));
  app.get(['/purchasing'], gate, (req, res) => res.send('app shell'));
  return app;
}

function cookieValue(setCookie, name) {
  const header = [].concat(setCookie ?? []).find((c) => c.startsWith(`${name}=`));
  return header ? header.slice(name.length + 1).split(';')[0] : null;
}

describe('the pre-auth handshake cookie cannot be used as a session', () => {
  /**
   * Original defect: both cookies were sealed with the same secret and carried
   * no purpose claim, and /auth/login sits outside the gate because it is how
   * you get in. So any anonymous caller could request /auth/login, take the
   * `valorbom_oidc` value it set, replay it as `valorbom_session`, and reach
   * every gated route — writing the budget sheet and transitioning Jira
   * tickets without ever contacting Authentik.
   */
  it('refuses a handshake cookie replayed as a session cookie', async () => {
    const app = buildApp();

    const login = await request(app).get('/auth/login');
    const handshake = cookieValue(login.headers['set-cookie'], OIDC_STATE_COOKIE);
    expect(handshake).toBeTruthy();

    const res = await request(app)
      .get('/api/purchasing/queue')
      .set('Cookie', `${SESSION_COOKIE}=${handshake}`);

    expect(res.status).toBe(401);
    expect(res.body.ok).toBeUndefined();
  });

  it('refuses it on a gated page too', async () => {
    const app = buildApp();
    const login = await request(app).get('/auth/login');
    const handshake = cookieValue(login.headers['set-cookie'], OIDC_STATE_COOKIE);

    const res = await request(app).get('/purchasing').set('Cookie', `${SESSION_COOKIE}=${handshake}`);
    expect(res.status).toBe(302);
    expect(res.headers.location).toMatch(/^\/auth\/login/);
  });

  it('refuses a real session cookie replayed as a handshake', async () => {
    // The mirror image: a signed-in user must not be able to drive /auth/callback.
    const app = buildApp();
    const res = await request(app)
      .get('/auth/callback?code=x&state=y')
      .set('Cookie', `${SESSION_COOKIE}=whatever`);

    expect(res.status).toBe(400);
  });
});

describe('gated API calls get a 401 the SPA can act on', () => {
  /**
   * Original defect: the gate tested `req.path`, which Express makes
   * mount-relative. Mounted at '/api/purchasing', req.path was '/queue', so
   * the "is this an API call" check failed and an unauthenticated XHR was
   * 302-redirected to the login page. fetch() follows that redirect to a
   * cross-origin page, so the client saw an opaque network error instead of
   * the sign-in prompt.
   */
  it('returns 401 with a loginUrl, not a redirect', async () => {
    const res = await request(buildApp()).get('/api/purchasing/queue');

    expect(res.status).toBe(401);
    expect(res.body).toMatchObject({ status: 401, loginUrl: '/auth/login' });
  });

  it('still redirects an actual browser navigation', async () => {
    const res = await request(buildApp()).get('/purchasing').set('Accept', 'text/html');
    expect(res.status).toBe(302);
  });
});

describe('safeReturnTo resists backslash smuggling', () => {
  /**
   * Original defect: the check was `startsWith('/') && !startsWith('//')`.
   * "/\evil.com" passes both, but browsers normalise the backslash and resolve
   * Location: /\evil.com as //evil.com — a protocol-relative redirect to an
   * attacker host, from the sign-in endpoint users are trained to trust.
   */
  it.each([
    ['/\\evil.com', '/'],
    ['/\\\\evil.com', '/'],
    ['//evil.com', '/'],
    ['/\\/evil.com', '/'],
    ['https://evil.com', '/'],
    ['/purchasing', '/purchasing'],
    ['/receiving?x=1#y', '/receiving?x=1#y'],
  ])('%s -> %s', async (input, expected) => {
    const res = await request(buildApp()).get(`/auth/login?returnTo=${encodeURIComponent(input)}`);

    // The handshake cookie records where login will return to.
    const handshake = cookieValue(res.headers['set-cookie'], OIDC_STATE_COOKIE);
    const payload = JSON.parse(
      Buffer.from(handshake.split('.')[0], 'base64url').toString('utf8'),
    );

    expect(payload.returnTo).toBe(expected);
  });
});

describe('an empty SHEET_SYNC_INTERVAL_MS does not disable the poll', () => {
  /**
   * Original defect: Number('') === 0, and 0 is the deliberate "disabled"
   * sentinel. A present-but-empty variable — trivially produced by a .env line
   * or a compose `environment:` entry — silently stopped the purchaser's sheet
   * edits ever reaching Jira, logging only that polling was off on purpose.
   */
  const withEnv = (value, run) => {
    const original = process.env.SHEET_SYNC_INTERVAL_MS;
    if (value === undefined) delete process.env.SHEET_SYNC_INTERVAL_MS;
    else process.env.SHEET_SYNC_INTERVAL_MS = value;
    try { run(); } finally {
      if (original === undefined) delete process.env.SHEET_SYNC_INTERVAL_MS;
      else process.env.SHEET_SYNC_INTERVAL_MS = original;
    }
  };

  it('falls back to the default for an empty string', () => {
    withEnv('', () => {
      const s = new SheetSyncScheduler({ receivingService: {}, logger: silent });
      expect(s.enabled).toBe(true);
      expect(s.intervalMs).toBe(5 * 60 * 1000);
    });
  });

  it('falls back for whitespace too', () => {
    withEnv('   ', () => {
      expect(new SheetSyncScheduler({ receivingService: {}, logger: silent }).enabled).toBe(true);
    });
  });

  it('still honours an explicit 0 as "disabled"', () => {
    withEnv('0', () => {
      expect(new SheetSyncScheduler({ receivingService: {}, logger: silent }).enabled).toBe(false);
    });
  });

  it('still honours a real interval', () => {
    withEnv('60000', () => {
      expect(new SheetSyncScheduler({ receivingService: {}, logger: silent }).intervalMs).toBe(60000);
    });
  });
});
