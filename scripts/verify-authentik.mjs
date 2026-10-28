#!/usr/bin/env node
/**
 * Pre-deploy check for the Authentik configuration.
 *
 * Performs real OIDC discovery against the configured issuer and reports
 * whether everything the login flow depends on is actually there. Read-only:
 * it signs nobody in and changes nothing.
 *
 *   node scripts/verify-authentik.mjs
 */

import 'dotenv/config';
import { readAuthConfig, OidcProvider } from '../src/server/auth/oidcConfig.js';

const pass = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const fail = (m) => console.log(`  \x1b[31m✗\x1b[0m ${m}`);
const warn = (m) => console.log(`  \x1b[33m!\x1b[0m ${m}`);

let problems = 0;

const config = readAuthConfig();

console.log('\nConfiguration');
if (!config.configured) {
  fail(`missing: ${config.missing.join(', ')}`);
  console.log('\nThe gate will refuse every request until these are set.\n');
  process.exit(1);
}
pass('all required variables are set');

// The issuer shape is the single most common mistake.
if (!/\/application\/o\/[^/]+\/$/.test(config.issuer)) {
  warn(
    `OIDC_ISSUER is "${config.issuer}" — Authentik issuers normally look like\n`
    + '    https://<host>/application/o/<app-slug>/  (note the trailing slash)',
  );
} else {
  pass(`issuer looks like an Authentik provider URL`);
}

if (!config.redirectUri.endsWith('/auth/callback')) {
  warn(`OIDC_REDIRECT_URI ends with "${config.redirectUri.split('/').pop()}" — this app serves /auth/callback`);
}

// A loopback redirect over plain HTTP is how you test on your own machine, so
// it is a warning there and a hard failure anywhere else.
const redirectIsLoopback = /^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(:\d+)?\//.test(config.redirectUri);
const localMode = redirectIsLoopback && !config.redirectUri.startsWith('https://');

if (localMode) {
  warn('OIDC_REDIRECT_URI is plain-HTTP loopback — fine for testing on this machine, not for the server');
} else if (!config.redirectUri.startsWith('https://')) {
  fail('OIDC_REDIRECT_URI is not HTTPS; the session cookie is Secure and will not be sent');
  problems += 1;
} else {
  pass('redirect URI is HTTPS');
}
if (!config.issuer.startsWith('https://')) {
  fail('OIDC_ISSUER is not HTTPS; tokens would travel in clear text');
  problems += 1;
} else {
  pass('issuer is HTTPS');
}
if (config.sessionSecret.length < 32) {
  fail(`SESSION_SECRET is ${config.sessionSecret.length} chars; use at least 32 (openssl rand -base64 48)`);
  problems += 1;
} else {
  pass('session secret is long enough');
}
if (config.devBypass) {
  fail('AUTH_DEV_BYPASS is true — remove it before deploying');
  problems += 1;
}
if (!config.cookieSecure) {
  if (localMode) warn('AUTH_COOKIE_INSECURE is true — required for plain-HTTP localhost, remove it before deploying');
  else { fail('AUTH_COOKIE_INSECURE is true — remove it before deploying'); problems += 1; }
} else if (localMode) {
  fail('Testing over plain-HTTP localhost needs AUTH_COOKIE_INSECURE=true, or the browser will drop the session cookie');
  problems += 1;
}

console.log('\nProvider discovery');
let metadata;
try {
  const configuration = await new OidcProvider(config).configuration();
  metadata = configuration.serverMetadata();
  pass(`reached ${metadata.issuer}`);
} catch (err) {
  fail(err.message);
  console.log('\nCould not talk to Authentik; nothing else can be checked.\n');
  process.exit(1);
}

const need = [
  ['authorization_endpoint', 'authorization endpoint'],
  ['token_endpoint', 'token endpoint'],
  ['jwks_uri', 'JWKS endpoint (needed to verify ID token signatures)'],
];
for (const [key, label] of need) {
  if (metadata[key]) pass(`${label}: ${metadata[key]}`);
  else { fail(`no ${label} advertised`); problems += 1; }
}

if (metadata.end_session_endpoint) pass('end-session endpoint (sign-out ends the Authentik session)');
else warn('no end-session endpoint; signing out will not end the Authentik session');

const pkce = metadata.code_challenge_methods_supported ?? [];
if (pkce.includes('S256')) pass('PKCE S256 supported');
else { fail(`PKCE S256 not advertised (got ${JSON.stringify(pkce)})`); problems += 1; }

const algs = metadata.id_token_signing_alg_values_supported ?? [];
if (algs.length) pass(`ID token signing algorithms: ${algs.join(', ')}`);
else { fail('no ID token signing algorithms advertised'); problems += 1; }

const scopes = metadata.scopes_supported ?? [];
if (scopes.length === 0) {
  warn('provider advertises no scopes_supported; cannot check the groups scope from here');
} else if (scopes.includes('groups')) {
  pass('groups scope is available');
} else {
  const msg = `groups scope not advertised (got ${scopes.join(', ')})`;
  if (config.requireGroup) { fail(`${msg} — REQUIRE_GROUP is set, so every user would be refused`); problems += 1; }
  else warn(`${msg} — fine while REQUIRE_GROUP is empty`);
}

console.log('\nGroup enforcement');
if (config.requireGroup) {
  pass(`app will independently require membership of "${config.requireGroup}"`);
} else {
  warn(
    'REQUIRE_GROUP is empty: access rests entirely on the Authentik application\n'
    + '    binding. If that binding is removed, any Authentik account gets in.',
  );
}

console.log(
  problems === 0
    ? '\n\x1b[32mReady.\x1b[0m Remaining checks need a browser: sign in as a mentor, then as a non-mentor.\n'
    : `\n\x1b[31m${problems} problem(s) must be fixed before deploying.\x1b[0m\n`,
);
process.exit(problems === 0 ? 0 : 1);
