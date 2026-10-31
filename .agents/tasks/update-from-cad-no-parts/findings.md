# "Update from CAD" returns no parts for the HAR-2029 Assembly

## Summary

**Root cause:** `BOMService._parseBOM` (`src/server/services/bomService.js:127`) runs `applyPartMask(item.partNumber)` and silently `continue`s on `null`. The mask expects the full `V[RF]yyP-NNNN[A-Z]` number in the BOM's Part number cell. This team stores only the bare 4-digit number there (`"0001"`), puts the letter in a separate Revision cell (`"A"`), and leaves Project empty on the part. Every row is dropped. The parser returns `[]` with no error, so the Designer shows its "No parts found" empty state.

The BOM request itself is correct. It uses the right document, workspace and element, returns HTTP 200, and contains the part.

**Important: HAR-2029 no longer exists.** Jira returns 404 "Issue Does Not Exist" for HAR-2027, HAR-2028 and HAR-2029. The only Assembly for this OnShape element is now **HAR-2030** "VF27A-0000A Test Assembly", created 2026-10-29T20:15Z by valorbot, with the same doc/workspace/element IDs. Presumably the user deleted the earlier ones and recreated it. The live check below ran against HAR-2030. The /tmp script takes the issue key as an argument.

## Live-check script (READ-ONLY, GET only)

- Script: **`/tmp/har2029-check/check.mjs`**. Usage: `node /tmp/har2029-check/check.mjs HAR-2030` (the default key HAR-2029 now 404s).
- It loads `.env` with dotenv (`path` option) and imports the repo's `JiraClient`, `OnshapeClient`, `BOMService` and `partMask`. It prints no credentials.
- It writes raw BOM responses to `/tmp/har2029-check/bom-app-call.json`, `bom-indented_false.json`, and `bom-indented_false_multiLevel_false.json`. The last run's output is in `/tmp/har2029-check/run-HAR-2030.txt`.
- Note for reuse: the summary helpers in the script assume the modern `headers`/`rows` shape and print empty sections. The real data is under `bomTable` (see below). The `_parseBOM` call at the end is the meaningful part.

## 1. Code path, client to server

1. `src/client/src/components/DesignerPartsTable.jsx` `handleUpdateFromCAD` (line 92) calls `previewParts({ epicKey, documentId, workspaceId, elementId })` from `selectedEpic`. The older `/assembly` page uses the same call in `PartsListTable.jsx` `handleUpdateFromCAD` (line 54).
2. `src/client/src/api/client.js:236` `previewParts` sends `POST /api/parts/preview`.
3. `src/server/routes/partRoutes.js:118` validates the 4 params and calls `partService.previewParts`.
4. `src/server/services/partService.js:177` `previewParts` runs these in parallel:
   - `bomService.getBOM(epicKey, d, w, e)` (line 181)
   - `getStoriesByEpic(epicKey)` (line 29): JQL `project = HAR AND issuetype = Part AND "Epic Link" = KEY`, then `_parseStories` (line 345), which also drops any summary that fails `applyPartMask`.
   - Then `bomService.compareBOMWithJira` and `detectDuplicates`, returning `{ newParts, existingParts, duplicates }`.
5. `src/server/services/bomService.js:29` `getBOM` keeps a 1-minute cache and calls `onshapeClient.getAssemblyBOM(d, w, e, { multiLevel: true })` (`onshapeClient.js:114`: `GET /api/assemblies/d/{d}/w/{w}/e/{e}/bom?multiLevel=true`). It then calls `_parseBOM`.
6. `bomService.js:110` `_parseBOM`:
   - Checks that `bomTable.headers[].propertyName` includes `quantity`, `partNumber`, `material` and `name`. This passes.
   - For each `bomTable.items[]`: `parsed = applyPartMask(item.partNumber); if (!parsed) continue;` at **line 127. Every row is dropped here.**
   - It skips nested rows where `item.item` contains `.` (line 131), and builds `{ ...parsed, quantity, name: item.name, material/machinery mapping, epic }`.
7. Client: when `newParts` and `existingParts` are both empty, `rows` is `[]` and the table renders "No parts found. Click "Update from CAD" to load the BOM." (`DesignerPartsTable.jsx:290`). Any thrown error is also swallowed by `console.error` (line 131), so a failure would look the same. In this case there was no error: the result was a genuine empty list.

## 2. Live response shape (`GET .../bom?multiLevel=true`, HTTP 200)

HAR-2030 (Jira):

| Field | Value |
|---|---|
| summary / Epic Name (10104) | `VF27A-0000A Test Assembly` |
| issuetype | Epic (shown as Assembly), status New |
| Revision (10500) | `A` |
| 10300 / 10301 / 10302 | `8c64dfdcb66184646a7a3f17` / `82f00d3cbea6901ac26040bd` / `faea62821490977c33bc8d7c` (correct, same as the URL) |
| Parts with Epic Link = HAR-2030 | 0 |

The Assembly parses as seasonType `F`, year `27`. `_parseEpics` applies the part mask first, which gives name "Test Assembly" and version "A".

OnShape BOM: the top level is `{ bomTable }`, the **legacy format** (`formatVersion` present), not the newer `headers` + `rows[].headerIdToValue` format. `bomTable` keys are `formatVersion, id, name, type, createdAt, templateId, bomSource, headers, items`. The `indented=false` and `multiLevel=false` variants return the same single item.

- **Headers:** `{ propertyName, name, propertyId, visible }`. Item values are keyed by **`propertyName`** directly on each item object.

| Column | propertyName | propertyId | visible |
|---|---|---|---|
| Item | `item` | 5ace8269c046ad612c65a0ba | yes |
| Quantity | `quantity` | 5ace84d3c046ad611c65a0dd | yes |
| Part number | `partNumber` | 57f3fb8efa3416c06701d60f | yes |
| Description | `description` | 57f3fb8efa3416c06701d60e | yes |
| Name | `name` | 57f3fb8efa3416c06701d60d | yes |
| Material | `material` | 57f3fb8efa3416c06701d615 | yes |
| Revision | `revision` | 57f3fb8efa3416c06701d610 | yes |
| Project | `project` | 57f3fb8efa3416c06701d613 | no (hidden, but value still present on items) |

  (Also present and hidden: appearance, state, vendor, productLine, title1-3, notRevisionManaged, excludeFromBom, category, bomBehavior, plus id-keyed Unit of measure/Mass/Tessellation.)
- **The one item (sample, trimmed):**
  ```json
  { "item": "1", "quantity": 1, "partNumber": "0001", "revision": "A",
    "name": "Test Part", "project": "", "description": "", "state": "In progress",
    "excludeFromBom": false,
    "material": { "id": "PLA", "displayName": "PLA", "libraryName": "Onshape Material Library", "properties": [...] },
    "itemSource": { "documentId": "8c64dfdcb66184646a7a3f17", "wvmType": "w", "wvmId": "82f00d3cbea6901ac26040bd",
                    "elementId": "dee530f014572997b748614a", "partId": "JHD", "indentLevel": 0, ... } }
  ```
  `quantity` is a number. `material` is an object, and the parser already reads `.displayName`. Revision and Project are separate cells, and Project is empty on this part.

## 3. Why the app's logic yields zero parts (run against the real data)

- `new BOMService({ onshapeClient })._parseBOM(realResponse, 'HAR-2030')` returns **`[]`**. It does not throw, so the required columns are present.
- `applyPartMask("0001")` returns `null`, so the row is skipped at `bomService.js:127`.
- `applyPartMask("Test Part")` (the name) also returns `null`. Name-based parsing would not help either.
- `applyPartMask("VF27P-0001A Test Part")` gives `{ seasonType F, year 27, partNumber 0001, version A, fullPartNumber "VF27P-0001A", name "Test Part" }`. The data is all there. It is split across Part number, Revision, and the Assembly's season.

The hypothesis is mostly right, with one correction. The filter is applied to the BOM's **Part number** cell (`item.partNumber`), not the name. It fails because that cell holds only the bare 4 digits. The legacy convention the parser was written for had the whole `VR26P-1234A` string typed into Part number.

## 4. Ruled out

- **Wrong doc/workspace/element:** HAR-2030's 10300/10301/10302 match the URL. The BOM call returns 200 and contains the expected part.
- **BOM call failing silently:** no exception was thrown, and the required-column check passes. (Failures *would* be invisible in the UI because of `console.error`, but that is not what happened here.)
- **Season filter (R/26 default vs F/27):** this affects only the Assembly dropdown, which already works (the Assembly shows under Facility/2027). `previewParts` takes no season input, and `getStoriesByEpic` filters by Epic Link only.
- **The mask requiring 'P':** irrelevant here, because the value never gets that far. The bare `"0001"` has no prefix at all. Once a number is composed, the correct type for a part row is `P`.
- **`multiLevel` / `indented` / nested-row filter:** the single row has `item: "1"` at indentLevel 0, and all three request variants return the same row.
- **Existing-story matching:** no Parts are linked to HAR-2030 yet, so `compareBOMWithJira` has nothing to match. Even so, `unmatched` would have contained the row if `_parseBOM` had kept it.

## 5. Recommended fix outline

Goal: build each row's full number the same way `epicService.generateEpicFromURL` builds the Assembly's, `{Project}P-{PartNumber}{Revision} {Name}`. Fall back to the Assembly's season when the part's Project is empty, as it is here. Keep the legacy full-number-in-Part-number form working.

1. **`src/server/services/bomService.js` `_parseBOM(results, epicKey, assembly)`**. Replace line 127 with a per-row resolver:
   - If `applyPartMask(item.partNumber)` matches (legacy full form), use it unchanged.
   - Else, if `item.partNumber` matches `^\d{4}$`:
     - prefix = `item.project` if it matches `^V[RF]\d{2}$`, else `V${assembly.seasonType}${assembly.year}`;
     - revision = `item.revision` uppercased if it matches `^[A-Z]$`, else `A`;
     - `parsed = applyPartMask(\`${prefix}P-${pn}${rev} ${item.name}\`)`.
   - Else skip the row, but **collect it as skipped** with `{ name, partNumber, reason }` instead of dropping it silently.
   - Let `name` come from `item.name` as today.
   - Optionally match by header `propertyId` (57f3fb8efa3416c06701d60f / ...d610 / ...d613) to find the `propertyName` key, for consistency with `readProperty` in `epicService.js`. In the live data the `propertyName` values are the stable `partNumber` / `revision` / `project`, so direct keys work.
   - Also consider honoring `item.excludeFromBom === true`.
2. **Where the Assembly's season comes from.** `getBOM` currently gets only `epicKey`. Choose one:
   - (a) `PartService.previewParts` fetches the epic with `jiraClient.getIssue(epicKey, { fields: ['summary'] })` and parses it with `applyPartMask ?? applyTitleMask`, as `EpicService._parseEpics` does. It then passes `{ seasonType, year }` to `getBOM`/`_parseBOM`. This is server-authoritative, at the cost of one extra GET.
   - (b) The client sends `selectedEpic.seasonType` and `selectedEpic.year`, which `_parseEpics` already provides, in the preview body. `partRoutes.js:118` validates them (`[RF]`, `\d{2}`).
   - I prefer (a). It is less trust in the client and needs no client change. (b) works too. The cache key in `getBOM` does not need to change, because the cache stores the raw response.
3. **Make empty results explainable.** Return the skipped rows from `previewParts` (e.g. `skipped: [...]`). In `DesignerPartsTable.jsx` and `PartsListTable.jsx`, show an Alert when `newParts` and `existingParts` are empty but `skipped` is not, and surface caught errors instead of only calling `console.error`. This is a UI behavior change; confirm with the user if it goes beyond the minimal fix.
4. **Tests.** No test exists for `BOMService` or `previewParts`; nothing in `__tests__` references `_parseBOM`. Add `__tests__/services/bomService.test.js` with a fixture shaped like the real `bomTable` above (bare `"0001"` + revision `"A"` + empty project → `VF27P-0001A`, name "Test Part", quantity 1, material PLA). Also cover the legacy full Part number, a per-row Project override, a malformed or blank number (skipped and reported), and a nested `item` like `"1.1"`. Run `NODE_OPTIONS=--experimental-vm-modules npx jest`.
5. **Downstream check.** New rows become summary `"VF27P-0001A Test Part"` (`DesignerPartsTable.jsx` builds `${fullPartNumber} ${name}`). That passes `_parseStories`, so they will match on the next Update from CAD after saving.

Verify with `node /tmp/har2029-check/check.mjs HAR-2030` after the change. The `_parseBOM` call needs the new season argument, so update that line in the script.
