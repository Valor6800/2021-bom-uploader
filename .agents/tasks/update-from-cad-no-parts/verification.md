# Verification: "Update from CAD" no parts found (HAR-2029 / HAR-2030)

This was the first iteration. There was no `review.json`.

## Root cause

`BOMService._parseBOM` ran `applyPartMask(item.partNumber)` and silently skipped any row that did not match. This team's BOM rows hold a bare `"0001"` in Part number and `"A"` in Revision, and Project is empty, so every row was dropped and the Designer showed "No parts found".

## Fix

- `src/server/services/bomService.js`
  - Added `BOM_PROPERTY` (Name, Part number, Revision, Project). Columns are matched by header `propertyId` first, then by header name, and item values are read by the matched header's `propertyName`.
  - Added `_identifyRow`, which tries three ways in order:
    1. Part number is 4 digits: build `{Project}P-{PartNumber}{Revision} {Name}`. Project comes from the row's own Project property, or from the Assembly's season (`V{seasonType}{year}`) when the row's Project is empty.
    2. Legacy: the Part number cell holds the full `VR26P-1234A`.
    3. Legacy: the Name holds the full number.
  - Rows that cannot be identified are returned in `unidentified` as `{ item, name, partNumber, revision, project, quantity, problems[] }`. `problems` uses messages such as "missing Revision", "invalid Project \"FOO\" ...", "missing Project (the part has none and the Assembly has no season prefix)", or "missing Part number". Nested rows (item path containing ".") are still skipped, and that check now runs first.
  - `_parseBOM(results, epicKey, assembly)` now returns `{ parts, unidentified }`. The new `getBOMReport(...)` returns both lists. `getBOM(...)` still returns only the parts array, so `GET /api/bom` keeps its response shape.
- `src/server/services/partService.js`
  - `previewParts` reads the Assembly's Jira summary (`getIssue(epicKey, { fields: ['summary'] })`) and parses its season with `applyPartMask ?? applyTitleMask`, the same way as `EpicService._parseEpics`. This read runs in parallel with the existing stories search. The season is passed to `getBOMReport`, and the response now also includes `unidentified`.
- `src/client/src/components/parts/UnidentifiedPartsWarning.jsx` (new)
  - Shows a warning Alert and a labelled `<ul>` inside a `role="status"` container. Each list item names the part and its problems.
- `src/client/src/components/DesignerPartsTable.jsx`
  - Stores `preview.unidentified` and renders the warning below the duplicate warning. When no rows loaded but some were unidentified, the empty-table text says "No parts could be identified from the BOM. See the rows listed above."
- Tests:
  - `__tests__/services/bomService.test.js` (new) covers property-based identification, row Project overriding the Assembly season, propertyId-first and header-name fallback, quantity aggregation, nested rows, legacy full Part number, legacy Name fallback, the required-columns error, unidentifiable rows with their reasons, and the `getBOM`/`getBOMReport` return shapes.
  - `__tests__/services/partService.test.js` adds `previewParts` tests: the season is parsed from the Jira summary, the season is null when the summary has no prefix, and `unidentified` is returned.

Not changed: `PartsListTable.jsx` (the old `/assembly` page) and `partRoutes.js`. The route passes the preview JSON through unchanged, so the new `unidentified` field reaches the client without route changes.

## Results

- `NODE_OPTIONS=--experimental-vm-modules npx jest`: **Test Suites: 32 passed, 32 total. Tests: 472 passed, 472 total.** The baseline was 31 suites and 457 tests; the new suite is bomService.test.js.
- `npx vite build --config src/client/vite.config.js`: exit 0, 132 modules transformed, `✓ built in 731ms`, no warnings.

## Live dry run (read-only)

The script is `/tmp/har2029-check/verify-fix.mjs`, outside the repo. It calls the fixed `PartService.previewParts` with the real `JiraClient`, `OnshapeClient` and `BOMService`. It only performs a Jira getIssue, a Jira search and an OnShape BOM GET. The script stubs Jira write methods so they throw, and it prints no credentials.

- `HAR-2029`: Jira returns 404 "Issue Does Not Exist". This matches findings.md: the issue was deleted and recreated as HAR-2030, which points at the same OnShape element.
- `HAR-2030` (`VF27A-0000A Test Assembly`):
  ```
  Assembly season: {"seasonType":"F","year":"27"}
  newParts: [{ "fullPartNumber": "VF27P-0001A", "name": "Test Part", "quantity": 1, "material": "PLA", "machinery": "3D Printer" }]
  existingParts: []
  duplicates: []
  unidentified: []
  ```
  Before the fix the same BOM returned `[]`.
- Unidentified rows on the real BOM response (`bom-app-call.json`):
  - With no Assembly season: `unidentified: [{ item "1", name "Test Part", partNumber "0001", revision "A", project "", quantity 1, problems ["missing Project (the part has none and the Assembly has no season prefix)"] }]`
  - With Revision blanked: `problems ["missing Revision"]`

Outputs are saved in `/tmp/har2029-check/run-fix-HAR-2029.txt`, `run-fix-HAR-2030.txt` and `run-fix-unidentified.txt`.

## Git status

`git status` still shows the earlier uncommitted files as modified: `__tests__/routes/epicRoutes.test.js`, `__tests__/services/epicService.test.js`, `src/client/src/components/AssemblySelection.jsx`, `src/server/clients/onshapeClient.js` and `src/server/services/epicService.js`.

This change adds the following to the modified list: `__tests__/services/partService.test.js`, `src/client/src/components/DesignerPartsTable.jsx`, `src/server/services/bomService.js` and `src/server/services/partService.js`. It also adds two untracked files: `__tests__/services/bomService.test.js` and `src/client/src/components/parts/UnidentifiedPartsWarning.jsx`.

Nothing was committed, stashed or reverted, and `.env` was not touched.
