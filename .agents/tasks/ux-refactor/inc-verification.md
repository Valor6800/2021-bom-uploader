# INC-9 verification: delete dead code and legacy APIs, update HANDOFF.md

Pass type: commit+advance, then implement. INC-8 was APPROVED. It was committed as `6244fcf feat(home): Add Assembly search, chooser and onboarding UI (INC-8)`, with its files named explicitly (`.env.authentik` and `.kiro/` left untracked). INC-8 was then set `done: true` in progress.json, and the APPROVED `inc-review.json` was deleted. INC-9 is implemented below and is **not committed**; it is waiting for review.

## Importer checks before deletion (`grep -rn` over `src/client/src`)

Every importer of a deleted symbol was itself in the deletion set:
- `AssemblySelection` was imported only by `AssemblyBomPage`. `PartsListTable` was imported only by `AssemblyBomPage`. `parts/PartRow` and `parts/PartsTableToolbar` were imported only by the old `components/DesignerPartsTable` and `PartsListTable`.
- `assemblySlice`, `partsSlice` and `buildSlice` were imported only by `store/index.js`, which was edited.
- `fetchEpics` and `createEpicFromURL` were used only by `AssemblySelection`. `createStory` was used only by the old `DesignerPartsTable` and `PartsListTable`. `uploadSelectedParts` had no caller.
- `isStepAutoExport` was used only by `parts/PartRow`.
- `DashboardPage`, `AssemblyBomPage` and `AssemblyHubPage` had no importer; routes.jsx stopped using them in INC-6 to INC-8.
- `components/hub/` was already gone (INC-7 used `git mv`).

Server: `uploadSelected` was called only by the `/parts/upload` route. `generateEpicFromURL` was called only by `/from-url`, and `getEpics` only by `GET /api/epics`. Nothing outside the deletion set imported a deleted symbol, so no stop-and-ask was needed.

## Changes

- Deleted (with `git rm`): `pages/DashboardPage.jsx`, `pages/AssemblyBomPage.jsx`, `pages/AssemblyHubPage.jsx`, `components/AssemblySelection.jsx`, `components/BuildSelection.jsx`, `components/PartsListTable.jsx`, `components/DesignerPartsTable.jsx` (old), `components/parts/PartRow.jsx`, `components/parts/PartsTableToolbar.jsx`, `store/assemblySlice.js`, `store/partsSlice.js`, `store/buildSlice.js`.
- `store/index.js` now composes only the purchasing and receiving slices.
- `partRules.js`: `isStepAutoExport` removed. `isPowdercoatEnabled` and `isThicknessEnabled` stay because `AssemblyPartRow` uses them. `DuplicateWarning` and `UnidentifiedPartsWarning` stay ("Reused" in design section 5; the Designer uses `UnidentifiedPartsWarning`).
- `api/client.js`: removed `fetchEpics`, `createEpicFromURL`, `createStory` and `uploadSelectedParts`.
- `epicRoutes.js`: removed `GET /` (seasonType) and `POST /from-url`, dropped the unused `sanitizeJQL` import, and updated the header comment. `epicService.js`: removed `getEpics` and `generateEpicFromURL`. `_parseEpics` stays because `getEpic` still uses it. `resolveOnshapeAssembly` stays as a read-only public parse.
- `partRoutes.js`: removed `POST /stories` and `POST /parts/upload`, and updated the header comment. `partService.js`: removed `uploadSelected`. `createStory` stays, because `saveBuildParts` uses it.
- `docs/v3/HANDOFF.md`: status table; client routes and pages; added and changed endpoints; removed endpoints; "Security: BOM writes are ungated" (all 9 write endpoints from design section 10, which must be gated before any non-loopback HOST or deploy); "Archived Builds are final" (Q9); gaps 3 and 5 marked closed; the visual harness; manual follow-ups (HAR-2031 Revision, Part-screen Build fields); future work (cross-Assembly number flagging, Q11). It also tracks the still-open non-blocking review findings from INC-7 and INC-8 as gap 9.
- `tests/visual/README.md`: removed the reference to the deleted Dashboard in "Known axe findings".

## Tests changed and added

- `__tests__/routes/epicRoutes.test.js`: the `POST /api/epics/from-url` block is replaced by "removed legacy Assembly routes (INC-9)". `GET /api/epics?seasonType=R&year=26` → 404 with the service not called. `POST /api/epics/from-url` → 404 with nothing created.
- `__tests__/routes/partRoutes.test.js`: the B1 `POST /api/stories` cases moved to `PUT /api/stories/:key`, which uses the real PartService. Revision `AA` → 400 "Validation failed: …" with no `updateIssue`. Material "Steel" → 400. A valid update → 200 `{ success: true }`. New: `POST /api/stories` and `POST /api/parts/upload` → 404 with nothing created. New: `GET /api/stories?key=HAR-2030` still lists Parts.
- `__tests__/routes/buildRoutes.test.js`: new "POST /api/builds/:key/save validation through the real services (B1)", wired with real BuildService and PartService over a fake jiraClient. Revision `AA` and material "Steel" each → 200 with `results[0]` `ok: false` and `field` set to `revision` or `material`, and no `createIssue`.
- `__tests__/services/epicService.test.js`: the `generateEpicFromURL` block is retargeted to `resolveOnshapeAssembly`, so the property-parsing and validation coverage stays (missing, malformed, non-assembly tab, bad URL). The first case now asserts the parsed shape and that `createIssue` is not called.
- `__tests__/services/partService.test.js`: the "defaults Revision to A" case calls `createStory` instead of the deleted `uploadSelected`.

## Commands run and results

1. `NODE_OPTIONS=--experimental-vm-modules npx jest` → exit 0. **Test Suites: 40 passed, 40 total. Tests: 908 passed, 908 total.** INC-8 had 902. The baseline was 32 / 472.
2. `npx vite build --config src/client/vite.config.js` → exit 0, `✓ 147 modules transformed`, `✓ built in 681ms`, with no errors or warnings.
3. `grep -rn "fetchEpics\|createEpicFromURL\|uploadSelectedParts\|AssemblyHubPage\|useAppStore((s) => s.stories" src/client/src` → no matches (grep exit 1).
4. `grep -rn "POST /api/stories\|parts/upload\|from-url\|AssemblyHubPage\|AssemblyBomPage\|DashboardPage\|BuildSelection\|AssemblySelection\|PartsListTable" src tests/visual/*.mjs tests/visual/README.md scripts` → no matches.
5. `lsof -nP -iTCP:5191 -sTCP:LISTEN` before the run → empty.
6. `SHOTS_DIR=.agents/tasks/ux-refactor/screenshots/final npm run test:visual -- --all` → exit 0. **81/81 scenarios passed.** The runner reported a listener on 127.0.0.1:5191 during the run and none after. It wrote 91 files (PNGs plus `final/axe.json`).
7. `lsof -nP -iTCP:5191 -sTCP:LISTEN` after the run → empty. The user's servers on 5173 and 6803 were still listening and were not touched.
8. Opened `final/home-empty.png` and `final/assembly-page.png`. Both render correctly: Home shows the search, the Include closed toggle, the OnShape box and the season groups, and the Assembly page shows the header, Build tabs and Parts table.

No live Jira or OnShape calls were made. `.env` was not read, printed or modified.

## Not done here (by design)

- No INC-9 commit yet. The next pass commits it after APPROVED, sets INC-9 `done: true` and sets `complete: true`.
- `final-report.md` is written by the workflow's final-validation step (plan, "Gaps and assumptions").

## Commit pass (after APPROVED review)
- Review findings handled: removed the empty `src/client/src/components/hub/` directory (`rmdir`). Added one paragraph to the HANDOFF "Security" section noting that `POST /api/export/step`, `POST /api/export/stl` and `POST /api/parts/auto-export` are also ungated and need the same gate. `.env.authentik` was left untracked and unmodified; files were committed by name.
- Re-ran `NODE_OPTIONS=--experimental-vm-modules npx jest` → exit 0, 40 suites / 908 tests passed.
- Re-ran `npx vite build --config src/client/vite.config.js` → exit 0, built clean.
- Committed as `f02278b refactor: Remove legacy BOM pages and APIs (INC-9)` on feature/assembly-build-part (not pushed).
- progress.json: INC-9 `done: true`, `complete: true`. No increments remain.
