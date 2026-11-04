# ValorBOM v3 — Handoff for the next agent

Branch: `feature/onshape-revision-new-parts` (off `master`; `feature/assembly-build-part` is already merged). First written 2026-10-29; updated after the UX refactor (INC-1 to INC-9) and again through 2026-11-03, when the tool took over Part numbering and Revisions and gained files, pictures and OnShape configurations.
Read this first, then `technical-plan.html` (engineering plan, 10 "sheets") and `field-guide.html` (plain-language guide for students/mentors, deliberately free of Jira/tool internals) in this folder. Open them in a browser. The pages and routes below supersede the Designer tab and Assembly hub that those two documents describe, and **`technical-plan.html` predates the tool-owned numbering and Revisions flow, the files and pictures, and configurations: where it differs from this file, this file wins.** The field guide has a section on what the tool does for students (`#tool`).

## What this is

ValorBOM (Valor 6800, a FIRST Robotics team) is a Node/Express + React tool that syncs OnShape CAD BOMs with Jira Data Center. v3 adds a four-concept model that matches how the team actually works:

- **Assembly** — a mechanism (e.g. End Effector). In Jira this is the stock **Epic** type, renamed "Assembly".
- **Build** — one specific combination of Parts for an Assembly (e.g. 1" vs 2" bash bar). New Jira issue type with its own workflow.
- **Part** — a physical piece. Many-to-many with Builds via an issue link.
- **Revision** — a significant redesign of an Assembly or Part, chained with a link. A second axis, separate from Builds. **Build numbers count per Revision ticket** (a new Revision starts again at Build 1). A **Part's** Revision letter is owned by the tool, not typed in OnShape: it starts at A and goes up by itself when the Part's design changes after a cut (see "The tool numbers Parts and owns Revisions").

## Status

| Phase | State |
|---|---|
| 0 Jira schema | Done, live on jira.valor6800.com |
| 1 Backend services (BuildService, RevisionService, OnShape client additions, migration script) | Done |
| 2 Designer | Done; rebuilt in the UX refactor as `/a/:key/design` |
| 3 Assembly page: Build tabs, per-Build BOM, Archive, Create spare, Print, Compare Builds | Done; rebuilt in the UX refactor as `/a/:key/assemble` (Cut Version moved to the Designer only); view-only for Parts (no edits, Save bar, Move or Re-create); shows the Build's Assembly picture, Part thumbnails and an "Off-the-shelf" group |
| UX refactor (Home search, chooser, OnShape onboarding that also creates Build 1, Build save endpoint, bug fixes B1 to B6) | Done (INC-1 to INC-9) |
| 4 OnShape metadata round-trip | Done: the tool numbers Parts (in the Assembly's block), writes number, Revision and Project to OnShape on Save, and writes bumped Revisions on Cut Version; changed Parts are detected automatically (live-verified on the test document) |
| 4b Files, pictures, configurations (2026-11-03) | Done: STEP, DXF(s) and picture attached to each Part ticket in the background; Assembly picture per Build; Part thumbnails; an Assembly can follow an OnShape configuration. The Jira side of attaching and the cut-time Assembly picture are covered by mocked tests only |
| 5 Guidance (teaching empty states beyond the glossary toggletips), instructions authoring (steps + images), activity log | **Not started** |

Verified: `npm test` -> 63 suites / 1371 tests pass (including `__tests__/utils/undefinedNames.test.js`, which parses every client and server file and fails on a name that is used but never imported or declared: such a bug builds fine and only shows in the browser, as `addSessionLinks is not defined` once did); `npx vite build --config src/client/vite.config.js` is clean. **`npm run test:visual` has not been run since the 2026-11 changes** (Playwright is not installed on this machine); its scenarios and fixtures were edited to match (Re-create removed, "Reuse from", numbering) but are unproven, and no scenario covers the pictures, thumbnails, Off-the-shelf group or sub-assembly section.
**Partly verified live** (`.agents/tasks/live-write-check/report.md` for the first round; the live notes in each section below for 2026-11): onboarding, Build create, save/link, field update, Clone and the read paths ran against the real Jira; Cut Version has now run live (HAR-2085, 2026-11-03, the key has Write scope). Supersede and Archive have not been seen live. The UI has never been looked at in a browser by the agent that wrote the 2026-11 changes; the test pass at the end of this file is the next step.

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
- `POST /api/builds/:key/save` — the one Part save path: `{ creates, updates, links, copies }` (≤ 200 items), per-item `{ ref, ok, key, error, field }` results, find-or-create by number across the chain, "Used In" checks in both directions before linking. A retry after "Created, but not added to Build N" only re-links. A `creates` item may carry `cadRef` (the tool numbers the part) and `revises` (the new Revision of that Part); `copies` are `{ ref, from, quantity }`. Results add `fullPartNumber`, `replaced` (the old Revision taken out of the Build), `note`, and `filesPending` (a background file job was queued).
- `GET /api/builds/status?keys=` — Build statuses read by key (search lags transitions).
- `GET /api/stories?key=…&chain=1` — Parts under the whole Revision chain, newest Revision per number.
- `POST /api/parts/preview` accepts `fresh: true` to bypass the 60-second BOM cache.
- `POST /api/builds/:key/cut-version` takes `{ assemblyKey }` only; OnShape ids come from the Assembly record. It first writes the Parts' Revisions into OnShape, then cuts the version, then (in the background) attaches the Assembly picture to the Build. Create spare and Cut Version have repeat guards (409 with `buildStatus`).
- `GET /api/epics/:key/sub-assemblies` and `GET /api/epics/:key/purchased-parts?build=` — the Assembly's sub-assemblies matched to their own Assemblies, and its off-the-shelf rows (see "Sub-assemblies" and "The tool numbers Parts and owns Revisions").
- `GET /api/pictures/part/:key`, `GET /api/pictures/build/:key[?fresh=1]`, `GET /api/pictures/status?keys=` — the images the tool shows and where the background file jobs stand (see "Pictures in the tool").
- Error bodies: `{ error, status, source?, ...details }`, where `source` is `tracker` or `onshape`. The client maps them to student-facing text in `lib/friendlyError.js`.

### Removed endpoints (answer 404 through `apiNotFound`)

- `GET /api/epics?seasonType&year` and `POST /api/epics/from-url` (with `EpicService.getEpics` and `generateEpicFromURL`).
- `POST /api/stories` (create) and `POST /api/parts/upload` (with `PartService.uploadSelected`). These were the Build-less create path that produced HAR-2031.
- `POST /api/builds/:key/parts/:partKey/recreate` (with `BuildService.recreateForBuild`, its repeat guard, and the client's Re-create button). A changed Part now gets its next Revision automatically on Save.

After this, a Part is created only by a Build save (which also makes new Revisions and extra copies) or Create spare. `PartService.createStory` stays as the internal create used by the save. `GET /api/stories`, `GET /api/stories/:key` and `PUT /api/stories/:key` stay.

Removed client code: `DashboardPage`, `AssemblyBomPage`, `AssemblyHubPage`, `AssemblySelection`, `BuildSelection`, `PartsListTable`, the old `DesignerPartsTable`, `parts/PartRow`, `parts/PartsTableToolbar`, the `assembly`, `parts` and `build` Zustand slices, `partRules.isStepAutoExport`, and the client functions `fetchEpics`, `createEpicFromURL`, `createStory`, `uploadSelectedParts`.

## Security: who can reach what (2026-11-03)

Everything is behind Authentik now. `index.js` mounts a **team gate** (`app.use(teamGate)`) right after `/auth` and `/healthz`, so every page, the app's files (`express.static` with `index: false`), every API route and unknown `/api` paths need a session of a member of `TEAM_GROUPS` (default `Valor Students, Valor Mentors`; the mentors group is always included). The **mentor gate** stays on `/purchasing`, `/receiving`, `/api/purchasing`, `/api/receiving` and `/api/sheet-sync`, and now always checks `REQUIRE_GROUP` in the app (default `Valor Mentors` when empty), because Authentik's application binding admits students too. Both are `requireAuth({ groups })` (any of the groups; the session is the signed cookie from the OIDC flow). Unconfigured auth refuses everything with 503 (fails closed); `AUTH_DEV_BYPASS` still works on loopback only. `__tests__/auth/gateScope.test.js` pins the split (anonymous, student, mentor, outsider, forged, unconfigured).

On the client, a 401 mid-session (the 12-hour session expired) reads "Your sign-in has expired. Reload the page to sign in again." (`lib/friendlyError.js`).

**Authentik step (by hand):** bind the **Valor Students** group to the ValorBOM Application next to Valor Mentors, or students are refused at Authentik before the app sees them. The `groups` scope mapping must stay on the provider.

## Cut Builds are immutable

A cut Build is any Build that isn't a Draft (Active, Superseded, Archived). Its Parts list never changes; to change anything, make a new Build. The server enforces this (`utils/cutBuilds.js`), reading statuses from the tracker by key at write time, and answers 409 with no write for:

- linking a Part into a cut Build: `POST /api/builds/:key/parts`, the save endpoint's links and Move, `cloneBuildParts` into a cut Build;
- any `POST /api/builds/:key/save` on a cut Build (refused before any read of the Parts);
- field updates to a Part that any cut Build uses, through the save (per-item result `{ ok: false, status: 409, locked: true, cutBuilds }`) and `PUT /api/stories/:key` (`PartService.updateStory`). The message names the cut Builds.

Still allowed: Archive, Cut Version on a Draft (and the Supersede it does), a new Build copying Parts from a cut Build, a new Revision or an extra copy of a shared Part made for a Draft (through the save), Create spare, and updates to Parts used only by Drafts.

UI: the Designer shows a cut Build view-only (no Update from CAD, Save, Cut Version or add-existing-Part) with a "New Build from this one" button that opens + New Build with "Reuse from" preselected. On a Draft, a row whose Part a cut Build also uses is locked (plain text, "In cut Build N"); a changed one is replaced by a new Revision on Save. The Assembly page is view-only for Parts: no edits, Save bar or Move; Create spare, Print, Compare, Archive, the OnShape link (the button is labelled "OnShape link") and the two-Active repair stay.

A new Revision takes the old one's place in the Draft on Save. There is still no general "remove from Build".

## The tool numbers Parts and owns Revisions

Decided with the user (2026-11-02), replacing the earlier "Revisions come from OnShape" rule. Goal: designers do less manual entry and nobody is unsure which Part to make for a Build.

**Numbering.** A BOM row with no Part number, on a part of the Assembly's own OnShape document (workspace, not a version), is numbered by the tool. Update from CAD shows it as a New row with the next free number (`row.proposedNumber`, "Number is set in OnShape when you Save"). Save claims the numbers for real (`PartNumbers.claim`, one lock per season prefix, keeps the number shown if it is still free), writes **Part number, Revision A and (if empty) Project** onto the OnShape part (`OnshapeWriter.number`, using the part's `configuration`; writing without it 404s on configured Part Studios), then creates the ticket and links it. OnShape is written first on purpose: if the ticket then fails, the next Update from CAD sees a numbered part with no ticket and creates it normally; if OnShape refuses, nothing is made and the number is given back.
- **Numbers live in the Assembly's block** (user rule, 2026-11-02): Assembly 1100 owns Parts 1101 to 1199, Assembly 1000 owns 1001 to 1099 (`blockOf` in `services/partNumbers.js`: the Assembly's number rounded down to the hundred; 01 to 99 inside it). The Assembly's number is read from its ticket summary (`VR27A-1100A ...`) at preview (`PartService._getAssemblySeason`) and at Save (`OnshapeWriter.readBom` -> `assemblyNumber`). An Assembly with no 4-digit number can't number Parts (the rows are listed as not loaded; Save refuses); a full block (99) is an error naming the Assembly. A number the client proposes outside the block is ignored at Save. Existing Parts numbered outside their block are left alone.
- Free means (within the block): not on any Part ticket in the project for that season (all Parts are read and filtered in code; a JQL text search on the summary did not match), not on another BOM row, not handed out by this server a moment ago. The lowest free number in the block wins, so existing numbers are kept and new ones fill around them.
- The client sends only `cadRef` (document:element:part:configuration). The server finds that part in its own read of the Assembly's BOM (`OnshapeWriter.numberingContext`) and uses its name and location, never the client's. A `cadRef` no longer waiting for a number is refused ("Click Update from CAD").
- **A part from another OnShape document is bought, not made** (`isExternalRow` in `bomService.js`: its `itemSource.documentId` differs from the Assembly's). The tool never numbers it or makes a Part for it, **whatever its number**, and the Designer does not show it or warn about it. It comes back in `getBOMReport` as `external` (`{ name, partNumber, quantity }`, the same part in two rows summed) and the **Assembly tab lists it** under "Off-the-shelf" (`GET /api/epics/:key/purchased-parts?build=` -> `EpicService.getPurchasedParts`: the cut version's BOM for a cut Build, so the list is what that Build was made with, else the live BOM; `components/assembly/PurchasedParts.jsx`). Not in the print view. A part of the Assembly's *own* document that is pinned to a version and has no number still lands in the not-loaded list.
- A new Part needs a **name and a material** (`part.missing`); one without is moved to the not-loaded list ("missing Material") and the rest of the BOM loads. There is **no Description rule** (the user removed it, 2026-11-03: custom parts must be numberable without one); a Description is not read or stored. The check applies only to parts the tool is about to create, so an existing Part is never held back.

**Revisions.** The tracker holds the Revision; OnShape's letter is ignored when matching. A CAD row matches the **current Revision of its number** (`baseNumber`, `isCurrentRevision` in `utils/partChain.js`; later letter wins, then the original), so OnShape can show A while the Draft holds B. A missing Revision in OnShape is just A. Rows that differ only by letter count as one part.
- **Changed Parts get a new Revision with no action from the student.** `PartDiff` (`services/partDiff.js`) compares the workspace with the **last cut Build** (newest Revision's highest cut Build that holds an OnShape version; the version link is the snapshot, so no tracker field stores a fingerprint). For every numbered Part that was in that Build it compares the Part's **shape**: volume, surface area, mass and principal moments of inertia (`OnshapeClient.getPartShape`, the part's `massproperties`), plus its material. These are computed by OnShape from the exact geometry, not the display mesh, and do not depend on where the part sits in its Part Studio. Two shapes are the same when every number agrees within **0.01% relative** (`PART_DIFF_TOLERANCE`, default `1e-4`; OnShape's own error bound is about 0.0002%). 0.01% still catches one small hole in a tube (about 0.05% of surface area); loosen it only if false Revisions appear. **The Part Studio's version id is not a signal** (students edit the studio constantly); it only keys a cache of shapes already fetched. A cut version's shapes are fetched once and kept; the workspace's are re-fetched when the studio changes. A part that can't be compared counts as changed (an extra ticket is harmless, a missed one ships the wrong Part). The Part Studio mass-properties endpoint returns one summed total, so it is one call per part. Live check: across all 8 versions of the test document no part reads as changed (0.7 s cold for 2 parts, instant warm). A real geometry edit can't be made through the API, so the "changed" side is covered by unit tests only.
- `previewParts` turns a changed Part **that a cut Build uses** into a New row at the next letter (`revises`, `replaces`), with CAD's quantity and material and the old Part's own machinery, powdercoat, thickness and priority. A changed Part no cut Build uses is the Draft's own and simply follows CAD. The Designer shows "Design changed since Build N: Revision B replaces Revision A" and, on the old row, "Replaced by Revision B when you Save." One Save: creates B, links it to the Build, records Revises (B revises A), and takes A out of the Build (`BuildService._swapRevision`, `JiraClient.deleteIssueLink`); if only the unlink fails the Part is kept and the row says so. The Designer hides A at once (`unlinkedThisSession`) because search lags.
- **There is no Re-create / New Revision button and no endpoint for it.** The student ticks rows and clicks Save, as for any New Part.
- **Cut Version writes the Revisions into OnShape first** (`BuildService._writeRevisions` -> `OnshapeWriter.setRevisions`), for each Part linked to the Build (read from the Build's own links, by key), only where OnShape's letter differs, then cuts the version so the snapshot carries them. If OnShape refuses any, nothing is cut (502 naming the parts). Parts the tool can't write to are skipped. A letter typed by hand into OnShape is overwritten at cut.
- Known gap: two Drafts open at once that both bump a Part will each write their own letter at cut; the later cut wins in OnShape.

**Who owns which field.** CAD owns **Quantity and Material** and always wins. **Machinery, Powdercoat, Thickness and Priority are the student's**: a new Part is seeded and CAD never overwrites them afterwards (`CAD_FIELDS` in `lib/designerRows.js`; `compareBOMWithJira` counts only quantity and material). This fixed a bug where saving a new Part with a chosen Machinery made the row flip back to CAD's default and need a second Save, which then overwrote the choice. Seeds:
- **Machinery** from the material (`MATERIAL_MACHINERY_MAP`).
- **Powdercoat** from the part's OnShape colour (`utils/appearance.js`; the BOM row carries `appearance`, so no extra call), **on aluminium only**. Students never type an exact colour, so it is judged by lightness and hue: lightness at or below 0.2 is Black (the test parts' 36,36,35 reads Black); hue 38 to 54 degrees with saturation of at least 0.45 and lightness 0.3 to 0.8 is Gold; anything else, including OnShape's default grey, is None. The thresholds are named constants at the top of the file.
- **Thickness** from the part's smallest dimension, when it matches a stock thickness: see "Part files and Thickness" below.

**Part files and Thickness** (decided with the user, 2026-11-03: the tool makes the files; they are attached to the Part's ticket). Each Part gets `<Part number>.png` (an isometric picture), `.step` and `.dxf`.
- **Measuring** (`utils/partGeometry.js`, pure; `services/partFiles.js`). OnShape's `bodydetails` for a Part Studio gives every body's faces (plane, normal, area, loops), edges (line or circle with centre, radius and sweep; other curves via `tessellatededges`) and vertices, in metres; one call per studio and configuration, kept 60 s (a version's forever). A part's three dimensions are the sides of its tightest box, trying the frame of each of its (up to three) largest flat faces, so a part tilted anywhere in its studio reads the same. Largest side first; the smallest is the thickness. A tie for smallest (a square tube) goes to the large flat side. A body with no flat face (a ball) has none of this.
- **Thickness** is filled in on a **new** Part at Update from CAD when the smallest side is within 0.01 in of a stock thickness (`THICKNESS_TOLERANCE_IN`; 3 mm reads 0.125), unless it is a 3D print or a new Revision (which keeps the old Part's). Otherwise it stays None. A 2 in tube is None.
- **STEP**: `OnshapeClient.exportPartStep`, a translation job (`partIds` is a string, the configuration a query parameter), polled and downloaded; about 3 s and 600 KB for a drilled tube. The old `exportSTEP` path (`/partid/.../step/`) never existed and returned 404; `exportSTEP` and the `/api/export/step` route now use the translation.
- **DXF**: not an OnShape Part Studio export, so the tool draws it from a face's outer and inner loops as LINE, ARC and CIRCLE entities in millimetres on layer 0, seen from outside the part, lower left at the origin; other curves become short lines from the tessellated edges. **Which faces** depends on the Part's saved **Thickness** (`PartFiles.dxfsOf`): a Part **with** a Thickness is flat stock and gets one `<Part number>.dxf` of its largest side (the face square to the smallest dimension with the most area, so a pocket on one side picks the other); a Part with Thickness **None** (a tube) gets three, `<Part number>_TOP.dxf`, `_RIGHT.dxf` and `_FRONT.dxf`, the biggest flat face on each of OnShape's named sides (`sideViews`: the part's box sides are matched to the named side they face most closely, so a tilted part still gets one of each; a side with no flat face is left out; if only the opposite face exists it is used). Checked on the real tube (RIGHT 495.30 x 50.80 mm with 117 holes, TOP with its angled end, FRONT the end face) and a vendor part with arcs (every arc end meets its neighbour).
- **Picture**: `OnshapeClient.getPartImage`, the part's `shadedviews` with the camera at the front-right-top corner (OnShape's isometric, z up; the matrix is built at the top of the client), edges shown, `pixelSize` 0 so OnShape fits the part to the 800 x 600 image, in the part's own colour. About half a second and 90 KB for the tube; checked by eye. It is the studio's isometric, so a part modelled lying down is shown lying down.
- **Attaching waits for Cut Version** (`services/fileJobs.js`; moved off Save and Update from CAD, 2026-11-04, to cut OnShape calls: the team's plan allows 2500 calls a year, and a Draft's Parts may still change shape, so generating files for one that's still moving — or never ships — spent calls for nothing). **Neither Save nor Update from CAD touches OnShape files anymore.** Cutting a Build (`BuildService._cutOnce`) reads every Part linked to it and **queues a job** per Part (`BuildService._queuePartFiles`), in the background, not waited on. `FileJobs` runs the jobs four Parts at a time: it finds the part in the Assembly's BOM by its number if the job has no location (OnShape still shows a new Revision's old letter, so the letter is ignored), then `PartFiles.attach` adds `<Part number>.png`, `.step` and the DXFs to the ticket, skipping any already there. Real OnShape, 4 Parts (20 files): queued in 0 ms, all on in 4.1 s. A part with no flat face gets a picture and a STEP only.
- **Watching it, and not losing a Part.** The queue is in memory. `GET /api/pictures/status?keys=` says where each job stands (`pending`, `done`, `failed` with the problems; a key it never saw, e.g. after a restart, is left out). The Designer's polling UI (`lib/fileStatus.js`, `thumbStamp`) is wired to a Save response's `filesPending` flag, which nothing sets anymore now that Save doesn't queue files — it is dormant, not deleted, pending a decision on whether to wire it to Cut Version instead. Dedupe: a Part already queued, or done in the last 5 minutes, is not queued again, so a repeat Cut Version attempt (e.g. resuming after a failed supersede) doesn't re-queue everything.
- **Other gaps:** copies made for extra quantity carry no files of their own (the original's apply); nothing retries on its own short of cutting again; a Part never used by a cut Build never gets files.
- **Not run live:** the Jira side of attaching (`JiraClient.addAttachment`, jira.js multipart) is covered by mocked tests only. Everything else ran against the test document with a stand-in tracker.

**Pictures in the tool** (`services/pictures.js`, `routes/pictureRoutes.js`; the user asked for these 2026-11-03). Jira needs a login to read an attachment, so the tool serves the bytes:
- `GET /api/pictures/part/:key`: the `<Part number>.png` on that Part's ticket (404 if none, 400 if not a Part). Cached in memory per attachment, and the browser keeps it an hour. `JiraClient.getAttachmentContent` fetches the attachment's `content` link through `sendRequest` (jira.js's own download call answers 404 on this Jira).
- `GET /api/pictures/build/:key[?fresh=1]`: the Build's Assembly in isometric view (`OnshapeClient.getAssemblyImage`, the same camera as a part's, 1000 x 700, edges shown). A **cut Build** gets `<Assembly number> Build <N>.png` attached to its ticket, **rendered from the version it was cut at** (so it never changes), started in the background after Cut Version (`BuildService._pictureOf`; the cut does not wait, an assembly takes 4 to 8 s to draw). A Build that misses one (cut before this, or the attach failed) is drawn from its version the first time its picture is asked for and attached then (once per Build per run; a read that writes, on purpose). A **Draft** has none: it is drawn live from the workspace, kept 5 minutes, drawn again on `?fresh=1` (Update from CAD asks for that), and sent `no-cache`.
- **Screens:** both pages show the Build's picture at the top of the Build panel (`components/assembly-shared/BuildImage.jsx`; nothing shows when there is none), and the Part column of both tables shows a thumbnail (`PartThumb.jsx`, blank of the same size when a Part has no picture, is not made yet, or is an off-the-shelf row). A row's `imageKey` is the ticket the picture comes from: a spare or copy shows its **original's** picture (lowest ticket number of that number), since only the original gets files. Not in the print view.
- **Not checked live:** there were no cut Builds and no tool-made Part pictures in the tracker when this was built (the earlier test Parts had been deleted), so the cut attach and the Part route are covered by mocked tests; the Jira attachment download was verified earlier against a real attachment (79,756 bytes, PNG header) and the Draft route and the assembly render against the test document.

**Configurations** (found 2026-11-03 on Base Frame, HAR-2084). An OnShape assembly can be **configured**, and a BOM is read for **one** configuration: with no `configuration` parameter OnShape answers for the default. Base Frame's default configuration holds 13 instances (Part 3 = 1103, Part 4 = 1104); the Chassis uses it in a "2x2 Lowered" configuration that holds 20 (Part 4 and Part 5 unnumbered, two 1x1Spacer rows at 1103). The tool read the default, so edits made in the other configuration never showed. The Part Studio is configured too, so some parts (J1D, J2D, the spacer) exist only in some configurations and are missing from the document-wide parts list.
- **The Assembly follows a configuration, kept as a line in its description** (the user's choice; no new tracker field): `Onshape configuration: List_...=...;...` (`utils/onshapeConfiguration.js`). It is taken from the `?configuration=` of the link pasted when the Assembly is added, and for a sub-assembly created from its parent, from the parent's instance of it (`describeSubAssembly` -> `configuration`). OnShape's `default` means none and writes no line. **An existing Assembly gets one by editing its description by hand**; nothing writes it for an Assembly that already exists, and re-pasting its link does not.
- **Every read follows it:** `EpicService.toAssembly` exposes `configuration` (the Assembly search now also asks for `description`) and builds the "Open in OnShape" link with it; the BOM (`BOMService.getBOMReport`, cached per configuration), a cut version's BOM for the diff (`getVersionReport`), numbering and file lookup (`OnshapeWriter.readBom`), the season read in `PartService._getAssemblySeason`, sub-assemblies and off-the-shelf parts, the metadata read when onboarding, and the Assembly picture (`Pictures`, drawn live and from a version) all pass it. The configuration rides in the `assembly` argument the BOM readers already take (`{ seasonType, year, configuration }`). A part's own `configuration` (from its BOM row) is separate and was already used for part metadata, STEP, pictures and body details.
- **Two configurations of one element are the same Assembly to the duplicate check** (it matches on document and element), and **a Part number is one ticket however many configurations use it**. Configurations that reuse a number for different parts collide: with the Chassis's configuration, ticket HAR-2089 ("Part 3", 1103, made from the default) matches the 1x1Spacer that also holds 1103 there and would be updated to its quantity (8). The tool matches on number and does not compare names. Resolve by hand: remove or renumber one.
- Numbers in use are only those of the configuration being read, so the allocator can hand out a number another configuration already uses.

**Quantity lives with the Part ticket.** A Build must hold, in tickets of one Part number, at least the quantity CAD lists. If the Build reuses a Part a cut Build made (New Build "Reuse from") and CAD now needs more, the Designer adds a **copy row** for the difference ("CAD needs 3; 2 already in this Build. Make 1 more."); if the Build is not reusing it, the copy is for the full quantity ("Make 3 new."). Copy rows start ticked; Save makes an exact copy (`PartService.clonePart`, same number and Revision, own quantity) and links it (`copies` in `POST /api/builds/:key/save`). A Part a cut Build made is not offered for ticking into another Build any more: it is reused when the Build is created, or made again through its copy row. Less quantity than the Build holds changes nothing. The copy is the same mechanism as Create spare, so it shows as "Spare" on the row labels.

**New Build.** The form offers "Reuse from [cut Build]" (default, latest cut Build) or "Make everything new", and only lists cut Builds; it is hidden when nothing has been cut.

**Material is locked everywhere.** Unchanged: the Designer has no Material select (`LOCKED_FIELDS`); a material not on the list shows "Not a listed material. Change it in OnShape" and the row is held back.

Live checks on 2026-11-02 (document `76ec7a90…`): part metadata is `editable: true` for workspace parts once `configuration` is passed; HAR-2075's preview matched 1101A and 1102B and left the vendor and sub-assembly rows alone (it also held "Part 3" and "Part 4" for a missing Description, a rule since removed). **Live writes verified (user-approved, on the Base Frame tab, then restored):** `setRevisions` changed 1102 from B to C and back; `number()` gave "Part 3" Part number 0001 (before the block rule; it would now be 1101 under Base Frame), Revision A and Project VR27 (the BOM then read it as VR27P-0001A), and clearing the three fields returned it to unnumbered.

## Spares: repeated Part numbers

A spare repeats its original's number, so several tickets can share one full number. **The original is the one with the lowest ticket number** (`isMoreOriginal`/`keyNumber` in `server/utils/partChain.js`; a matching copy in `lib/designerRows.js`). That rule decides which ticket CAD matches (`BOMService.compareBOMWithJira`), which one a save reuses (`preferNewestRevision`, tie-break within one Epic Link), and which one the Designer treats as the original. A spare keeps the source's Epic Link precisely so this tie-break always applies. Spares show the label "Spare". There is no tracker marker for a spare: Labels is not on the Part screen. If one is ever added, use it instead of the key rule.

Which Parts the Designer lists: this Build's Parts, New from CAD, and **Parts in no Build** (spares). A Part that is in other Builds only is hidden, unless Update from CAD lists it (then it shows as "Also in Build N", so an unchanged Part can still be added to a Draft). The Assembly page's third group is now "Not in any Build".

## Part priority

Each Part has the tracker's built-in Priority (Highest, High, Medium, Low, Lowest; `PRIORITIES` in `bomConstants.js` and mirrored in `api/client.js`). The Designer has an editable Priority column ("Not set" when the tracker returns none), the Assembly page and Print show it as text. CAD never sets it.

**Priority must be added to the Part screen before it can be saved.** On 2026-11 the tracker's createmeta for the Part type listed neither Priority nor Labels, so a write would be refused ("Field 'priority' cannot be set. It is not on the appropriate screen"). To keep every other save working until then, a priority is **sent only when it changed** (`valuesOf` in `lib/designerSave.js`; the server writes `priority` only when the payload has one). Reading needs nothing: search returns it already. Create spare copies a priority only when it isn't Medium, for the same reason.

Tracker steps (by hand, decided with the user): in Jira admin, find the screen the Part issue type uses (`Hardware Part Screen` was used for the Build fields), add the built-in **Priority** field to a tab, and check Priority isn't hidden in the Part's field configuration. Then change one Part's priority in the Designer, Save, and confirm it in the tracker.

Not built: Builds have no priority (the user chose Parts only), and nothing sorts or filters by priority yet.

## Sub-assemblies

An assembly's BOM can list sub-assemblies (1000 with 1100, 1200, 1300). They are **Assemblies, never Parts**.

- **BOM parser** (`bomService.js`): a top-level row is a sub-assembly when it has an `itemSource` with an `elementId` and either nested rows ("2" with "2.1") or no `partId`. It is kept out of `parts` and `unidentified` and returned as `subAssemblies` (`getBOMReport`, and `previewParts` passes it on). A row with no `itemSource` is always a Part. **Checked live (read-only) on 2026-11 against the "Chassis" assembly** (doc `76ec7a90…`): its sub-assembly rows have `partId: ""`, nested rows and `bomBehavior` "Show Assembly and components", and are recognised. Nested sub-assemblies (a "Swerve" at `1.7`) are skipped as before. A vendor row like "Robot Battery" (`WCP-1492`, a `partId`, from another document) is still a Part row and still shows in the unidentified warning (the open COTS question).
- **Onboarding** (`epicService.js`): `previewOnboarding` and `onboardAssembly` now also handle the sub-assemblies, one level down only (a sub-assembly's own sub-assemblies are not followed). For each, the ids come from the BOM row (workspace from `wvmId` when `wvmType` is `w`, otherwise the document's Main workspace), then it is checked (a sub-assembly with no Project of its own takes its parent's season, as BOM Parts do): `exists` (matched by OnShape element and document, as for the pasted link), `new`, `conflict` (its number belongs to a different OnShape assembly), `problems` (incomplete OnShape properties) or `error`. Only `new` ones are created, each with its Build 1; nothing that exists is created again. A failure on one never stops the others or the main assembly, and a BOM that cannot be read is reported as `subAssembliesError` while the main assembly is still added.
- **Pasting an assembly that already exists** previews its sub-assemblies too, and the "already here" dialog offers "Create N missing sub-assemblies" (calls `POST /api/epics/onboard`, which for an existing assembly creates only the missing ones).
- **UI**: the confirm and "already here" dialogs list each sub-assembly ("already exists (HAR-2000), so it will not be created again", "will be created", "skipped, fill in Part number in OnShape"). After creating, the Designer opens with the same list as a banner. Update from CAD shows a note naming the sub-assemblies instead of a Part warning. Wording lives in `lib/subAssemblies.js`.
- **Names drop [bracketed] tags**: "[1300] Electrical" becomes "Electrical" (`utils/cleanName.js`, `stripBrackets`). Applied to Assembly names (pasted and sub-assemblies, so the summary is `VR27A-1300A Electrical`) and to BOM Part names. A name that is only brackets keeps the text inside. The "couldn't identify" list still shows the raw OnShape name so the row can be found.
- **Sub-assembly links on the Designer and Assembly pages** (`components/assembly-shared/SubAssemblyLinks.jsx`, `GET /api/epics/:key/sub-assemblies`, `EpicService.getSubAssemblies`): a "Sub-assemblies" section under the page header. The tracker stores no parent/child link, so the list is read from the Assembly's own OnShape BOM (the 60-second BOM cache) and each row is matched to the Assembly made from that tab: the workspace the BOM points at first, then the Revision the row shows, then the newest. A match links to that Assembly's page in the same mode (Designer links to Designer, Assembly to Assembly). One not added yet is listed with a pointer to Home. The section is hidden when there are none, and a BOM that cannot be read shows a muted note, never an error page. The visual harness answers this call with an empty list by default; no scenario shows the section yet.
- Not built: following nested levels, and linking a sub-assembly to its parent in the tracker (there is no parent/child link between Assemblies).

## New Revisions from an OnShape branch

A new Revision of an Assembly starts as a **branch** (workspace) of the same OnShape document, where the Revision property is raised. The duplicate check used to match on document + tab only, so every branch looked like the Assembly already added.

`EpicService._classify` now decides what a pasted link (or a sub-assembly) is:

- **exists**: the same workspace, or a branch with the same number and the same (or a lower) Revision. If a branch carries a *different* number than the Assembly it came from, it is still `exists` but the response has `branchMismatch`, and the dialog tells the student to fix the Part number in OnShape.
- **revision**: a branch of an element that is already an Assembly, with the **same number and a higher Revision letter**. Preview answers `status: 'revision'` with `previous`. Confirming creates a new Assembly at that Revision (OnShape's own letter, which can skip), links it to the earlier one with Revises (new revision "revises" the old; same direction as `RevisionService`), and makes its **Build 1**. If the link fails, the Assembly and Build 1 are kept and `revisionLinkError` is returned and shown as a Designer banner.
- **conflict** / **new**: as before.
- If the properties of a branch cannot be read, it stays `exists` (the old behaviour).

Because the new Assembly is chained to the earlier one, the Designer reads Parts across the chain: unchanged Parts and sub-assemblies of the earlier Revision are reused, and anything OnShape bumps becomes new.

**Sub-assemblies follow the same rule.** If 1000B's BOM still has 1100A, 1100A already exists and is reused (listed as "already exists", not created again). If OnShape raised it to 1100B, it is previewed as "will be created as the next Revision of 1100A" and created with its Revises link and Build 1.

**Build numbers now count per Revision** (the user's decision): Revision B's first Build is Build 1 whatever Revision A has, and later Builds count on from B's own. `BuildService.createBuild` numbers from the one Assembly key; the Revision chain still scopes which Builds a new Build may copy Parts from. The Designer's default number comes from the selected Revision's Builds. This replaces the earlier "continuous across the chain" rule.

Live check (read-only, 2026-11): document `76ec7a90…` has branches Main (Chassis 1000 A) and B1. B1 reads Part number **1100**, Revision B, so the tool answers `exists` with a number mismatch, not a new Revision. Set B1's Part number to 1000 and it should come back as `revision`.

Not built: nothing unlinks or retires the earlier Revision's Assembly, and following nested sub-assemblies is still one level.

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
- `BuildService` depends on `partService` and `revisionService` for the save and chain reads, on `onshapeClient` for Cut Version, and (all optional, so older tests construct it bare) on `partNumbers`, `onshapeWriter`, `fileJobs` and `pictures`. `EpicService` depends on `buildService` to create Build 1 when onboarding, and on `bomService` for sub-assemblies and off-the-shelf rows.
- **Services added 2026-11** (all in `src/server/services/`, wired in `index.js`): `partNumbers.js` (numbers in an Assembly's block, claimed under a per-season lock), `onshapeWriter.js` (everything that writes to OnShape: number, Revision, Project; and reads the Assembly's BOM for numbering), `partDiff.js` (what changed since the last cut), `partFiles.js` (measuring, the DXF, and attaching a Part's files), `fileJobs.js` (the background queue for those), `pictures.js` (the images the tool serves). Pure helpers in `src/server/utils/`: `partGeometry.js` (dimensions, thickness, DXF), `appearance.js` (powdercoat from colour), `onshapeConfiguration.js` (the configuration line), `onshapeProperties.js` (OnShape's built-in property ids). Client: `lib/fileStatus.js`, `components/assembly-shared/{BuildImage,PartThumb}.jsx`, `components/assembly/PurchasedParts.jsx`.
- `OnshapeClient` gained: `exportPartStep` (translation job), `getPartShape` (mass properties), `getBodyDetails`, `getTessellatedEdges`, `getPartImage`, `getAssemblyImage`, `getAssemblyBOMAtVersion`, `updatePartMetadata` with `configuration`, and list query parameters (`edgeId=a&edgeId=b`). `JiraClient` gained `deleteIssueLink`, `addAttachment` and `getAttachmentContent`.
- Frontend: React 19, react-router 6, Vite, hand-written CSS in `index.css` with design tokens in `:root` (dark/gold theme). Shared UI primitives are in `components/ui/` (`Dialog`, `EmptyState`, `StickySaveBar`, `DisclosureMenu`, `Badge`, `Button`, `Card`, `InlineSelect`). Page pieces are in `components/home/`, `components/assembly-shared/`, `components/builds/`, `components/designer/` and `components/assembly/`.
- The Designer and Assembly pages keep their own local state (`useState`/`useReducer`) rather than sharing Zustand slices, on purpose, to avoid cross-page interference. Zustand (`store/index.js`) now holds only purchasing and receiving.
- Pure client logic lives in `lib/` (`buildNames`, `designerRows`, `designerSave`, `partValidation`, `friendlyError`, `fileStatus`) and has Jest tests in `__tests__/utils/`, including a parity test between client and server Part validation and `designerFlow.test.js`, which replays a Save through the real row model (the test that found the double-Save bug). Before reporting UI work finished, run the whole suite: the undefined-names test is the only thing that catches a missing import.
- UI copy uses only the words Assembly, Build, Part and Revision. It never says "epic", "story", "issue" or "Jira"; the tracker is "the team tracker". The visual harness enforces this.

## Visual test harness

`tests/visual/` (see its README): `npm run test:visual -- --inc INC-n` or `--all` starts a throwaway Vite on `127.0.0.1:5191`, answers every `/api/` request from `tests/visual/fixtures/`, and takes screenshots at three viewports with axe, vocabulary and console checks. `npm run test:visual:fixtures` regenerates the fixtures from the real services wired to fake clients. Playwright is pinned to 1.61.1 (Chromium revision 1228) and never downloads browsers on install.

## Decisions made with the user (don't relitigate)

- Anyone can create a Build or start a Revision (no lead gate). Every Assembly starts at Revision A. Parts never span Assemblies (same design under another Assembly = new Part number).
- No separate database; Jira holds everything. Accepted trade-off: Part quantity is one number per ticket, not per Build.
- **Create spare (was Clone a Part) is an exact copy.** Same summary, so same Part number, name and Revision; same BOM fields and the source's own Epic Link; optional quantity; in no Build. ValorBOM no longer allocates Part numbers (`getNextPartNumber` and the allocation floor are gone). The Assembly page button and dialog say "Create spare"; the dialog has no name field.
- Move to this Build = plain Used In link. (Re-create was replaced by automatic new Revisions on Save; see "The tool numbers Parts and owns Revisions".)
- Creating an Assembly from OnShape also creates its Build 1.
- Cut Version is on the Designer only.
- No auth on BOM writes in this refactor (see the Security section).
- Instructions authoring was moved from Phase 3 to Phase 5.
- No glossary `?` buttons or teaching/helper text in the UI. Terms will be explained on a team Confluence page (URL TBD; no link in the app yet).
- The Assembly page hides Draft Builds (tabs, Compare, Print, labels). A `?build=` pointing at a Draft falls back to the Active Build. The Designer still shows Drafts.
- Cut Builds are immutable (server-enforced); shared Parts are locked (a changed one gets a new Revision on Save); the Assembly page is view-only for Parts. See "Cut Builds are immutable".
- **OnShape owns Material.** Material is plain text in the Designer, always; it changes only through Update from CAD.
- **The tool owns Part numbers and Revisions** (2026-11-02, replacing "Revisions come from OnShape"): it numbers Parts inside the Assembly's block (Assembly 1100: 1101 to 1199), starts them at Revision A, and bumps a Part's Revision itself when its design changes after a cut (shape compared with the last cut version, within 0.01%), writing both back to OnShape. No Re-create button, no manual Revision entry. Quantity lives with the Part ticket: extra units are made as exact copies. See "The tool numbers Parts and owns Revisions".
- **A part from another OnShape document is bought, not made**: no Part, no warning in the Designer; listed under "Off-the-shelf" on the Assembly tab.
- **No Description rule** (2026-11-03). Name and material are the only requirements on a new Part.
- **Files and pictures are the tool's job** (2026-11-03): every Part ticket gets a picture, STEP and DXF(s); a Build gets its Assembly picture. Save does not wait for them; Update from CAD makes up any that are missing.
- **DXF by Thickness:** a Part with a Thickness gets one DXF of its largest side; one without (a tube) gets TOP, RIGHT and FRONT.
- **Machinery, Powdercoat, Thickness and Priority belong to the student** once a Part exists; CAD seeds them (machinery from material, powdercoat from colour on aluminium, thickness from the smallest dimension) and never overwrites them.
- **An Assembly follows one OnShape configuration, kept as a line in its description** (2026-11-03; a new tracker field was offered and declined).
- Less text in the UI (2026-11-03): sub-assemblies appear once, as "Name, Not added yet", with no banners repeating them.

## Known gaps / open items

1. **`onshapeClient.createBranch` request body is a best guess** (`branchedFrom: {vid}`), flagged in code. Unverified against OnShape's API. Phase 4 also needs OnShape metadata write endpoints (`updatePartMetadata`/`updateElementMetadata`) that have not been verified.
2. **Live data mismatch:** older Jira tickets are off-season practice parts ("Myra-CLONE - 1101A Gearbox...") that don't match `partMask.js` naming (`V[RF]yy[AP]-NNNN`). Home search still finds them by key or name and labels unnumbered Assemblies "(No number)".
3. ~~Build numbering across revisions not continuous in practice.~~ **Superseded:** numbering now counts per Revision (see "New Revisions from an OnShape branch"). `createBuild` still derives the chain, but only to validate a copy source.
4. `RevisionService.getRevisionChain` only walks backward, so opening an old Revision won't list newer ones in the Revision selector.
5. ~~Part save swallows per-row failures.~~ **Closed:** saves go through `POST /api/builds/:key/save`, which returns per-item results; both pages show the error on the row with a Retry that only re-links an already-created Part.
6. `scripts/migrate-build-revision.mjs` (backfills Build 1 per existing Assembly, dry-run by default, `--execute` to write) has NOT been run against production.
7. Print view omits instructions (they don't exist yet).
8. Auth is not configured in dev (`OIDC_*` missing). See the Security section before any non-loopback bind.
9. ~~Small UI issues found in review.~~ **Closed** in the cleanup pass: Home re-syncs its search from the URL on every navigation (brand, "Find an Assembly", Back); the dialog × is disabled while onboarding's "Creating…" or an Archive runs; the wrong-Build notice clears when another Build is picked (both pages); Clone a Part is disabled on an Archived Build; Compare drops a picked pair when the Build changes or a Build in the pair is no longer listed; a Retry whose Parts read fails keeps the last good Parts; long Assembly names clamp to two lines with the full name in the title; Re-create past Revision Z is a 409 with a readable reason; `.env*` is gitignored; the client constructor tests no longer depend on exported env vars. Still open from review, by choice: COTS/hardware BOM rows without a Part number show in the unidentified warning (honoring `excludeFromBom` is a product decision).
10. Update from CAD doesn't yet flag a BOM row whose full number already belongs to a Part of a different Assembly; Save would create a second Part with that number.
11. From the live write check: Used In links 16601 and 16603 were made before the link-direction fix and still read "HAR-2031 uses …" (the app matches either direction; re-creating them is a tracker write that needs the user's OK). Cut Version, Supersede and Archive stay unverified live until the OnShape API key has Write scope.
12. **A part deleted from CAD is not detected.** Update from CAD finds new, changed and quantity-changed parts; one removed from the BOM stays in the Draft until someone takes it out in the tracker (there is no "remove from Build" action).
13. **Configurations:** the Assembly follows one configuration (its description line); an existing Assembly needs the line added by hand; a Part number is one ticket however many configurations use it, so configurations that reuse a number for different parts collide (HAR-2089 vs the 1x1Spacer on Base Frame is the live example, unresolved); the allocator only sees numbers of the configuration being read.
14. **Files:** copies made for extra quantity have no files of their own; a failed or lost file job is only retried by the next Update from CAD; a Part that lacks only a DXF is not noticed; the job queue is in memory and per process (single replica only).
15. **Unproven live:** `JiraClient.addAttachment` (the Jira upload), the cut-time Assembly picture, the Part-picture route against a real tool-made attachment, and Create spare with the new rules. All are covered by mocked tests; the earlier Jira attachment download and every OnShape call were run against the test document.
16. **Off-the-shelf rows and pictures are not in the print view.**
17. `PART_DIFF_TOLERANCE` (default 0.0001) is a judgement call: 0.01% still catches a small hole but a looser value avoids false Revisions. Tune it if the team sees either.

## Manual follow-ups (tracker, by hand)

- **Priority on the Part screen:** it is on the Part create screen as of 2026-11-02 (createmeta lists it); confirm one real Save writes it. See "Part priority" above.
- **Configuration line:** an Assembly that must follow an OnShape configuration other than the default needs `Onshape configuration: ...` in its description (copy it from the `?configuration=` of the OnShape link of the configuration it should follow; for HAR-2084 that is the "2x2 Lowered" one: `Onshape configuration: List_7BgV2vxCHVntIE=_2x2_Lowered;List_SU9XIYjjB4kB3y=Default;List_c3HUM4N9FVts6n=X2CR;List_dW0Ex4azN5YRhy=Default;List_pLSMbCXixdd0UU=X2C0`). Assemblies added from a link with `?configuration=` get it automatically.
- **Tracker permissions:** the service account needs "Create attachments" on the project (the Part screen already has the Attachment field).
- **HAR-2031 Revision:** set its Revision field (`customfield_10500`) to `A`. HAR-2031 was created by the removed Build-less path; ValorBOM never writes it back.
- **Part screen fields:** a tracker admin should remove Build Number (`customfield_10501`), Onshape Version Link (`customfield_10502`) and Instructions Data (`customfield_10503`) from the Part screen. Until then they show, empty, on every Part. The "In Build" labels in ValorBOM are the source of truth.

## Where the agent notes live

Every investigation, design, review and verification from this work is checked in under `.agents/tasks/` (screenshots are gitignored; regenerate them with the visual harness):

- `epic-part-number-parsing/`: why Assembly names ignored OnShape properties (fixed, `1f840c9`).
- `update-from-cad-no-parts/`: BOM rows identified from Part number + Revision properties (fixed, `c1cd9a5`).
- `har2031-part-fields/`: empty Revision / Build fields on Parts; Build fields are Build-only (B6).
- `ux-refactor/`: the approved design (`design.md`, draft 8, with the user's answers in section 15), `plan.md`, `progress.json`, review history and `final-report.md` for INC-1 to INC-9.
- `live-write-check/`: the live run against Jira/OnShape, its write log, bugs found (link direction, `linkIssues`, error mapping) and the re-runnable `live-check.mjs` (writes to the live tracker; scope-checked to a named test Assembly, so edit its scope before reuse).
- `.kiro/specs/valorbom-modernization/`: the earlier v2 modernization spec.

The test Assembly HAR-2030 and its tickets (HAR-2031 to HAR-2035) were deleted after the live check, so the manual follow-ups and gap 11 that name them no longer apply.

## Before deploying (open as of 2026-10-31)

1. **Gate BOM writes.** Production (docker2 via Portainer, `HOST=0.0.0.0` in the image) is reachable from other machines, so the Security section applies: put the listed write and export endpoints behind the Authentik gate, or accept the risk explicitly.
2. **OnShape key in production.** The container's own env (set in Portainer, not `.env`) needs an OnShape key with Write scope, or Cut Version answers "OnShape refused the change (403)". `OnshapeClient` reads `ONSHAPE_ACCESS`/`ONSHAPE_SECRET` first, then `API_KEY`/`SECRET_KEY`. Check scopes with `GET /api/users/sessioninfo` (`oauth2Scopes` bit 2 = write). The local key was pasted into a chat on 2026-10-31 and must be rotated.
3. **One optional env var** compared with `master`: `PART_DIFF_TOLERANCE` (relative, default `0.0001`; see `.env.example`). The Jira schema is already live, so no migration is needed. The service account needs permission to create attachments; the OnShape key needs Write scope (verified live, 2026-11-03) and read access to every document the team references.
4. **Removed APIs** (`POST /api/stories`, `POST /api/parts/upload`) break any outside script that used them.
5. ~~Re-create leaves the old revision in the Draft.~~ **Closed:** Re-create is gone; a new Revision takes the old one's place on Save (see "The tool numbers Parts and owns Revisions").

## Running it

- `npm install`, `npm run dev` for Vite (5173), `node src/server/index.js` for the API (PORT from `.env`, 6803 here). Server binds 127.0.0.1.
- `.env` holds real Jira/OnShape credentials and is gitignored. Do not commit or print it (or `.env.authentik`). Never use or ask for credentials to bypass interactive logins.
- Jira writes against the live instance affect the team's real tracker. Ask before mutating (creating/linking/transitioning tickets), and prefer read-only checks.

## Suggested test pass for the user

1. On Home, paste the OnShape link of an assembly whose Properties have Project, Part number, Revision and Name filled in (add `?configuration=` if it is configured). Confirm, and check that the Designer opens on Build 1, runs Update from CAD, and shows the Assembly picture.
2. Give a part no Part number in OnShape. Update from CAD should list it as New with the next number in the Assembly's block; Save once, then check that OnShape now has the number and Revision A, the ticket exists and is linked to Build 1, and within a few seconds the Part's picture, STEP and DXF(s) are on the ticket and its thumbnail appears. Change a Machinery before saving and check it is still what you picked afterwards, with nothing left to save.
3. Cut Version on Build 1. Check the Build ticket gets the Assembly picture, and that OnShape now shows each Part's Revision.
4. Make Build 2 ("Reuse from Build 1"). Raise a quantity in OnShape: Update from CAD should offer "Make N more". Change a part's shape (move a hole): it should show "Design changed since Build 1: Revision B replaces Revision A", and one Save should swap B in for A. Add an off-the-shelf part from another document: it should appear under "Off-the-shelf" on the Assembly page and nowhere in the Designer.
5. Search for the Assembly on Home by number, name and key, open it in Assembly mode: Build tabs, Create spare, Compare Builds, Print, Archive.
6. Paste the same OnShape link again and check that Home offers to open the existing Assembly instead of creating a second one.
7. Watch the browser console and the server log for errors; report anything odd.

## Links

- Technical plan artifact: https://claude.ai/code/artifact/2496296b-7c3a-47be-b540-a75c2a319d03 (the copy in this folder is the source; republish with the Artifact tool using that URL to update it)
- Field Guide artifact: https://claude.ai/code/artifact/c1351bf2-1410-4338-9472-1d05a0520065
- Full original conversation transcript (if still available locally): `C:\Users\mray1\.claude\projects\e--6800-2021bom\d070bc9d-e052-468a-8b4f-4b8b141a3d59.jsonl`

## Assembly flow for students (2026-11-03)

Decided with the user: instructions are **auto-generated only** (no authoring), kitting is a **printable sheet only** (nothing saved), the vendor lookup **also reads vendor sites**, and Parts show their **board column plus a Build readiness summary**.

- **Manufacturing status.** `_parseStories` now carries `status` and `statusId`. `GET /api/boards/columns` (`services/boardColumns.js`) reads the Agile boards of `PROJECT_KEY` (Manufacturing: Backlog, Ready, Manufacturing, Post Process, Needs Approval; Assembly: To Do = Mentor Approved, Powder Coat, Assembly, Done = Assembled), kept 10 minutes. `lib/partStage.js` maps status names to stages (Not started, Being made, Finishing, Ready to assemble, Assembled; `Ignore` and `Epic Closed` are "Status unknown"). The Assembly table has a Status column, and `BuildReadiness` shows "N of M Parts ready" with the blockers, furthest behind first.
- **Build guide** (`?view=guide`; `utils/assemblyGuide.js`, `services/assemblyGuides.js`, `GET /api/guide/:buildKey`). Built from the Build's multi-level OnShape BOM: the cut version for a cut Build, else the workspace. There is one step per unnumbered sub-assembly of the Assembly's own document, deepest first, with the Assembly itself last. A numbered sub-assembly (its own Assembly) is listed, not opened. The Assembly page lists only sub-assemblies that exist as Assemblies (the Designer still lists the ones not added yet). A vendor assembly (another document) is one vendor line. The same sub-assembly used in several places is one step whose count sums every use; two configurations of it become "(variant n)". Line kinds are made, hardware (OnShape `isStandardContent`), vendor, assembly, and step. Numbered Parts merge by number. Pictures come from `GET /api/guide/:buildKey/image/:imageId`, where the id is a BOM row path the guide handed out (an OnShape render, kept for good for a version and 5 minutes for a workspace).
- **Kit sheet** (`?view=kit`): one bin per step (hardware + vendor lines, the total for every unit), then the whole-Build totals. Tick boxes are printed only.
- **Vendor parts** (`utils/vendorSku.js`, `services/vendorCatalog.js`). A SKU is read from the Part number cell, then the name, then the description (`WCP-XXXX`, the first four digits only, so `WCP-1109-001` is `WCP-1109`; `TTB-`, `REV-`, `AM-`, McMaster `91251A540`). Orders are the PARTS tickets whose Part Number field is exactly that SKU. The catalog uses Shopify product JSON on wcproducts.com and thethriftybot.com only: the product named after the SKU, else a search result that has a variant with that SKU, else the ticket's link on one of those hosts (in that last case no price is claimed when the product has other variants). Pictures come only from `cdn.shopify.com` or the store, are PNG/JPEG/WebP/GIF only, and are proxied through the server. Results are kept a day when found and an hour when not. REV is not on Shopify: it gets a product link only. The Off-the-shelf group now splits "Hardware" from vendor parts and shows order status, the vendor link, price and stock.
- **Known gaps.** The BOM parser still skips nested rows, so a numbered Part inside an unnumbered sub-assembly (Bumper Mount's 1207, Gusset's 1203/1204) gets no Part ticket. The guide shows it as "No Part ticket for number N yet". The Off-the-shelf group lists top-level rows only (the guide covers nested ones). Mates are not used: in the test document every mate is a generic "Fastened N".
