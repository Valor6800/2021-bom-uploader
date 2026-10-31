# ValorBOM v3 — Handoff for the next agent

Branch: `feature/assembly-build-part` (off `master`). First written 2026-10-29; updated after the UX refactor (INC-1 to INC-9).
Read this first, then `technical-plan.html` (engineering plan, 10 "sheets") and `field-guide.html` (plain-language guide for students/mentors, deliberately free of Jira/tool internals) in this folder. Open them in a browser. The pages and routes below supersede the Designer tab and Assembly hub that those two documents describe.

## What this is

ValorBOM (Valor 6800, a FIRST Robotics team) is a Node/Express + React tool that syncs OnShape CAD BOMs with Jira Data Center. v3 adds a four-concept model that matches how the team actually works:

- **Assembly** — a mechanism (e.g. End Effector). In Jira this is the stock **Epic** type, renamed "Assembly".
- **Build** — one specific combination of Parts for an Assembly (e.g. 1" vs 2" bash bar). New Jira issue type with its own workflow.
- **Part** — a physical piece. Many-to-many with Builds via an issue link.
- **Revision** — a significant redesign of an Assembly or Part, chained with a link. A second axis, separate from Builds. Build numbering is continuous across a revision chain and never resets.

## Status

| Phase | State |
|---|---|
| 0 Jira schema | Done, live on jira.valor6800.com |
| 1 Backend services (BuildService, RevisionService, OnShape client additions, migration script) | Done |
| 2 Designer | Done; rebuilt in the UX refactor as `/a/:key/design` |
| 3 Assembly page: Build tabs, per-Build BOM, Move/Re-create, Archive, Clone a Part, Print, Compare Builds | Done; rebuilt in the UX refactor as `/a/:key/assemble` (Cut Version moved to the Designer only); now view-only for Parts, with Move and Re-create removed (Re-create lives in the Designer) |
| UX refactor (Home search, chooser, OnShape onboarding that also creates Build 1, Build save endpoint, bug fixes B1 to B6) | Done (INC-1 to INC-9) |
| 4 OnShape metadata round-trip | **Not started** |
| 5 Guidance (teaching empty states beyond the glossary toggletips), instructions authoring (steps + images), activity log | **Not started** |

Verified: `npm test` -> 43 suites / 961 tests pass; `npx vite build --config src/client/vite.config.js` is clean; `npm run test:visual -- --all` passes against fixtures (83 scenarios: screenshots, axe, vocabulary and console checks).
**Not verified: a live end-to-end run against Jira and OnShape.** Every UI check runs against mocked `/api` responses. The test pass at the end of this file is the next step.

## Pages and routes (client)

| Route | Page |
|---|---|
| `/` | Home: Assembly search (key, name, number, season, year; "Include closed" toggle, mirrored to `?q=` and `?closed=1`) and the "New Assembly from OnShape" link box |
| `/a/:key` | Chooser: Designer or Assembly, as a shareable page (Home shows the same choice as a dialog) |
| `/a/:key/design` | Designer: `?build=<BuildKey>&cad=1` (`cad=1` runs Update from CAD once, then is stripped) |
| `/a/:key/assemble` | Assembly page: `?build=<BuildKey>&view=bom\|compare\|print` |
| `/purchasing`, `/receiving` | Unchanged pages, still mentor-gated |
| `/designer`, `/assembly` | Redirect to `/` |
| `/assembly/:key` | Redirects to `/a/:key/assemble`, keeping the query string |

Nav: "ValorBOM" (link to `/`), "Find an Assembly", then "Parts Order 🔒" and "Parts Check-in 🔒".

Onboarding: pasting an OnShape assembly link on Home runs `POST /api/epics/onboard/preview` (read-only), shows a confirm dialog, then `POST /api/epics/onboard` creates the Assembly (Revision A, OnShape ids, Epic Name) **and its Build 1**, and opens the Designer on that Build with `cad=1`. If Build 1 fails, the Designer opens with a banner and a "Create Build 1" action. Duplicate links, a number already used by another OnShape element, and incomplete OnShape properties each get their own dialog.

## Server endpoints added or changed by the refactor

- `GET /api/epics/search?q&limit&includeClosed=1` — Home search. One JQL lists the Assembly set; matching and ranking happen in code, so search text never reaches JQL.
- `POST /api/epics/onboard/preview`, `POST /api/epics/onboard` — onboarding (B5 duplicate checks, in-flight lock per OnShape element, summary drift → 409).
- `POST /api/builds` — returns the Build object; derives the Revision chain server-side; optional `description` (≤ 60 chars) gives `{name} Build {N} - {description}`; writes Build Number `customfield_10501`.
- `POST /api/builds/:key/save` — the one Part save path: `{ creates, updates, links }` (≤ 200 items), per-item `{ ref, ok, key, error, field }` results, find-or-create by number across the chain, "Used In" checks in both directions before linking. A retry after "Created, but not added to Build N" only re-links.
- `GET /api/builds/status?keys=` — Build statuses read by key (search lags transitions).
- `GET /api/stories?key=…&chain=1` — Parts under the whole Revision chain, newest Revision per number.
- `POST /api/parts/preview` accepts `fresh: true` to bypass the 60-second BOM cache.
- `POST /api/builds/:key/cut-version` takes `{ assemblyKey }` only; OnShape ids come from the Assembly record. Clone, Re-create and Cut Version have repeat guards (409 with `recreatedAs` or `buildStatus`).
- Error bodies: `{ error, status, source?, ...details }`, where `source` is `tracker` or `onshape`. The client maps them to student-facing text in `lib/friendlyError.js`.

### Removed endpoints (answer 404 through `apiNotFound`)

- `GET /api/epics?seasonType&year` and `POST /api/epics/from-url` (with `EpicService.getEpics` and `generateEpicFromURL`).
- `POST /api/stories` (create) and `POST /api/parts/upload` (with `PartService.uploadSelected`). These were the Build-less create path that produced HAR-2031.

After this, a Part is created only by a Build save, Clone, or Re-create. `PartService.createStory` stays as the internal create used by the save. `GET /api/stories`, `GET /api/stories/:key` and `PUT /api/stories/:key` stay.

Removed client code: `DashboardPage`, `AssemblyBomPage`, `AssemblyHubPage`, `AssemblySelection`, `BuildSelection`, `PartsListTable`, the old `DesignerPartsTable`, `parts/PartRow`, `parts/PartsTableToolbar`, the `assembly`, `parts` and `build` Zustand slices, `partRules.isStepAutoExport`, and the client functions `fetchEpics`, `createEpicFromURL`, `createStory`, `uploadSelectedParts`.

## Security: BOM writes are ungated

Auth gating did not change in the refactor. Only `/api/purchasing`, `/api/receiving` and `/api/sheet-sync` sit behind the Authentik gate. Every BOM write endpoint is open to anyone who can reach the server:

- `POST /api/epics/onboard`
- `POST /api/builds`
- `POST /api/builds/:key/save`
- `POST /api/builds/:key/cut-version`
- `POST /api/builds/:key/archive`
- `POST /api/builds/:key/parts`
- `POST /api/builds/:key/parts/:partKey/recreate`
- `POST /api/parts/:key/clone`
- `PUT /api/stories/:key`

The OnShape export endpoints `POST /api/export/step`, `POST /api/export/stl` and `POST /api/parts/auto-export` are also ungated. They trigger OnShape exports and need the same gate.

This is safe only while the server binds loopback (`127.0.0.1`, the default). **These endpoints must go behind the existing Authentik gate before the server is reachable from other machines**, meaning any `HOST` other than loopback or any deploy. `index.js` already warns at startup when bound beyond loopback without auth.

## Cut Builds are immutable

A cut Build is any Build that isn't a Draft (Active, Superseded, Archived). Its Parts list never changes; to change anything, make a new Build. The server enforces this (`utils/cutBuilds.js`), reading statuses from the tracker by key at write time, and answers 409 with no write for:

- linking a Part into a cut Build: `POST /api/builds/:key/parts`, the save endpoint's links and Move, `cloneBuildParts` into a cut Build, and Re-create targeting a cut Build;
- any `POST /api/builds/:key/save` on a cut Build (refused before any read of the Parts);
- field updates to a Part that any cut Build uses, through the save (per-item result `{ ok: false, status: 409, locked: true, cutBuilds }`) and `PUT /api/stories/:key` (`PartService.updateStory`). The message names the cut Builds and says to Re-create the Part for the Draft.

Still allowed: Archive, Cut Version on a Draft (and the Supersede it does), a new Build copying Parts from a cut Build, Re-create of a shared Part into a Draft (new revision linked only to the Draft), Clone a Part, and updates to Parts used only by Drafts.

UI: the Designer shows a cut Build view-only (no Update from CAD, Save, Cut Version or add-existing-Part) with a "New Build from this one" button that opens + New Build with Copy Parts from preselected. On a Draft, a row whose Part a cut Build also uses is locked (plain text, "In cut Build N") with "Re-create for this Build". The Assembly page is view-only for Parts: no edits, Save bar, Move or Re-create; Clone, Print, Compare, Archive, the OnShape link and the two-Active repair stay.

Known gap: there is no "remove from Build". After Re-create of a shared Part that was already in the Draft, the Draft holds both the old and the new revision.

## Archived Builds are final

ValorBOM has no un-archive action, and the Archive confirm says "This can't be undone from ValorBOM." The Build workflow has no transition out of Archived. A tracker admin can add one later; ValorBOM would then need a matching button and the new transition id in `buildConstants.js`.

## Jira schema (Data Center 9.1.0, project key `HAR`)

Constants live in `src/server/utils/buildConstants.js`:
- Custom fields: Epic Link `customfield_10110`, Revision `customfield_10500`, Build Number `10501`, Onshape Version Link `10502`, Instructions Data `10503`. Existing: Epic Name `10104`, Onshape doc/workspace/element `10300/10301/10302`, Machinery `10201`, Material `10202`, Powdercoat `10204`, Quantity `10206`, Thickness `10207`.
- Part creates write Revision (`10500`) from the payload, else the summary letter, else `A` (B1). Build Number, Onshape Version Link and Instructions Data are Build fields; no Part write path sets them (B6).
- Build workflow: Draft -> Active -> Superseded, plus Archived. Transition IDs: Cut Version `11` (Draft->Active), Supersede `21` (Active->Superseded), Archive `31` (global). Verified by walking a test issue through the chain.
- Link types: **Used In** (Build "uses" Part; Part "is used in" Build) and **Revises** (new revision "revises" the one it replaces; inward "is revised by").
- `POST /rest/api/2/issueLink` names the issue that shows the **outward** phrase `inwardIssue` (verified live: `inwardIssue=HAR-2031, outwardIssue=HAR-2032` made HAR-2031 read "uses" HAR-2032). `JiraClient.createIssueLink(type, sourceKey, targetKey)` hides this: it creates "source <outward> target".
- Fields must be on the issue type's screen or the REST API refuses the write (`Field 'X' cannot be set. It is not on the appropriate screen`).

### Jira Data Center gotchas learned the hard way
- The **Epic Link field only accepts literal "Epic"-type issues** (GreenHopper). Cloud's configurable hierarchy does not exist on Data Center. That is why Assembly = renamed Epic, not a custom type. Do not try to make Assembly a custom type again.
- JQL `linkedIssues()` does **not** filter by link direction. `RevisionService._getPreviousRevision` therefore reads the issue's `issuelinks`: on the newer ticket the Revises entry is `outwardIssue: <previous>`.
- In JQL clauses use `cf[NNNNN]`; in REST `fields` params use `customfield_NNNNN`.
- REST cannot create workflows or screens (405) — those were done by hand in the admin UI.
- Changing an issue's type away from Epic silently nulls every Epic Link pointing at it. This happened once; 55 links were restored from changelogs.
- Search lags writes by a few seconds. The save endpoint falls back to `getIssue` for keys missing from search, Build statuses are read by key, and onboarding keeps a short in-process map of Assemblies it just created.

## Architecture (follow these patterns)

- Services are dependency-injected classes (`constructor({ jiraClient, ... })`); routes are thin `asyncHandler` wrappers that call one service method and use `badRequest()` / `conflict()` for validation. Wiring is in `src/server/index.js`. Keys go through `validateIssueKey`, and anything that reaches JQL goes through `sanitizeJQL`.
- `BuildService` depends on `partService` and `revisionService` for the save, Re-create and chain reads, and on `onshapeClient` for Cut Version. `EpicService` depends on `buildService` to create Build 1 when onboarding.
- Frontend: React 19, react-router 6, Vite, hand-written CSS in `index.css` with design tokens in `:root` (dark/gold theme). Shared UI primitives are in `components/ui/` (`Dialog`, `GlossaryTerm`, `EmptyState`, `StickySaveBar`, `DisclosureMenu`, `Badge`, `Button`, `Card`, `InlineSelect`). Page pieces are in `components/home/`, `components/assembly-shared/`, `components/builds/`, `components/designer/` and `components/assembly/`.
- The Designer and Assembly pages keep their own local state (`useState`/`useReducer`) rather than sharing Zustand slices, on purpose, to avoid cross-page interference. Zustand (`store/index.js`) now holds only purchasing and receiving.
- Pure client logic lives in `lib/` (`buildNames`, `designerRows`, `designerSave`, `partValidation`, `friendlyError`) and has Jest tests in `__tests__/utils/`, including a parity test between client and server Part validation.
- UI copy uses only the words Assembly, Build, Part and Revision. It never says "epic", "story", "issue" or "Jira"; the tracker is "the team tracker". The visual harness enforces this.

## Visual test harness

`tests/visual/` (see its README): `npm run test:visual -- --inc INC-n` or `--all` starts a throwaway Vite on `127.0.0.1:5191`, answers every `/api/` request from `tests/visual/fixtures/`, and takes screenshots at three viewports with axe, vocabulary and console checks. `npm run test:visual:fixtures` regenerates the fixtures from the real services wired to fake clients. Playwright is pinned to 1.61.1 (Chromium revision 1228) and never downloads browsers on install.

## Decisions made with the user (don't relitigate)

- Anyone can create a Build or start a Revision (no lead gate). Every Assembly starts at Revision A. Parts never span Assemblies (same design under another Assembly = new Part number).
- No separate database; Jira holds everything. Accepted trade-off: Part quantity is one number per ticket, not per Build.
- **Clone a part: ValorBOM allocates the number.** `PartService.getNextPartNumber` = one past the highest `V{R|F}{yy}P-NNNN` in the season, raised by any Part this process just created. Flat per season, not per Assembly (the number carries no Assembly identity; only Epic Link does). Clone gets Revision A, no Build link, not a Revises chain.
- Move to this Build = plain Used In link. Re-create for this Build = new Part revision (next letter, Revises link, carries BOM fields, linked only to the target Build).
- Creating an Assembly from OnShape also creates its Build 1.
- Cut Version is on the Designer only.
- No auth on BOM writes in this refactor (see the Security section).
- Instructions authoring was moved from Phase 3 to Phase 5.
- No glossary `?` buttons or teaching/helper text in the UI. Terms will be explained on a team Confluence page (URL TBD; no link in the app yet).
- The Assembly page hides Draft Builds (tabs, Compare, Print, labels). A `?build=` pointing at a Draft falls back to the Active Build. The Designer still shows Drafts.
- Cut Builds are immutable (server-enforced); shared Parts are locked until Re-created; the Assembly page is view-only for Parts. See "Cut Builds are immutable".

## Known gaps / open items

1. **`onshapeClient.createBranch` request body is a best guess** (`branchedFrom: {vid}`), flagged in code. Unverified against OnShape's API. Phase 4 also needs OnShape metadata write endpoints (`updatePartMetadata`/`updateElementMetadata`) that have not been verified.
2. **Live data mismatch:** older Jira tickets are off-season practice parts ("Myra-CLONE - 1101A Gearbox...") that don't match `partMask.js` naming (`V[RF]yy[AP]-NNNN`). Home search still finds them by key or name and labels unnumbered Assemblies "(No number)".
3. ~~Build numbering across revisions not continuous in practice.~~ **Closed:** `createBuild` derives the Revision chain server-side, and both pages load Builds with the chain keys.
4. `RevisionService.getRevisionChain` only walks backward, so opening an old Revision won't list newer ones in the Revision selector.
5. ~~Part save swallows per-row failures.~~ **Closed:** saves go through `POST /api/builds/:key/save`, which returns per-item results; both pages show the error on the row with a Retry that only re-links an already-created Part.
6. `scripts/migrate-build-revision.mjs` (backfills Build 1 per existing Assembly, dry-run by default, `--execute` to write) has NOT been run against production.
7. Print view omits instructions (they don't exist yet).
8. Auth is not configured in dev (`OIDC_*` missing). See the Security section before any non-loopback bind.
9. ~~Small UI issues found in review.~~ **Closed** in the cleanup pass: Home re-syncs its search from the URL on every navigation (brand, "Find an Assembly", Back); the dialog × is disabled while onboarding's "Creating…" or an Archive runs; the wrong-Build notice clears when another Build is picked (both pages); Clone a Part is disabled on an Archived Build; Compare drops a picked pair when the Build changes or a Build in the pair is no longer listed; a Retry whose Parts read fails keeps the last good Parts; long Assembly names clamp to two lines with the full name in the title; Re-create past Revision Z is a 409 with a readable reason; `.env*` is gitignored; the client constructor tests no longer depend on exported env vars. Still open from review, by choice: COTS/hardware BOM rows without a Part number show in the unidentified warning (honoring `excludeFromBom` is a product decision).
10. Update from CAD doesn't yet flag a BOM row whose full number already belongs to a Part of a different Assembly; Save would create a second Part with that number.
11. From the live write check: Used In links 16601 and 16603 were made before the link-direction fix and still read "HAR-2031 uses …" (the app matches either direction; re-creating them is a tracker write that needs the user's OK). Cut Version, Supersede and Archive stay unverified live until the OnShape API key has Write scope.

## Manual follow-ups (tracker, by hand)

- **HAR-2031 Revision:** set its Revision field (`customfield_10500`) to `A`. HAR-2031 was created by the removed Build-less path; ValorBOM never writes it back.
- **Part screen fields:** a tracker admin should remove Build Number (`customfield_10501`), Onshape Version Link (`customfield_10502`) and Instructions Data (`customfield_10503`) from the Part screen. Until then they show, empty, on every Part. The "In Build" labels in ValorBOM are the source of truth.

## Running it

- `npm install`, `npm run dev` for Vite (5173), `node src/server/index.js` for the API (PORT from `.env`, 6803 here). Server binds 127.0.0.1.
- `.env` holds real Jira/OnShape credentials and is gitignored. Do not commit or print it (or `.env.authentik`). Never use or ask for credentials to bypass interactive logins.
- Jira writes against the live instance affect the team's real tracker. Ask before mutating (creating/linking/transitioning tickets), and prefer read-only checks.

## Suggested test pass for the user

1. On Home, paste the OnShape link of an assembly whose Properties have Project, Part number, Revision and Name filled in. Confirm, and check that the Designer opens on Build 1 and runs Update from CAD.
2. In the Designer, Save, then check in the tracker that each new Part has a Revision, is linked to Build 1, and has no Build fields set. Create a second Build with "What's different?", then Cut Version on one Build.
3. Search for the Assembly on Home by number, name and key, open it in Assembly mode: Build tabs, Clone a Part, Compare Builds, Print, Archive. Back in the Designer, select the cut Build, use "New Build from this one", and Re-create a locked shared Part in the new Draft.
4. Paste the same OnShape link again and check that Home offers to open the existing Assembly instead of creating a second one.
5. Watch the browser console and the server log for errors; report anything odd.

## Links

- Technical plan artifact: https://claude.ai/code/artifact/2496296b-7c3a-47be-b540-a75c2a319d03 (the copy in this folder is the source; republish with the Artifact tool using that URL to update it)
- Field Guide artifact: https://claude.ai/code/artifact/c1351bf2-1410-4338-9472-1d05a0520065
- Full original conversation transcript (if still available locally): `C:\Users\mray1\.claude\projects\e--6800-2021bom\d070bc9d-e052-468a-8b4f-4b8b141a3d59.jsonl`
