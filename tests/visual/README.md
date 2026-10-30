# Visual tests

Screenshots, accessibility (axe), vocabulary and console checks for the React
client, run against a throwaway Vite dev server with every `/api/` request
answered from `fixtures/`. Nothing talks to a real API server, the team
tracker or OnShape.

```bash
npm run test:visual:fixtures                 # regenerate fixtures/*.json
npm run test:visual -- --inc INC-5           # one increment's scenarios
npm run test:visual -- --all                 # every scenario
SHOTS_DIR=some/dir npm run test:visual -- --inc INC-5
```

Output (PNGs and `axe.json`) goes to `SHOTS_DIR`, default `tests/visual/output/`
(ignored by git). The command exits non-zero on a missing fixture, an unmocked
`/api/` request, a serious or critical axe violation, a forbidden word on a BOM
screen, a console error, or a failed interaction check.

## Versions

- `playwright` **1.61.1**, pinned with `--save-exact`. Its
  `node_modules/playwright/node_modules/playwright-core/browsers.json` lists
  chromium revision **1228** (and `chromium-headless-shell` 1228).
- `@axe-core/playwright` **4.14.0**, pinned with `--save-exact`. It brings its
  own `playwright-core` copy for types; the runner launches the browser through
  `playwright`, so revision 1228 is the one used.

Install was done with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1`; the browser comes
from the cache at `~/Library/Caches/ms-playwright/chromium-1228` and
`chromium_headless_shell-1228`. On a machine with no cached browser, run once:

```bash
npx playwright install chromium
```

The Dockerfile sets `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` before `npm ci`, so an
image build never downloads browsers.

## How it stays local

- Vite starts on `127.0.0.1:5191` with `--strictPort` (never the usual 5173)
  and `PORT=9` in its environment, so its `/api` proxy points at a dead port
  even if a mock were missed. The runner checks the listener with
  `lsof -nP -iTCP:5191 -sTCP:LISTEN` during the run and again after it stops
  Vite with SIGTERM.
- Requests are routed with the predicate `url.pathname.startsWith('/api/')`,
  not a glob, because Vite serves the API client module as
  `/src/api/client.js`. A smoke check loads that module before the first
  scenario and fails if the route handler saw it.
- `make-fixtures.mjs` builds fixtures with the real server services wired to
  fake clients, so the JSON matches what the server sends. It sets
  `PROJECT_KEY=HAR` before loading any service.

## Known axe findings

Scenarios on legacy, non-BOM screens may list `axeKnown` rule ids. Those are
recorded in `axe.json` with `known: true` but don't fail the run. Today that is
only `color-contrast` and `link-in-text-block` on the old Dashboard and on
Parts Check-in, whose dim text and gold inline links keep their current
colours on purpose (design section 4.2). BOM screens can't use `axeKnown`.

## Adding a scenario

Add an entry to `SCENARIOS` in `shots.mjs`: `inc`, `name`, `url`, `api`
(method, path, optional `query`, and a `fixture` name or a `respond`
function), `bom: true` for Home/chooser/Designer/Assembly screens, and an
optional `run(page, ctx)` for interactions (`ctx.shot(name)` takes an extra
screenshot and runs the checks on it).
