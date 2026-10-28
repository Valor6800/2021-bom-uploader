/**
 * Which surfaces the gate covers.
 *
 * The BOM tooling (Onshape/Jira assembly sync) is open to the whole team, as
 * it has always been. Only parts ordering and check-in are mentor-only,
 * because those move money and close tickets. Getting this split wrong in
 * either direction is a real failure: too wide locks the team out of their own
 * tools, too narrow leaves the budget writable by anyone.
 */

import { jest } from '@jest/globals';
import express from 'express';
import request from 'supertest';
import { requireAuth } from '../../src/server/auth/requireAuth.js';
import { readAuthConfig } from '../../src/server/auth/oidcConfig.js';
import { sealCookie, SESSION_COOKIE, CookieType } from '../../src/server/auth/session.js';

const SECRET = 'test-secret-do-not-use';
const silent = { log() {}, warn() {}, error() {} };

const CONFIGURED = {
  OIDC_ISSUER: 'https://login.example.com/application/o/valorbom/',
  OIDC_CLIENT_ID: 'id',
  OIDC_CLIENT_SECRET: 'secret',
  OIDC_REDIRECT_URI: 'https://bom.example.com/auth/callback',
  SESSION_SECRET: SECRET,
};

const PUBLIC_API = ['/api/epics', '/api/stories', '/api/bom', '/api/export/step'];
const GATED_API = ['/api/purchasing/queue', '/api/receiving', '/api/sheet-sync'];
const GATED_PAGES = ['/purchasing', '/receiving'];
const PUBLIC_PAGES = ['/', '/assembly'];

/** Mirrors the route wiring in src/server/index.js. */
function buildApp(env = CONFIGURED) {
  const authConfig = readAuthConfig(env);
  const gate = requireAuth({ authConfig, host: '127.0.0.1', logger: silent });
  const app = express();

  for (const route of PUBLIC_API) {
    app.get(route, (req, res) => res.json({ ok: true, route }));
  }
  // Mounted the way index.js mounts them — app.use(prefix, gate, ...) — so
  // Express strips the prefix and req.path is mount-relative inside the gate.
  // Mounting on the full path instead kept req.path absolute and hid a bug
  // where unauthenticated XHR got a 302 rather than a 401.
  app.use('/api/purchasing', gate, (req, res) => res.json({ ok: true, user: req.user?.username }));
  app.use('/api/receiving', gate, (req, res) => res.json({ ok: true, user: req.user?.username }));
  app.get('/api/sheet-sync', gate, (req, res) => res.json({ ok: true, user: req.user?.username }));

  app.get(GATED_PAGES, gate, (req, res) => res.send('app shell'));
  app.get('*', (req, res) => res.send('app shell'));

  return app;
}

function mentorCookie() {
  const sealed = sealCookie(
    {
      sub: 'u1',
      username: 'mray190',
      groups: ['Valor Mentors'],
      exp: Math.floor(Date.now() / 1000) + 600,
    },
    SECRET,
    CookieType.SESSION,
  );
  return `${SESSION_COOKIE}=${sealed}`;
}

describe('the BOM tooling stays open to the whole team', () => {
  it.each(PUBLIC_API)('%s needs no session', async (route) => {
    const res = await request(buildApp()).get(route);
    expect(res.status).toBe(200);
  });

  it.each(PUBLIC_PAGES)('%s serves the app with no session', async (page) => {
    const res = await request(buildApp()).get(page);
    expect(res.status).toBe(200);
    expect(res.text).toBe('app shell');
  });

  it('stays open even when authentication is entirely unconfigured', async () => {
    // The failure that would hurt most: a missing OIDC env var must not take
    // the team's BOM tools offline.
    const app = buildApp({});

    for (const route of PUBLIC_API) {
      expect((await request(app).get(route)).status).toBe(200);
    }
    expect((await request(app).get('/assembly')).status).toBe(200);
  });
});

describe('parts ordering is mentor-only', () => {
  it.each(GATED_API)('%s refuses an anonymous call', async (route) => {
    const res = await request(buildApp()).get(route);
    expect(res.status).toBe(401);
    expect(res.body.loginUrl).toBe('/auth/login');
  });

  it.each(GATED_API)('%s admits a mentor', async (route) => {
    const res = await request(buildApp()).get(route).set('Cookie', mentorCookie());
    expect(res.status).toBe(200);
    expect(res.body.user).toBe('mray190');
  });

  it.each(GATED_PAGES)('%s redirects an anonymous browser to login', async (page) => {
    const res = await request(buildApp()).get(page);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/auth/login?returnTo=${encodeURIComponent(page)}`);
  });

  it.each(GATED_PAGES)('%s serves the app to a mentor', async (page) => {
    const res = await request(buildApp()).get(page).set('Cookie', mentorCookie());
    expect(res.status).toBe(200);
  });

  it.each(GATED_API)('%s refuses rather than 503s when auth is unconfigured', async (route) => {
    // Fail closed: an unconfigured gate must not become an open door.
    const res = await request(buildApp({})).get(route);
    expect(res.status).toBe(503);
  });

  it('refuses a forged session on a gated route', async () => {
    const forged = sealCookie(
      { sub: 'x', exp: Math.floor(Date.now() / 1000) + 600 }, 'wrong', CookieType.SESSION,
    );
    const res = await request(buildApp())
      .get('/api/purchasing/queue')
      .set('Cookie', `${SESSION_COOKIE}=${forged}`);

    expect(res.status).toBe(401);
  });
});

describe('an unexpected path does not quietly become gated or public', () => {
  it('serves the app shell for an unknown page, as a SPA fallback should', async () => {
    expect((await request(buildApp()).get('/some/new/page')).status).toBe(200);
  });

  it('does not treat a path merely containing "purchasing" as gated', async () => {
    // Guards against switching the gate to a prefix match by accident, which
    // would gate /purchasing-help and similar.
    const res = await request(buildApp()).get('/purchasing-notes');
    expect(res.status).toBe(200);
  });
});
