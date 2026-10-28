# ValorBOM

BOM management tool that bridges Onshape CAD assemblies with Jira project tracking. Syncs assembly data from Onshape, manages part metadata, and creates/updates Jira stories for each part.

## Prerequisites

- Node.js 20+
- npm
- Docker (optional)

## Local Installation

```bash
git clone <repo-url>
cd valorbom
npm install
cp .env.example .env
# Fill in your environment variables in .env
npm run build
npm start
```

## Docker Installation

The port is published to loopback only. This server has no authentication of
its own and holds credentials that can move Jira tickets and write the team
budget sheet, so put a reverse proxy that requires a login in front of it
before making it reachable from the network.

```bash
docker build -t valorbom .
docker run -p 127.0.0.1:3000:3000 \
  -e HOST=0.0.0.0 \
  -e JIRA_URL=https://jira.example.com \
  -e JIRA_KEY=your_jira_token \
  -e PROJECT_KEY=VAL \
  -e PARTS_PROJECT_KEY=PARTS \
  -e ONSHAPE_URL=https://cad.onshape.com \
  -e ONSHAPE_ACCESS=your_access_key \
  -e ONSHAPE_SECRET=your_secret_key \
  -e ONSHAPE_TEAM=your_team_id \
  -e ORDER_SHEET_ID=your_parts_order_spreadsheet_id \
  -e GOOGLE_CREDENTIALS_PATH=/app/keys.json \
  -e OIDC_ISSUER=https://login.example.com/application/o/valorbom/ \
  -e OIDC_CLIENT_ID=your_client_id \
  -e OIDC_CLIENT_SECRET=your_client_secret \
  -e OIDC_REDIRECT_URI=https://bom.example.com/auth/callback \
  -e SESSION_SECRET=your_session_secret \
  -e REQUIRE_GROUP='Valor Mentors' \
  -v $(pwd)/keys.json:/app/keys.json:ro \
  valorbom
```

Without the `OIDC_*` and `SESSION_SECRET` values the parts-ordering pages
refuse every request with 503; the BOM pages keep working either way. Verify
the configuration inside the container before pointing a domain at it:

```bash
docker exec <container> node scripts/verify-authentik.mjs
```

`.dockerignore` keeps `.env` and `keys.json` out of every build layer, so
credentials are supplied at run time and never baked into the image.

`HOST=0.0.0.0` is correct *inside* a container — the container's own network is
the private boundary, and `-p 127.0.0.1:3000:3000` is what keeps the port off
the host's external interfaces. Outside a container, leave `HOST` at its
`127.0.0.1` default.

## Authentication

Access is gated by [Authentik](https://goauthentik.io/) using the OIDC
authorization-code flow with PKCE. The app is a confidential OIDC client, so
the gate stands on its own regardless of what proxy sits in front of it.

Three things have to hold before a session is issued, and each is tested:

- the authorization code must match the PKCE verifier this server generated,
- the token endpoint call must present the client secret,
- the returned ID token's **signature must verify against Authentik's JWKS**,
  and its issuer, audience, expiry, `state` and `nonce` must all check out.

That signature check is not on by default in `openid-client` — OIDC Core
3.1.3.7 permits skipping it when the token arrives over a direct TLS call to
the token endpoint. This app turns it on (`enableNonRepudiationChecks`),
because for an access gate the cost is one cached JWKS fetch.

**The gate fails closed.** With the `OIDC_*` and `SESSION_SECRET` variables
unset, every request is refused with 503 — an unfinished deployment is
unreachable, not open.

### Authentik setup

1. **Create an OAuth2/OpenID provider.**
   - Client type: *Confidential*
   - Redirect URI: `https://<your-host>/auth/callback` (exact match)
   - Note the Client ID and Client Secret.
2. **Create an Application** bound to that provider, and note its slug.
   `OIDC_ISSUER` is then `https://<authentik-host>/application/o/<slug>/`.
3. **Restrict it to mentors.** On the Application, bind a policy for your
   mentors group. Non-members are refused at sign-in and never receive an
   authorization code, so they cannot reach the app at all.
4. **Emit the `groups` claim** (only needed if you also set `REQUIRE_GROUP`):
   add a Scope Mapping with scope name `groups` and expression
   `return [group.name for group in request.user.ak_groups.all()]`, then add it
   to the provider's scopes.
5. Fill in `.env`, then check it before deploying:

   ```bash
   node scripts/verify-authentik.mjs
   ```

   That reads your `.env`, performs real discovery against your Authentik, and
   reports whether the issuer, endpoints, signing algorithms, PKCE support and
   `groups` scope are all present — without needing a browser.

### Defence in depth

`REQUIRE_GROUP` makes the app independently refuse anyone whose `groups` claim
does not contain that exact group name. It is empty by default, which means
access rests solely on Authentik's application binding — if that binding is
ever removed, the app will admit any Authentik account. Setting
`REQUIRE_GROUP` to your mentors group closes that gap in config alone.

### Local development

`AUTH_DEV_BYPASS=true` skips authentication. It is **ignored unless `HOST` is
loopback**, so it cannot accidentally expose a deployment — with a wider bind
the server logs a `SECURITY:` error and keeps refusing every request.

`/healthz` is deliberately public; it reveals only whether the process is up.

## Scripts

| Script | Description |
|---|---|
| `npm start` | Start the production server |
| `npm run dev` | Start Vite dev server with HMR |
| `npm run build` | Build the React frontend |
| `npm run preview` | Preview the production build |
| `npm test` | Run tests |
| `npm run test:watch` | Run tests in watch mode |
| `npm run test:coverage` | Run tests with coverage |

## Environment Variables

| Variable | Description |
|---|---|
| `PORT` | Server port (default: 3000) |
| `JIRA_URL` | Jira instance base URL |
| `JIRA_KEY` | Jira personal access token |
| `PROJECT_KEY` | Jira project key (default: VAL) |
| `ONSHAPE_URL` | Onshape API base URL |
| `ONSHAPE_ACCESS` | Onshape API access key |
| `ONSHAPE_SECRET` | Onshape API secret key |
| `ONSHAPE_TEAM` | Onshape team ID (optional) |
| `CORS_ORIGIN` | Allowed CORS origin (default: `*`) |

## Project Structure

```
src/
  server/
    clients/       # Jira and Onshape API clients
    clients/       # Jira and Onshape API clients
    services/      # Business logic (BOM, Epic, Part, Export)
    routes/        # Express route handlers
    middleware/    # CORS, request logging, shared error handling
    utils/         # Constants, validators, part number parsing
    index.js       # Express entry point
  client/
    src/
      api/         # Fetch-based API client
      store/       # Zustand client store (per-domain slices)
      layout/      # App shell + navigation
      pages/       # Route-level pages
      components/  # React components (feature + ui primitives)
      App.jsx      # Router provider
    index.html     # App entry point
__tests__/         # Jest test suites
```
