# Live write check: fix verification (step 2)

Working tree on `feature/assembly-build-part` at `9b428c4`, changes not committed.

## Tests
```
env -i PATH="$PATH" HOME="$HOME" npm test
```
Result: exit 0. `Test Suites: 42 passed, 42 total`, `Tests: 935 passed, 935 total`.

To confirm the new link test catches F1, `src/server/services/buildService.js` and `revisionService.js` were stashed to their pre-fix state and `__tests__/services/linkDirection.test.js` was run alone. Both tests failed (`2 failed, 2 total`). The stash was popped straight after.

## Client build
```
npx vite build --config src/client/vite.config.js
```
Result: exit 0, `✓ 147 modules transformed`, `✓ built in 688ms`, no warnings or errors in the log.

## API restart
- `lsof -tiTCP:6803 -sTCP:LISTEN` gave 58122. It was killed and the port was free.
- Relaunched `node src/server/index.js` from the repo root in the background, logging to `/tmp/valorbom-api.log`. HOST in `.env` is `127.0.0.1`.
- `lsof -nP -iTCP:6803 -sTCP:LISTEN` shows PID 11633 on `127.0.0.1:6803`. Log: `ValorBOM server listening on http://127.0.0.1:6803`.
- Vite on 5173 (PID 32374, `[::1]:5173`) was not touched.
- Left running.

## OnShape key scope (read-only)
`node .agents/tasks/live-write-check/onshape-perms.mjs` reports `oauth2Scopes: 4097`, so Write (bit 2) is still not set. Document permission is `FULL` with `WRITE`. Steps c, f and h stay blocked on F2.

## Live re-run
| Step | Command | Result |
|---|---|---|
| a | `node .agents/tasks/live-write-check/live-check.mjs a` | Both saves 200 with `alreadyLinked: true`. No new link. |
| e | `node .agents/tasks/live-write-check/live-check.mjs e` | 200. HAR-2035 Revision B. Links 16606 "HAR-2035 revises HAR-2031" and 16607 "HAR-2033 uses HAR-2035". |
| c | `node .agents/tasks/live-write-check/live-check.mjs c` | 403 `{source: "onshape"}` twice. OnShape versions still 1 ("Start"). HAR-2032 still Draft. |
| f, h | not run | BLOCKED on F2 (the key has no write scope). |

Read-only GETs afterwards: `/api/revisions/chain/HAR-2035` returns `["HAR-2035","HAR-2031"]`, `/api/builds/HAR-2033/parts` returns `["HAR-2035","HAR-2031"]`, `/api/builds/for-part/HAR-2035` returns Build 2 HAR-2033.

Write budget used: Builds 1/2, Re-create 1/1, Clone 1/1. Every write is in `write-log.md`.
