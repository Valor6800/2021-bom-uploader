/**
 * Which surfaces the gates cover.
 *
 * Everything needs a team session (Valor Students or Valor Mentors): the BOM
 * tooling, its pages, the app's files, every API route. Parts ordering and
 * check-in also need the mentors group, because they move money and close
 * tickets. Only /auth (how you sign in) and /healthz are open. Getting this
 * wrong in either direction is a real failure: too wide locks the team out of
 * their own tools, too narrow leaves the budget writable by students or the
 * BOM writable by anyone.
 */

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

const TEAM_API = ['/api/epics', '/api/stories', '/api/bom', '/api/export/step', '/api/guide/VAL-1', '/api/vendor/lookup', '/api/pictures/part/VAL-1'];
const MENTOR_API = ['/api/purchasing/queue', '/api/receiving', '/api/sheet-sync'];
const MENTOR_PAGES = ['/purchasing', '/receiving'];
const TEAM_PAGES = ['/', '/a/VAL-1/assemble', '/assets/index.js', '/some/new/page'];

/** Mirrors the route wiring in src/server/index.js. */
function buildApp(env = CONFIGURED) {
  const authConfig = readAuthConfig(env);
  const gate = requireAuth({ authConfig, host: '127.0.0.1', groups: authConfig.mentorGroups, logger: silent });
  const teamGate = requireAuth({ authConfig, host: '127.0.0.1', groups: authConfig.teamGroups, logger: silent });
  const app = express();

  app.get('/auth/login', (req, res) => res.send('login'));
  app.get('/healthz', (req, res) => res.json({ ok: true }));
  app.use(teamGate);

  for (const route of TEAM_API) {
    app.get(route, (req, res) => res.json({ ok: true, route, user: req.user?.username }));
  }
  // Mounted the way index.js mounts them — app.use(prefix, gate, ...) — so
  // Express strips the prefix and req.path is mount-relative inside the gate.
  app.use('/api/purchasing', gate, (req, res) => res.json({ ok: true, user: req.user?.username }));
  app.use('/api/receiving', gate, (req, res) => res.json({ ok: true, user: req.user?.username }));
  app.get('/api/sheet-sync', gate, (req, res) => res.json({ ok: true, user: req.user?.username }));

  app.get(MENTOR_PAGES, gate, (req, res) => res.send('app shell'));
  app.get('*', (req, res) => res.send('app shell'));

  return app;
}

function cookieFor(username, groups, secret = SECRET) {
  const sealed = sealCookie(
    { sub: username, username, groups, exp: Math.floor(Date.now() / 1000) + 600 },
    secret,
    CookieType.SESSION,
  );
  return `${SESSION_COOKIE}=${sealed}`;
}
const mentor = () => cookieFor('mray190', ['Valor Mentors']);
const student = () => cookieFor('student1', ['Valor Students']);
const outsider = () => cookieFor('visitor', ['Some Other Team']);

describe('the BOM tooling needs a team session', () => {
  it.each(TEAM_API)('%s refuses an anonymous call with 401', async (route) => {
    const res = await request(buildApp()).get(route);
    expect(res.status).toBe(401);
    expect(res.body.loginUrl).toBe('/auth/login');
  });

  it.each(TEAM_PAGES)('%s sends an anonymous browser to sign in', async (page) => {
    const res = await request(buildApp()).get(page);
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe(`/auth/login?returnTo=${encodeURIComponent(page)}`);
  });

  it.each(TEAM_API)('%s admits a student and a mentor', async (route) => {
    expect((await request(buildApp()).get(route).set('Cookie', student())).body.user).toBe('student1');
    expect((await request(buildApp()).get(route).set('Cookie', mentor())).body.user).toBe('mray190');
  });

  it.each(TEAM_PAGES)('%s serves the app to a student', async (page) => {
    const res = await request(buildApp()).get(page).set('Cookie', student());
    expect(res.status).toBe(200);
  });

  it('refuses a signed-in account in neither group', async () => {
    const api = await request(buildApp()).get('/api/epics').set('Cookie', outsider());
    expect(api.status).toBe(403);
    expect(api.body.error).toBe('Requires membership of "Valor Students" or "Valor Mentors"');
    const page = await request(buildApp()).get('/').set('Cookie', outsider());
    expect(page.status).toBe(403);
  });

  it('refuses a forged session', async () => {
    const res = await request(buildApp()).get('/api/epics').set('Cookie', cookieFor('x', ['Valor Mentors'], 'wrong'));
    expect(res.status).toBe(401);
  });

  it('refuses everything with 503 when authentication is unconfigured (fails closed)', async () => {
    const app = buildApp({});
    for (const route of [...TEAM_API, ...TEAM_PAGES]) {
      expect((await request(app).get(route)).status).toBe(503);
    }
  });

  it('leaves signing in and the health check open', async () => {
    expect((await request(buildApp()).get('/auth/login')).status).toBe(200);
    expect((await request(buildApp()).get('/healthz')).status).toBe(200);
    expect((await request(buildApp({})).get('/healthz')).status).toBe(200);
  });

  it('follows TEAM_GROUPS, and always admits the mentors', async () => {
    const app = buildApp({ ...CONFIGURED, TEAM_GROUPS: 'Robotics Club' });
    expect((await request(app).get('/api/epics').set('Cookie', cookieFor('c', ['Robotics Club']))).status).toBe(200);
    expect((await request(app).get('/api/epics').set('Cookie', student())).status).toBe(403);
    expect((await request(app).get('/api/epics').set('Cookie', mentor())).status).toBe(200);
  });
});

describe('parts ordering is mentor-only', () => {
  it.each(MENTOR_API)('%s refuses an anonymous call', async (route) => {
    const res = await request(buildApp()).get(route);
    expect(res.status).toBe(401);
  });

  it.each(MENTOR_API)('%s refuses a student', async (route) => {
    const res = await request(buildApp()).get(route).set('Cookie', student());
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('Requires membership of "Valor Mentors"');
  });

  it.each(MENTOR_API)('%s admits a mentor', async (route) => {
    const res = await request(buildApp()).get(route).set('Cookie', mentor());
    expect(res.status).toBe(200);
    expect(res.body.user).toBe('mray190');
  });

  it.each(MENTOR_PAGES)('%s refuses a student and serves a mentor', async (page) => {
    expect((await request(buildApp()).get(page).set('Cookie', student())).status).toBe(403);
    expect((await request(buildApp()).get(page).set('Cookie', mentor())).status).toBe(200);
  });

  it('stays mentor-only with REQUIRE_GROUP unset, since Authentik now admits students too', async () => {
    const app = buildApp({ ...CONFIGURED, REQUIRE_GROUP: '' });
    expect((await request(app).get('/api/purchasing/queue').set('Cookie', student())).status).toBe(403);
    expect((await request(app).get('/api/purchasing/queue').set('Cookie', mentor())).status).toBe(200);
  });

  it.each(MENTOR_API)('%s fails closed (503) when auth is unconfigured', async (route) => {
    const res = await request(buildApp({})).get(route);
    expect(res.status).toBe(503);
  });
});

describe('an unexpected path does not quietly become mentor-only', () => {
  it('does not treat a path merely containing "purchasing" as mentor-only', async () => {
    const res = await request(buildApp()).get('/purchasing-notes').set('Cookie', student());
    expect(res.status).toBe(200);
  });
});
