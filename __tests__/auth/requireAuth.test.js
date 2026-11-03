import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { requireAuth, evaluateDevBypass, isLoopbackHost } from '../../src/server/auth/requireAuth.js';
import { readAuthConfig } from '../../src/server/auth/oidcConfig.js';
import { sealCookie, SESSION_COOKIE, CookieType } from '../../src/server/auth/session.js';

const SECRET = 'test-secret-do-not-use';
const silent = { log() {}, warn() {}, error() {} };

const CONFIGURED = {
  OIDC_ISSUER: 'https://auth.example.com/application/o/valorbom/',
  OIDC_CLIENT_ID: 'id',
  OIDC_CLIENT_SECRET: 'secret',
  OIDC_REDIRECT_URI: 'https://bom.example.com/auth/callback',
  SESSION_SECRET: SECRET,
};

function buildApp(env, host = '127.0.0.1') {
  const authConfig = readAuthConfig(env);
  const app = express();
  app.use(requireAuth({ authConfig, host, logger: silent }));
  app.get('/api/thing', (req, res) => res.json({ ok: true, user: req.user?.username ?? null }));
  app.get('/page', (req, res) => res.send('page'));
  return app;
}

function sessionCookie(payload) {
  const sealed = sealCookie(
    { exp: Math.floor(Date.now() / 1000) + 600, groups: [], ...payload },
    SECRET,
    CookieType.SESSION,
  );
  return `${SESSION_COOKIE}=${sealed}`;
}

describe('isLoopbackHost', () => {
  it('recognises the loopback forms', () => {
    for (const host of ['127.0.0.1', 'localhost', '::1', '::ffff:127.0.0.1']) {
      expect(isLoopbackHost(host)).toBe(true);
    }
  });

  it('rejects anything reachable from the network', () => {
    for (const host of ['0.0.0.0', '10.6.2.20', '::', 'bom.example.com', '', undefined]) {
      expect(isLoopbackHost(host)).toBe(false);
    }
  });
});

describe('evaluateDevBypass', () => {
  it('is off unless explicitly asked for', () => {
    expect(evaluateDevBypass({ devBypass: false }, '127.0.0.1').allowed).toBe(false);
  });

  it('is allowed on loopback', () => {
    expect(evaluateDevBypass({ devBypass: true }, '127.0.0.1').allowed).toBe(true);
  });

  it('is refused on a network-reachable bind, with a reason', () => {
    // The whole point of the guard: a stray env var must not publish the app.
    const result = evaluateDevBypass({ devBypass: true }, '0.0.0.0');
    expect(result.allowed).toBe(false);
    expect(result.reason).toMatch(/reachable/);
  });
});

describe('gate with authentication unconfigured', () => {
  it('fails closed rather than open', async () => {
    const app = buildApp({});

    const api = await request(app).get('/api/thing');
    expect(api.status).toBe(503);
    expect(api.body.error).toMatch(/not configured/);

    const page = await request(app).get('/page');
    expect(page.status).toBe(503);
  });

  it('names what is missing so the operator can fix it', async () => {
    const res = await request(buildApp({ OIDC_ISSUER: 'https://x/' })).get('/api/thing');
    expect(res.body.error).toContain('OIDC_CLIENT_ID');
    expect(res.body.error).toContain('SESSION_SECRET');
  });

  it('still fails closed when the bypass is set but the bind is public', async () => {
    const app = buildApp({ AUTH_DEV_BYPASS: 'true' }, '0.0.0.0');
    expect((await request(app).get('/api/thing')).status).toBe(503);
  });

  it('lets requests through only for a loopback bypass', async () => {
    const app = buildApp({ AUTH_DEV_BYPASS: 'true' }, '127.0.0.1');
    const res = await request(app).get('/api/thing');
    expect(res.status).toBe(200);
    expect(res.body.user).toBe('dev');
  });
});

describe('gate with authentication configured', () => {
  it('refuses an API call with no session', async () => {
    const res = await request(buildApp(CONFIGURED)).get('/api/thing');
    expect(res.status).toBe(401);
    expect(res.body.loginUrl).toBe('/auth/login');
  });

  it('redirects a browser navigation to login, preserving where it was going', async () => {
    const res = await request(buildApp(CONFIGURED)).get('/page');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/auth/login?returnTo=%2Fpage');
  });

  it('admits a valid session', async () => {
    const res = await request(buildApp(CONFIGURED))
      .get('/api/thing')
      .set('Cookie', sessionCookie({ sub: 'u1', username: 'mray' }));

    expect(res.status).toBe(200);
    expect(res.body.user).toBe('mray');
  });

  it('refuses a forged session cookie', async () => {
    const forged = sealCookie(
      { sub: 'attacker', exp: Math.floor(Date.now() / 1000) + 600 },
      'wrong-secret',
      CookieType.SESSION,
    );

    const res = await request(buildApp(CONFIGURED))
      .get('/api/thing')
      .set('Cookie', `${SESSION_COOKIE}=${forged}`);

    expect(res.status).toBe(401);
  });

  it('refuses an expired session', async () => {
    const stale = sealCookie({ sub: 'u1', exp: Math.floor(Date.now() / 1000) - 1 }, SECRET, CookieType.SESSION);
    const res = await request(buildApp(CONFIGURED))
      .get('/api/thing')
      .set('Cookie', `${SESSION_COOKIE}=${stale}`);

    expect(res.status).toBe(401);
  });
});

describe('optional in-app group check', () => {
  const withGroup = { ...CONFIGURED, REQUIRE_GROUP: 'valor mentors' };

  it('admits a member', async () => {
    const res = await request(buildApp(withGroup))
      .get('/api/thing')
      .set('Cookie', sessionCookie({ sub: 'u1', username: 'mray', groups: ['valor mentors'] }));

    expect(res.status).toBe(200);
  });

  it('refuses a signed-in non-member with 403, not 401', async () => {
    const res = await request(buildApp(withGroup))
      .get('/api/thing')
      .set('Cookie', sessionCookie({ sub: 'u2', username: 'student', groups: ['students'] }));

    expect(res.status).toBe(403);
    expect(res.body.error).toMatch(/valor mentors/);
  });

  it('refuses a user with no groups claim at all', async () => {
    const res = await request(buildApp(withGroup))
      .get('/api/thing')
      .set('Cookie', sessionCookie({ sub: 'u3', username: 'nobody' }));

    expect(res.status).toBe(403);
  });

  it('matches the group name exactly rather than loosely', async () => {
    const res = await request(buildApp(withGroup))
      .get('/api/thing')
      .set('Cookie', sessionCookie({ sub: 'u4', groups: ['Valor Mentors'] }));

    expect(res.status).toBe(403);
  });

  it('admits any signed-in user when no group is required', async () => {
    const res = await request(buildApp(CONFIGURED))
      .get('/api/thing')
      .set('Cookie', sessionCookie({ sub: 'u5', groups: ['students'] }));

    expect(res.status).toBe(200);
  });
});

describe('requireAuth with several groups', () => {
  it('admits a member of any of them, and names them all when refusing', async () => {
    const { default: express } = await import('express');
    const { default: request } = await import('supertest');
    const { readAuthConfig } = await import('../../src/server/auth/oidcConfig.js');
    const { requireAuth: gateOf } = await import('../../src/server/auth/requireAuth.js');
    const { sealCookie: seal, SESSION_COOKIE: NAME, CookieType: TYPE } = await import('../../src/server/auth/session.js');
    const env = {
      OIDC_ISSUER: 'https://login.example.com/', OIDC_CLIENT_ID: 'id', OIDC_CLIENT_SECRET: 's', OIDC_REDIRECT_URI: 'https://x/cb', SESSION_SECRET: 'k',
    };
    const authConfig = readAuthConfig(env);
    expect(authConfig.teamGroups).toEqual(['Valor Students', 'Valor Mentors']);
    expect(authConfig.mentorGroups).toEqual(['Valor Mentors']);
    const app = express();
    app.use(gateOf({ authConfig, host: '127.0.0.1', groups: authConfig.teamGroups, logger: { warn() {}, error() {}, log() {} } }));
    app.get('/x', (req, res) => res.send('ok'));
    const as = (groups) => `${NAME}=${seal({ sub: 'u', groups, exp: Math.floor(Date.now() / 1000) + 60 }, 'k', TYPE.SESSION)}`;
    expect((await request(app).get('/x').set('Cookie', as(['Valor Students']))).status).toBe(200);
    expect((await request(app).get('/x').set('Cookie', as(['Valor Mentors', 'Other']))).status).toBe(200);
    const no = await request(app).get('/x').set('Accept', 'text/html').set('Cookie', as(['<b>Other</b>']));
    expect(no.status).toBe(403);
    expect(no.text).toContain('&#34;Valor Students&#34; or &#34;Valor Mentors&#34;');
  });
});
