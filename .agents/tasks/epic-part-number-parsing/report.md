# HAR-2027: why the Assembly's part number was not parsed

## Summary

**Confirmed.** Creating an epic from an OnShape URL never reads OnShape properties. `EpicService.generateEpicFromURL` takes the **element (tab) name** ("Test Assembly") and uses it as both the summary and the Epic Name. No code in the repo GETs OnShape metadata. So HAR-2027 was created as `summary = "Test Assembly"`, `Epic Name = "Test Assembly"`, `Revision = null`.

The Assembly dropdown only lists epics whose Epic Name matches `V{R|F}{yy}*` and whose summary parses with the `V[RF]\d{2}[AP]-\d{4}` mask. "Test Assembly" fails both checks, so HAR-2027 is filtered out twice (by JQL on the server, then by the mask in `_parseEpics`).

What OnShape actually holds for this element (live read):
- Element-level native properties: **Part number = `"0000"`**, **Revision = `"A"`**.
- Element name: `"Test Assembly"`. Document name: `"VF27A-0000 Test BOM Uploader"`.

The native Part number holds only the bare 4-digit number, as `technical-plan.html` sheet 03 describes ("Part number 0000, Revision A"). The season/type prefix `VF27A` is not in any element property. It appears only in the document name, or it can come from the Architecture/Year the user picked in the UI. A fix therefore has to build the full number from more than one source (see Recommendations).

## Evidence

### 1. Epic creation code path

- Client: `src/client/src/components/AssemblySelection.jsx` `handleCreateFromURL` → `createEpicFromURL(url)` in `src/client/src/api/client.js`. It sends only `{ url }`. The selected `seasonType`/`year` are **not** sent.
- Route: `src/server/routes/epicRoutes.js` `POST /from-url` → `epicService.generateEpicFromURL(url)`.
- Service: `src/server/services/epicService.js`:
  - `generateEpicFromURL` parses d/w/e out of the URL with `ONSHAPE_URL_REGEX`. It then calls `onshapeClient.getElements(documentId, workspaceId, 'ASSEMBLY')` and sets `summary = assembly?.name ?? \`Assembly ${elementId}\``.
  - `createEpic` writes `summary`, `issuetype: {name: 'Assembly'}`, `customfield_10104` (Epic Name) **= the same summary**, and `customfield_10300/10301/10302` = d/w/e. It does not set `customfield_10500` (Revision).
- `src/server/clients/onshapeClient.js` has no metadata **read** method. Its only metadata methods are the write-only `updatePartMetadata` and `updateElementMetadata` (POST `/api/metadata/...`), and nothing calls them. No code anywhere reads "Part number" or "Revision".

### 2. How the Assembly dropdown lists and parses epics

- Client: `AssemblySelection.loadEpics(seasonType, year)` → `GET /api/epics?seasonType&year` → keeps only entries with `e.isEpic`. The store defaults are `seasonType: 'R'`, `year: '26'` (`src/client/src/store/assemblySlice.js`).
- Server: `EpicService.getEpics` JQL (exact):
  ```
  project = ${PROJECT_KEY} AND issuetype = Assembly AND "Epic Name" ~ "V${seasonType}${year}*" AND status not in (Closed, Finished)
  ```
  `PROJECT_KEY` comes from `.env` (it is `HAR`). The season prefix comes from the Architecture and Year dropdowns. "VR26*" in HANDOFF is just the default R/26.
- `EpicService._parseEpics` tries `applyTitleMask(summary) ?? applyPartMask(summary)` (`src/server/utils/partMask.js`) and **drops** any issue that matches neither:
  - `TITLE_REGEX = /V([RF])(\d{2})([AP])-(\d{4})(.*)/`
  - `PART_REGEX  = /V([RF])(\d{2})([AP])-(\d{4})([A-Z])(.*)/`
  - `isEpic = partType === 'A'`.
- There is no client-side mask. All parsing happens on the server.

### 3. Live read-only check (GET only, via `/tmp/har2027-check.mjs` using the repo's `JiraClient`/`OnshapeClient`)

HAR-2027:

| Field | Value |
|---|---|
| summary | `Test Assembly` |
| issuetype (REST name) | `Epic` (displayed as Assembly; JQL `issuetype = Assembly` matches it) |
| status | `New` |
| reporter | `valorbot` (created by the app, 2026-10-29T18:53Z) |
| customfield_10104 Epic Name | `Test Assembly` |
| customfield_10500 Revision | `null` |
| customfield_10501 Build Number | `null` |
| customfield_10300 / 10301 / 10302 | `8c64dfdcb66184646a7a3f17` / `82f00d3cbea6901ac26040bd` / `faea62821490977c33bc8d7c` (correct) |
| description | `null` |

- `applyTitleMask("Test Assembly")` → `null`, and `applyPartMask` → `null`.
- The dropdown JQL with `"Epic Name" ~ "VR26*"` returned **0 issues** in HAR.
- The same JQL with the Epic Name clause swapped for `key = HAR-2027` returns HAR-2027. So the issue type and status filters pass, and only the Epic Name and mask checks exclude it.

OnShape:
- `GET /api/documents/d/{did}/w/{wid}/elements?elementType=ASSEMBLY` → one element, `{ id: faea62821490977c33bc8d7c, name: "Test Assembly" }`.
- `GET /api/documents/{did}` → name `"VF27A-0000 Test BOM Uploader"`.
- `GET /api/metadata/d/{did}/w/{wid}/e/{eid}` → top-level keys `jsonType, elementType, mimeType, elementId, properties, href`. `properties[]` entries have the shape `{ name, propertyId, value, valueType, editable, ... }`. Relevant entries:

| name | propertyId | value | valueType | editable |
|---|---|---|---|---|
| Name | `57f3fb8efa3416c06701d60d` | `Test Assembly` | STRING | true |
| Description | `57f3fb8efa3416c06701d60e` | null | STRING | true |
| **Part number** | `57f3fb8efa3416c06701d60f` | **`0000`** | STRING | true |
| **Revision** | `57f3fb8efa3416c06701d610` | **`A`** | STRING | true |
| State | `57f3fb8efa3416c06701d611` | `0` | ENUM | false |

  These are OnShape's standard built-in property IDs. Match on `propertyId` first and fall back to `name`. The full raw response is saved at `/tmp/har2027-element-metadata.json`, outside the repo.

## 4. Why HAR-2027 does not appear

1. **Epic Name is `"Test Assembly"`.** The server-side JQL `"Epic Name" ~ "V{R|F}{yy}*"` cannot match, whatever Architecture/Year is selected.
2. **The summary `"Test Assembly"` fails the mask.** Even if the JQL let it through, `_parseEpics` would drop it.
3. Separately, the document is a **Facility 2027** assembly (`VF27A-0000`). After a fix it will show only under Architecture = Facility, Year = 2027, not under the default Robot/2026.
4. Root cause: `generateEpicFromURL` uses the element's display name and ignores the native Part number and Revision properties. The season/type prefix is never supplied at all.

## 5. Recommendations (not implemented)

### Target naming (v3, technical-plan sheet 02)
Assembly summary `V{R|F}{yy}A-{NNNN}{Rev} {Name}`, e.g. `VR27A-1000A Intake`. The current `createEpic` sets Epic Name equal to the summary. Keeping that is required, because the dropdown JQL filters on the Epic Name prefix. Also set `customfield_10500` = revision letter. `RevisionService.createRevision` already writes that field as a plain string.

For this element: **`VF27A-0000A Test Assembly`**.

### Code changes
1. **`src/server/clients/onshapeClient.js`**: add `getElementMetadata(documentId, workspaceId, elementId)` → `this._get(\`/api/metadata/d/${documentId}/w/${workspaceId}/e/${elementId}\`)`. Optionally add a helper that returns `{ partNumber, revision, name }` from `properties[]`, matching by `propertyId` (`57f3fb8efa3416c06701d60f`, `...d610`, `...d60d`) with `name` as the fallback.
2. **`src/server/services/epicService.js` `generateEpicFromURL(url, { seasonType, year })`**:
   - Fetch the element metadata. Read `Part number`, `Revision`, and `Name`. The existing `getElements` call can be dropped because metadata includes Name.
   - Build the number with this precedence:
     1. If `Part number` already matches the full `V[RF]\d{2}A-\d{4}` form, use it as-is.
     2. If it is bare `\d{4}`, prefix it with `V{seasonType}{year}A-`. Take `seasonType`/`year` from the request. If the request omits them, take them from the document name when it matches `applyTitleMask` (here `VF27A-0000`, which gives F/27). Use `onshapeClient` GET `/api/documents/{did}` for that.
     3. If the request values and the document-name prefix disagree, or the Part number is empty or malformed, return 400 with a clear message. Do not silently create a non-conforming epic, which is exactly what produced HAR-2027.
   - Revision letter: the `Revision` property, uppercased and validated `^[A-Z]$`, defaulting to `A` (v3: "every Assembly starts at Revision A").
   - Name: the element `Name`, with any leading part-number token stripped.
   - Check for an existing epic first: call `getEpic(fullNumber)` or search by `cf[10302] = elementId`, so that a second paste of the same URL does not create a duplicate.
   - Pass `revision` into `createEpic`.
3. **`epicService.createEpic`**: accept `payload.revision` and write `RevisionField.REVISION` (`customfield_10500`) from `src/server/utils/buildConstants.js`.
4. **`src/server/routes/epicRoutes.js` `POST /from-url`**: accept and validate optional `seasonType` (`R`/`F`) and `year` (`\d{2}`) using the same `sanitizeJQL`/`badRequest` pattern as `GET /`.
5. **Client**: in `src/client/src/api/client.js`, add `seasonType, year` to `createEpicFromURL`. In `AssemblySelection.jsx` `handleCreateFromURL`, pass the selected values. After creation, consider showing the created summary, or warning if the epic falls outside the currently selected Architecture/Year.
6. **`src/server/utils/partMask.js`**: `applyTitleMask` runs first in `_parseEpics` and has no revision group. For `"VF27A-0000A Test Assembly"` it would yield `name = "A Test Assembly"` (with `fullPartNumber = "VF27A-0000A"`). Add an optional revision group, e.g. `/^V([RF])(\d{2})([AP])-(\d{4})([A-Z])?\s*(.*)$/`, and expose `revision`. Without this, v3-conforming Assembly names display a stray "A" in the parsed name.
7. **Tests**: update `__tests__/services/epicService.test.js` and `__tests__/routes/epicRoutes.test.js` for the metadata path. Cover a bare Part number plus request season, a full Part number, a prefix taken from the document name, a missing Part number (400), and the Revision written to `customfield_10500`. Add a `partMask` test for the revision group. Run with `NODE_OPTIONS=--experimental-vm-modules npx jest`.

Later (Phase 4): when an epic is created with a number that ValorBOM decided, mirror the bare number and letter back with `updateElementMetadata` using the property IDs above. Sheet 03 says this mirror is one-way, from Jira to OnShape. Reading on creation and writing on save do not conflict, because OnShape is only read for the initial identity.

### Repairing HAR-2027 (do not apply without the user's go-ahead; it writes to the live tracker)
Set via `PUT /rest/api/2/issue/HAR-2027`:
- `summary`: `VF27A-0000A Test Assembly`
- `customfield_10104` (Epic Name): `VF27A-0000A Test Assembly`
- `customfield_10500` (Revision): `A` (if the field is on the Epic edit screen in HAR)
- Leave `customfield_10300/10301/10302` unchanged; they are correct.

It will then appear under **Facility / 2027** in the dropdown. With today's mask its parsed name will show as "A Test Assembly" until fix 6 lands. Writing `VF27A-0000 Test Assembly` (no letter) would parse cleanly today but does not follow the v3 convention.
