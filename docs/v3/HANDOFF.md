# ValorBOM v3 — Handoff for the next agent

Branch: `feature/assembly-build-part` (off `master`). Written 2026-10-29.
Read this first, then `technical-plan.html` (engineering plan, 10 "sheets") and `field-guide.html` (plain-language guide for students/mentors, deliberately free of Jira/tool internals) in this folder. Open them in a browser.

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
| 2 Designer tab (`/designer`) | Done |
| 3 Assembly hub (`/assembly/:key`): build tabs, per-build BOM, Move/Re-create, current-build indicator, Cut Version/Archive, Clone a part, Print, Compare builds | Done |
| 4 OnShape metadata round-trip | **Not started** |
| 5 Guidance (inline glossary, teaching empty states), instructions authoring (steps + images), activity log | **Not started** |

Verified: `NODE_OPTIONS=--experimental-vm-modules npx jest` -> 31 suites / 438 tests pass; `npx vite build --config src/client/vite.config.js` is clean.
**NOT verified: nobody has clicked through the new UI in a browser** (no browser tool was available). That is the main thing the user wants to do now. Expect UI bugs.

## Jira schema (Data Center 9.1.0, project key `HAR`)

Constants live in `src/server/utils/buildConstants.js`:
- Custom fields: Epic Link `customfield_10110`, Revision `customfield_10500`, Build Number `10501`, Onshape Version Link `10502`, Instructions Data `10503`. Existing: Epic Name `10104`, Onshape doc/workspace/element `10300/10301/10302`, Machinery `10201`, Material `10202`, Powdercoat `10204`, Quantity `10206`, Thickness `10207`.
- Build workflow: Draft -> Active -> Superseded, plus Archived. Transition IDs: Cut Version `11` (Draft->Active), Supersede `21` (Active->Superseded), Archive `31` (global). Verified by walking a test issue through the chain.
- Link types: **Used In** (Part "is used in" Build; inward=Part, outward=Build) and **Revises** (inward "is revised by", outward "revises").
- Fields must be on the issue type's screen or the REST API refuses the write (`Field 'X' cannot be set. It is not on the appropriate screen`).

### Jira Data Center gotchas learned the hard way
- The **Epic Link field only accepts literal "Epic"-type issues** (GreenHopper). Cloud's configurable hierarchy does not exist on Data Center. That is why Assembly = renamed Epic, not a custom type. Do not try to make Assembly a custom type again.
- JQL `linkedIssues()` does **not** filter by link direction. `RevisionService._getPreviousRevision` therefore reads the issue's `issuelinks` and checks `inwardIssue` instead.
- In JQL clauses use `cf[NNNNN]`; in REST `fields` params use `customfield_NNNNN`.
- REST cannot create workflows or screens (405) — those were done by hand in the admin UI.
- Changing an issue's type away from Epic silently nulls every Epic Link pointing at it. This happened once; 55 links were restored from changelogs.

## Architecture (follow these patterns)

- Services are dependency-injected classes (`constructor({ jiraClient, ... })`); routes are thin `asyncHandler` wrappers that call one service method and use `badRequest()` for validation. Wiring is in `src/server/index.js`.
- `BuildService` has optional deps for orchestration: `onshapeClient` (only for `cutVersionFromOnshape`), `revisionService` (only for `recreateForBuild`). `EpicService` already set the precedent of a service spanning Jira and OnShape.
- New backend: `buildService.js`, `revisionService.js`, `buildRoutes.js`, `revisionRoutes.js`; additions to `partService.js` (`getStoriesByKeys`, `getNextPartNumber`, `clonePart`), `epicService.js` (`getEpicByKey`), `jiraClient.createIssueLink`, `onshapeClient.createVersion/listVersions/createBranch`.
- Frontend: React 19, react-router 6, Zustand 5 (slice-factory pattern, `store/buildSlice.js`), Vite, hand-written CSS in `index.css` (dark/gold theme). **There is no frontend test harness at all** (Jest is server-only). `components/ui/Badge.jsx` is the shared status pill and now also covers Build statuses.
- Designer and Assembly hub keep their own local state rather than sharing Zustand slices, on purpose, to avoid cross-page interference.
- `PartRow.jsx` got two optional backward-compatible props (`selectable`, `membershipLabel`); the old `/assembly` page (`PartsListTable`) is untouched and still works. A link from it into the hub exists.

## Decisions made with the user (don't relitigate)

- Anyone can create a Build or start a Revision (no lead gate). Every Assembly starts at Revision A. Parts never span Assemblies (same design under another Assembly = new Part number).
- No separate database; Jira holds everything. Accepted trade-off: Part quantity is one number per ticket, not per Build.
- **Clone a part: ValorBOM allocates the number.** `PartService.getNextPartNumber` = one past the highest `V{R|F}{yy}P-NNNN` in the season. Flat per season, not per Assembly (the number carries no Assembly identity; only Epic Link does). Clone gets Revision A, no Build link, not a Revises chain. The hub also lists epic-linked-but-unbuilt Parts so a clone is findable.
- Move to this Build = plain Used In link. Re-create for this Build = new Part revision (next letter, Revises link, carries BOM fields, linked only to the target Build).
- Instructions authoring was moved from Phase 3 to Phase 5.

## Known gaps / open items

1. **`onshapeClient.createBranch` request body is a best guess** (`branchedFrom: {vid}`), flagged in code. Unverified against OnShape's API. Phase 4 also needs OnShape metadata write endpoints (`updatePartMetadata`/`updateElementMetadata`) that have not been verified.
2. **Live data mismatch:** current Jira tickets are off-season practice parts ("Myra-CLONE - 1101A Gearbox...") that do not match `partMask.js` naming (`V[RF]yy[AP]-NNNN`). `AssemblySelection` lists Assemblies by `"Epic Name" ~ "VR26*"` and parses summaries with that mask, so nothing appears in the dropdown today. `HAR-1979` "VR26-1200A End Effector" has a null Epic Name and a non-conforming summary. To test end to end, create an Assembly with a conforming name (e.g. `VR26A-0001 Test Assembly`) and Epic Name, or paste an OnShape URL via the app.
3. Build numbering across revisions: `BuildSelection` (Designer) calls `createBuild` without `revisionChainKeys`, so numbering is not yet continuous across a revision chain in practice. The service supports it; the callers don't pass the chain.
4. `RevisionService.getRevisionChain` only walks backward, so a link to an old revision won't show newer ones in the hub's revision selector.
5. Part save in the Designer/hub swallows per-row failures with `console.error` (inherited house pattern); the UI doesn't surface partial failures.
6. `scripts/migrate-build-revision.mjs` (backfills Build 1 per existing Assembly, dry-run by default, `--execute` to write) has NOT been run against production.
7. Clone UI and Compare panel are minimal. Print view omits instructions (they don't exist yet).
8. Auth is not configured in dev (`OIDC_*` missing), but the BOM routes are intentionally ungated; only purchasing/receiving are mentor-gated.

## Running it

- `npm install` (frontend deps were missing in the original sandbox), `npm run dev` for Vite, `node src/server/index.js` for the API (PORT from `.env`, 6803 here). Server binds 127.0.0.1.
- `.env` holds real Jira/OnShape credentials and is gitignored. Do not commit or print it. A Jira admin token and a password were pasted into the earlier chat; the user was advised to rotate the password. Never use or ask for credentials to bypass interactive logins.
- Jira writes against the live instance affect the team's real tracker. Ask before mutating (creating/linking/transitioning tickets), and prefer read-only checks.

## Suggested test pass for the user

1. Create a conforming Assembly, open `/designer`, select it, create a Build, "Update from CAD", save, Cut Version.
2. Open `/assembly/<KEY>` (also linked from `/assembly`): tabs, Move/Re-create on a sibling part, edit + Save Changes, Clone a part, Compare builds, Print preview.
3. Watch the browser console and the server log for errors; report anything odd.

## Links

- Technical plan artifact: https://claude.ai/code/artifact/2496296b-7c3a-47be-b540-a75c2a319d03 (the copy in this folder is the source; republish with the Artifact tool using that URL to update it)
- Field Guide artifact: https://claude.ai/code/artifact/c1351bf2-1410-4338-9472-1d05a0520065
- Full original conversation transcript (if still available locally): `C:\Users\mray1\.claude\projects\e--6800-2021bom\d070bc9d-e052-468a-8b4f-4b8b141a3d59.jsonl`
