# HAR-2031: empty Revision, Build Number and Onshape Version Link

Read-only investigation. No repo source files, Jira issues, or OnShape documents were changed. The live check was a throwaway script at `/tmp/har2031-check/check.mjs` that made GET requests only.

## Summary

- **Revision (customfield_10500) empty: a gap that should be fixed.** Part creation never writes the Revision field (`PartService._buildJiraFields`, `src/server/services/partService.js:340-358`). The code treats a blank Revision as "A" (`nextRevisionLetter`, `src/server/services/revisionService.js:18-25`; `scripts/migrate-build-revision.mjs:5-6`), so HAR-2031 behaves as Revision A today and nothing is broken yet. But new Assemblies now get `A` written (`epicService.createEpic`, uncommitted), and so do Re-created Parts (`revisionService.js:97`). A Part created from CAD whose BOM letter is B or C would carry that letter in its summary while the blank field reads as A. Its next Re-create would then compute the wrong letter.
- **Build Number (10501) empty: intended.** It is a Build field. The only writer is `BuildService.createBuild` (`buildService.js:86-92`), and that writes to the Build issue.
- **Onshape Version Link (10502) empty: intended.** It is a Build field. The only writer is `BuildService.cutVersion` (`buildService.js:126-129`), which writes it on the Build when its version is cut. Both Build fields also show on the Part screen, but that is a Jira screen-config leftover and nothing more. `editmeta` for HAR-2031 lists Build Number, Onshape Version Link and Instructions Data as editable. The Assembly HAR-2030's screen correctly leaves them off.
- **Missing Build / "Used In" link: the user skipped the Build step without knowing it. This is not a Designer bug.** HAR-2031 has no issue links, and the whole HAR project has **zero** Build issues. The Designer cannot save without a selected Build: it renders no toolbar (no Update from CAD and no Save) until a Build is selected (`DesignerPartsTable.jsx:236-244`, and the bundle in `dist/` that the server serves contains this gate). So HAR-2031 was almost certainly created from the legacy **/assembly** page (`PartsListTable.jsx:96-124`), which has no Build concept and never links. The server log for the session just before the restart supports this. Every request in it is `/assembly`, `GET /api/stories?key=HAR-2030` and `POST /api/parts/preview`, and there is no `/api/builds` call at all. Usability bug: /assembly still offers "Update from CAD" + Save for v3 Assemblies with no hint that a Build is needed.

## Evidence

### 1. Live Jira state (GET only)

HAR-2031:

| Field | Value |
|---|---|
| issuetype / status | Part / Backlog |
| created | 2026-10-29T20:28:56Z (15:28:56 CDT) |
| summary | `VF27P-0001A Test Part` |
| customfield_10500 Revision | **null** |
| customfield_10501 Build Number | null |
| customfield_10502 Onshape Version Link | null |
| customfield_10110 Epic Link | HAR-2030 |
| customfield_10300/10301/10302 | null / null / null (these are Assembly fields, so null is expected) |
| Quantity / Material / Machinery | 1 / PLA / 3D Printer |
| issuelinks | **[]** (no "Used In", no "Revises") |

HAR-2031 `GET /rest/api/2/issue/HAR-2031/editmeta`: Revision, Build Number, Onshape Version Link, Instructions Data and Epic Link are **all present** on the Part edit screen.

HAR-2030:

| Field | Value |
|---|---|
| issuetype / status | Epic (displayed as Assembly) / New |
| summary / Epic Name | `VF27A-0000A Test Assembly` |
| customfield_10500 Revision | **"A"** (confirmed) |
| 10300/10301/10302 | 8c64dfdcb66184646a7a3f17 / 82f00d3cbea6901ac26040bd / faea62821490977c33bc8d7c |
| issuelinks | [] |
| editmeta | Revision is on the screen. Build Number, Onshape Version Link, Instructions Data and Epic Link are not, which is correct for an Assembly. |

JQL checks:
- `project = HAR AND issuetype = Build AND "Epic Link" = HAR-2030` returned 0.
- `issue in linkedIssues(HAR-2031)` returned 0.
- `project = HAR AND issuetype = Build` returned **0**. No Build exists anywhere in the project.
- `createmeta` (for checking the create screens) returned 404. Jira 9 DC removed the old `/issue/createmeta?expand=` endpoint, so editmeta was used instead.

### 2. Designer save path

- **The Designer requires a Build.** `DesignerPartsTable` returns a "Select an Assembly and a Build above" placeholder with no toolbar when `!selectedEpic || !selectedBuild` (`src/client/src/components/DesignerPartsTable.jsx:236-244`). `handleUpdateFromCAD` also bails out when no Build is selected (`:95-96`). `BuildSelection` only fills its dropdown from `GET /api/builds` (`BuildSelection.jsx:30-36`, `store/buildSlice.js:35-47`), and that call returns `[]` for HAR-2030. So no Build could have been selected.
- **When a Build is selected, the Designer links.** `handleSave` calls `createStory(...)` and then `linkPartToBuild(selectedBuild.key, result.key)` (`DesignerPartsTable.jsx:150-161`). That goes to `POST /api/builds/:key/parts` (`buildRoutes.js:86-95`), then `BuildService.linkPartToBuild`, then `jiraClient.createIssueLink('Used In', partKey, buildKey)` (`buildService.js:106-110`). Rows already in Jira but not in this Build also get linked when the user checks them (`:186`, `:198`).
- **Weakness in the Designer path.** If `createStory` succeeds and `linkPartToBuild` then fails, the error is swallowed by `console.error` (`:165-167`). The row stays "New", so the Part is orphaned and a second Save would try to create a duplicate. This is HANDOFF known gap 5.
- **The legacy /assembly page never links.** `PartsListTable.handleSave` calls `createStory` only (`src/client/src/components/PartsListTable.jsx:96-124`) and imports no Build APIs (`:2`). HANDOFF says this page is "untouched" on purpose. It shares `POST /api/parts/preview`, so the recent BOM fix made Update from CAD work there too, and that is what let this flow produce HAR-2031.
- **Server-side create.** `POST /api/stories` (`partRoutes.js:57`) calls `PartService.createStory` (`partService.js:251-257`), which calls `_buildJiraFields` (`:340-358`). The payload contains project, summary, issuetype Part, Machinery 10201, Quantity 10206, Epic Link 10110, Material 10202, and optionally Powdercoat 10204 and Thickness 10207. **There is no `customfield_10500`.** The client payloads in both tables don't send a revision either, even though the preview rows already hold it (`bomService.js:171-188` validates the BOM Revision; `applyPartMask` returns it as `version`, `partMask.js:43-47`).
- **clonePart has the same gap.** It formats the summary with `version: 'A'` (`partService.js:119`) but goes through `createStory`, so the Revision field stays blank. HANDOFF says "Clone gets Revision A", and that holds only in the summary.
- **Writers of the Revision field:** `RevisionService.createRevision` (`revisionService.js:97`, used by Re-create) and `EpicService.createEpic` (uncommitted change in the working tree) are the only ones.

Where the user was: the current server (PID 69231) started at 15:28:33 CDT and logs to a terminal, so its requests can't be read. HAR-2031 was created 23 seconds later. That fits an already-open page and a quick Update from CAD and Save. The previous instance's log (`/tmp/valorbom-server.log`) covers HAR-2030's creation and its first preview, and every page load in it is `/assembly`. I'm inferring "the /assembly page" from that log plus the zero-Builds fact. It is not directly logged. Either way, the Designer could not have saved without a Build.

### 3. Build Number / Onshape Version Link on a Part

- `BuildField` constants (`src/server/utils/buildConstants.js:13-18`) are referenced only in `buildService.js`. The writes are at `:91` (createBuild, Build Number on the Build issue) and `:128` (cutVersion, Onshape Version Link on the Build issue). The reads are in `_parseBuilds` (`:314-317`).
- `partService.js`, `revisionService.js` (including the Re-create `extraFields` at `buildService.js:272-278`), `epicService.js`, the migration script and the client never write 10501 or 10502 on a Part.
- The technical plan's Sheet 02 lists Build Number as a Build field "assigned by ValorBOM at creation" and puts only Revision and Revises on Assembly/Part (`docs/v3/technical-plan.html:476-491`).
- Conclusion: Build Number, Onshape Version Link (and Instructions Data) appearing on the Part screen is a Phase 0 screen-config leftover. They were probably added to a screen shared by Part and Build. HANDOFF says screens were configured by hand in the admin UI.

## Verdicts

| Field / item | Verdict | Evidence |
|---|---|---|
| Revision (10500) | **Bug (low severity today).** The field is meant to be written. Blank is tolerated as "A" by convention, but that is wrong for any Part whose CAD letter isn't A, and it's inconsistent with Assembly create and Re-create. | `partService.js:340-358` has no 10500; `revisionService.js:18-25` treats blank as A; `revisionService.js:97` and `epicService.createEpic` do write it |
| Build Number (10501) | **Intended.** It's a Build field. Showing on the Part screen is **schema-cosmetic**. | `buildService.js:86-92`; editmeta HAR-2031 |
| Onshape Version Link (10502) | **Intended.** It's a Build field, written at Cut Version. Showing on the Part screen is **schema-cosmetic**. | `buildService.js:126-129`; editmeta HAR-2031 |
| No "Used In" link / no Build | **Flow skipped.** No Build exists for HAR-2030, and the save came from the Build-less /assembly page. The Designer would have blocked it. UX gap: /assembly gives no warning. | Zero Builds in HAR; `DesignerPartsTable.jsx:236`; `PartsListTable.jsx:96-124`; server log |

## Recommendations (not implemented)

1. **Write Revision on Part create.** In `PartService._buildJiraFields`, set `fields[RevisionField.REVISION]` from `payload.revision`, falling back to `applyPartMask(summary)?.version`, and finally `'A'`. Use the parsed letter rather than a hard-coded `'A'` so a CAD row at B gets B. This change covers both tables, `uploadSelected` and `clonePart`. Add a unit test in `__tests__/services/partService.test.js`. Optionally also send `revision` from both tables' `createStory` payloads. `updateStory` should leave the field alone; Re-create owns letter changes.
2. **Make the Build step unmissable.**
   - On /assembly, when the selected Assembly has no Builds, show a notice linking to `/designer` (or to the hub) before Save creates Parts with no Build. The alternative is to retire Save on that page for v3 Assemblies. Don't add Build logic to PartsListTable, which HANDOFF says to leave alone.
   - In the Designer, when `builds` is empty, make the empty state say "Create Build 1 first" next to the + New Build box. Auto-creating Build 1 is possible, but it is a Jira write the user didn't ask for, so I'd keep it explicit.
   - Separately, the Designer should surface or roll back the case where create succeeds and link fails (`DesignerPartsTable.jsx:150-167`).
3. **Jira admin (manual, no code):** remove Build Number, Onshape Version Link and Instructions Data from the Part issue type's screens. Keep Revision and Epic Link. First check that the Build screen still has all of them, because a write fails if the field isn't on the screen.
4. **Running `migrate-build-revision.mjs`** would backfill Build 1 for HAR-2030 and link its Epic-linked Parts. It is a production write, has not been run (HANDOFF gap 6), and is broader than this one ticket. Use the targeted repair below instead.

## What HAR-2031 should be repaired to (not modified)

- Revision (customfield_10500) = **A** (matches the `A` in `VF27P-0001A`).
- Build Number and Onshape Version Link stay **blank**. They belong on the Build.
- Epic Link HAR-2030, qty 1, PLA, 3D Printer: unchanged.
- After someone creates a Build under HAR-2030 (Designer, + New Build, e.g. "Test", which yields "Test Build 1" with Build Number 1), add the link **HAR-2031 "is used in" that Build**. One way: in the Designer select that Build, click Update from CAD, check the HAR-2031 row (it shows as existing but not in this Build), and Save (`DesignerPartsTable.jsx:197-200`). Another is to add the link directly in Jira.
- Cut Version on that Build later writes Onshape Version Link onto the **Build**, not onto HAR-2031.
