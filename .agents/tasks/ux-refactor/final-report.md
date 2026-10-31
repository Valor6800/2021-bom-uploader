# ValorBOM v3 UX refactor: final validation report

Branch `feature/assembly-build-part`, HEAD `f02278b`, validated 2026-10-31.
No feature changes were made in this step and nothing was committed. No
requests went to Jira or OnShape: every `/api/` call in the browser checks was
answered from `tests/visual/fixtures/`.

## Increment commits

| Increment | Commit | Subject |
|---|---|---|
| INC-1 | `377562b` | fix(parts): Write Revision on Part create and skip excluded BOM rows |
| INC-2 | `ca337c7` | feat(epics): Add Assembly search endpoint and error body details |
| INC-3 | `7a8e34d` | feat(onboard): Add Assembly onboarding with Build 1 creation |
| INC-4 | `f2362a4` | feat(builds): Add Build save endpoint and repeat guards |
| INC-5 | `bad5383` | feat(ui): Add design tokens, UI primitives and visual harness |
| INC-6 | `112487e` | feat(designer): Add Designer page at /a/:key/design |
| INC-7 | `2960743` | feat(assembly): Add Assembly page at /a/:key/assemble |
| INC-8 | `6244fcf` | feat(home): Add Assembly search, chooser and onboarding UI |
| INC-9 | `f02278b` | refactor: Remove legacy BOM pages and APIs |

Earlier fixes on the same branch, before the refactor: `1f840c9` (Assembly
name from OnShape properties) and `c1cd9a5` (BOM parts from Part number and
Revision properties).

## Results

| Check | Result |
|---|---|
| Jest, `NODE_OPTIONS=--experimental-vm-modules npx jest` | **PASS**: 40 suites, 908 tests (baseline 32 / 472) |
| Vite build, `npx vite build --config src/client/vite.config.js` | **PASS**: 147 modules, no warnings, 679 ms. `dist/assets/index-*.js` 427.51 kB (129.87 kB gzip), CSS 43.99 kB |
| Visual harness, `npm run test:visual -- --all` | **PASS**: 81/81 scenarios, 90 screenshots |
| Accessibility (axe, in the harness) | **PASS**: 0 serious or critical violations on new screens. 1 known finding on Parts Check-in (`color-contrast`, documented in `tests/visual/README.md`) |
| End-to-end journey, `/tmp/final-journey.mjs` | **PASS**: 31/31 checks |
| Legacy redirects | **PASS** (details below) |
| Browser console clean | **PASS** for errors. One pre-existing dev-mode warning (details below) |
| Keyboard focus | **PASS** (details below) |
| Vite bound to 127.0.0.1 only and stopped afterwards | **PASS**: harness on `127.0.0.1:5191`, journey on `127.0.0.1:5192`. Both runs used `PORT=9` so the dev proxy pointed at a dead port. `lsof` showed no listener on either port after each run |

### Redirects

Each legacy route lands on the new route, using `replace` (`history.length`
stays 2), with no console errors and no unmocked requests:

- `/assembly` → `/`
- `/designer` → `/`
- `/assembly/HAR-2030?build=HAR-2053` → `/a/HAR-2030/assemble?build=HAR-2053`, with the Build 3 tab selected (harness scenario `redirect-assembly-key`)

### Console

The harness fails a scenario on any `console.error` or uncaught page error that
it doesn't expect. All 81 scenarios passed. The journey script was stricter:
it also captured `console.warn`. The only warning was React Router's dev-only
"Future Flag Warning" about `v7_startTransition`, logged once per page load.
`createBrowserRouter(routes)` in `src/client/src/App.jsx` is unchanged from
`master` (`fd47310`), so this warning existed before the refactor. Production
builds don't log it.

### Keyboard focus

- Home: the search box has focus on load. Tabbing through 12 stops (Include
  closed, the OnShape link box, Continue, and each result card with its
  Designer and Assembly links) shows a visible `:focus-visible` indicator on
  every stop.
- Designer: 15 stops, all with a visible indicator. The order is All
  Assemblies, the Designer/Assembly switch, the glossary `?` buttons, the
  HAR-2030 link, Open in OnShape, the Build chips, + New Build, Update from
  CAD, Cut Version, then the table.
- Assembly: 15 stops, all with a visible indicator. The order is the same
  header, then the Build tab, OnShape version, Compare, Print, Clone a part,
  and More actions.
- Harness checks: Enter on a result card opens the chooser with focus on
  Designer, and Esc returns focus to the card. The onboarding dialog opens
  with focus on "Create Assembly and Build 1", and Esc returns focus to the
  link box. The arrow keys move between Build tabs (`assembly-tabs-keyboard`).
  Cancel gets initial focus in confirm dialogs. Focus-ring screenshots are
  included.

### Onboarding journey

Pasting the OnShape link from the original request
(`…/8c64dfdcb66184646a7a3f17/w/82f00d3cbea6901ac26040bd/e/faea62821490977c33bc8d7c`)
into Home and pressing Enter opens "Create a new Assembly?". Nothing is
created before you confirm. Confirming sends exactly one
`POST /api/epics/onboard` and lands on `/a/HAR-2030/design?build=HAR-2051`
(Build 1). The Designer then loads the CAD rows for Build 1.

## Screenshots

### Journey (`/tmp/final-journey.mjs`, 1366×768)

`/Volumes/workplace/6800/bom-uploader/.agents/tasks/ux-refactor/screenshots/final-validation/journey/`

- `01-home.png`: Home with search, the OnShape link box, and grouped results
- `02-home-search-0000.png`: search for "0000"
- `03-chooser.png`: chooser dialog (Designer or Assembly)
- `04-designer.png`: Designer flow, reached from Home through the chooser
- `05-assembly.png`: Assembly flow, reached from Home through the chooser
- `06-onboard-pasted.png`: OnShape link pasted into Home
- `07-onboard-confirm.png`: onboarding confirm dialog
- `08-onboard-landed-designer.png`: after creation, in the Designer on Build 1. In this full-page capture the sticky save bar is drawn over the table where the viewport ended. This comes from how full-page screenshots handle sticky elements, not from the layout.

### Visual harness (81 scenarios)

`/Volumes/workplace/6800/bom-uploader/.agents/tasks/ux-refactor/screenshots/final-validation/`
(plus `axe.json`)

- Home search: `home-empty.png`, `home-results-0000.png`, `home-results-facility-2027.png`, `home-no-results.png`, `home-no-assemblies.png`, `home-search-error.png`, `home-include-closed.png`, `home-closed-by-key.png`, `home-tablet-768.png`
- Onboarding via OnShape link: `onboard-confirm.png`, `onboard-creating.png`, `onboard-duplicate.png`, `onboard-conflict.png`, `onboard-drift.png`, `onboard-properties-error.png`, `onboard-local-check.png`, `onboard-error.png`, `designer-onboard-build-failed.png`, `designer-onboard-lagging-build.png`, `designer-onboard-already-added.png`
- Chooser: `chooser-dialog.png`, `chooser-page.png`, `chooser-load-404.png`
- Designer flow: `designer-with-builds.png`, `designer-no-builds.png`, `designer-no-builds-cad-disabled.png`, `designer-har2031-linked.png`, `designer-new-build-form.png`, `designer-new-build-error.png`, `designer-new-build-clone-partial.png`, `designer-after-cad.png`, `designer-save-partial-failure.png`, `designer-save-error.png`, `designer-cad-error.png`, `designer-cad-error-columns.png`, `designer-cut-version-confirm.png`, `designer-after-cut.png`, `designer-cut-version-error.png`, `designer-cut-version-already-cut.png`, `designer-cut-version-stage-link.png`, `designer-cut-version-stage-supersede.png`, `designer-two-active-builds.png`, `designer-two-active-confirm.png`, `designer-two-active-resolved.png`, `designer-two-active-stale.png`, `designer-two-active-stale-error.png`, `designer-two-active-finish-cut.png`, `designer-two-active-repair-409.png`, `designer-glossary-open.png`, `designer-load-404.png`, `designer-builds-load-error.png`, `designer-tablet-1024.png`, `designer-tablet-768.png`
- Assembly flow: `assembly-page.png`, `assembly-no-builds.png`, `assembly-clone-dialog.png`, `assembly-after-clone.png`, `assembly-menu-open.png`, `assembly-archive-confirm.png`, `assembly-after-archive.png`, `assembly-after-move.png`, `assembly-save-bar.png`, `assembly-after-recreate.png`, `assembly-recreate-409.png`, `assembly-recreate-link-failed.png`, `assembly-recreate-already-revised.png`, `assembly-action-error.png`, `assembly-load-error.png`, `assembly-two-active-builds.png`, `assembly-two-active-confirm.png`, `assembly-two-active-resolved.png`, `assembly-two-active-stale.png`, `assembly-two-active-stale-error.png`, `assembly-two-active-repair-409.png`, `assembly-tablet-1024.png`, `compare.png`, `print-preview.png`, `print-media.png`
- Redirects: `redirect-assembly.png`, `redirect-assembly-key.png` (`/designer` → `/` is checked without a screenshot)
- Navigation, focus and other pages: `nav-final.png`, `nav-laptop.png`, `focus-ring.png`, `focus-ring-card.png`, `notfound.png`, `purchasing-signin.png`, `purchasing-vendor-group.png`, `purchasing-vendor-group-collapsed.png`, `receiving-signin.png`, `receiving-group.png`

## Findings during validation (not fixed here)

1. **Client constructor tests depend on the shell environment.** Partway
   through validation, the agent's shell started exporting `JIRA_BASE_URL`,
   `JIRA_KEY`, `ONSHAPE_BASE_URL`, `ONSHAPE_TEAM_ID`, `API_KEY` and
   `SECRET_KEY`. Only the variable names were inspected; no values were read.
   With those set, 4 tests fail: `JiraClient › constructor › throws when host
   is missing` and the three `OnshapeClient › constructor › throws when
   baseUrl/accessKey/secretKey is missing`. Each test deletes only the
   primary variable (`JIRA_URL`, `ONSHAPE_URL`, `ONSHAPE_ACCESS`,
   `ONSHAPE_SECRET`), but the clients also read fallback names
   (`src/server/clients/jiraClient.js:81`, `onshapeClient.js:92-94`). These
   tests come from `b219dd9` and `d35d74c`, before this refactor. With a clean
   environment (`env -i HOME PATH NODE_OPTIONS`), the suite passes at HEAD
   (40/908, checked from a `git archive HEAD` copy in `/tmp/headcheck`). Fix
   suggestion: also delete and restore the fallback variables in those tests.
2. **Someone else has uncommitted edits in the working tree.** At about 00:28,
   during this step, someone edited `src/server/utils/buildConstants.js`,
   `src/server/services/buildService.js` and
   `__tests__/services/buildService.test.js`. The edits change the Used In
   JQL to use the link descriptions `"is used in"` / `"uses"`, because
   `linkedIssues()` rejects the type name `"Used In"`. This step did not
   create or touch these edits. With those three files changed and a clean
   environment, jest passed: 40 suites, 909 tests. By the end of this step,
   `src/server/clients/jiraClient.js` and
   `__tests__/clients/jiraClient.test.js` had also changed, so someone was
   still working; that later state was not re-tested. None of these edits
   are in HEAD, and they need to be reviewed and committed separately.
3. **React Router v7 future-flag warning** (dev only, pre-existing). See
   Console above.

## Manual follow-ups

1. **Jira admin: remove three fields from the Part screen.** Remove
   **Build Number**, **Onshape Version Link** and **Instructions Data** from
   the Part issue type's screen. In the v3 model these belong to the Build,
   so they will always be empty on Parts. Seeing them empty on HAR-2031 is
   expected.
2. **Link HAR-2031 to a Build.** Once the Assembly has a Build, open the
   Assembly in the Designer, choose that Build, and tick HAR-2031 under
   "Other Parts in this Assembly" ("add existing part"), then save. This
   creates the Used In link. The flow is shown in `designer-har2031-linked.png`.
3. **HAR-2031's empty Revision field is expected.** HAR-2031 was created
   before INC-1 (`377562b`), which is when Part creation started writing
   Revision. Parts created from now on get it. The fix applies to new Parts
   only, and ValorBOM never back-fills existing Parts (design Q4). To fill it
   in, set HAR-2031's Revision (`customfield_10500`) to `A` by hand in Jira
   (design section 16).
