# Build BOM part numbers from Part number + Revision properties and the Assembly's season

The Designer's "Update from CAD" returned no parts because `BOMService._parseBOM` required the whole `V[RF]yyP-NNNN[A-Z]` string in the BOM's Part number cell. This team's BOM stores a bare `0001` in Part number and `A` in Revision, and leaves Project empty, so every row was silently dropped. The fix resolves the Name, Part number, Revision and Project columns by header `propertyId` first and by header name second. It then composes `{Project | V{seasonType}{year}}P-{NNNN}{Rev}`, taking the season from the Assembly's Jira summary, which `PartService.previewParts` now fetches. Legacy BOMs that put the full number in Part number or Name still parse. Rows that cannot be identified come back as `unidentified`, each with a list of problems, and the Designer shows them in a new warning. The live read-only dry run against HAR-2030 (HAR-2029 now returns 404) produced `VF27P-0001A Test Part`, where the same BOM previously returned an empty list.

Watch for: nothing blocking. Two minor follow-ups. The old `/assembly` page receives `unidentified` but does not render it (likely). Preview now depends on a Jira `getIssue` that runs before the BOM fetch (confirmed).

**Verdict**: APPROVED

## High-level view

Identification happens in `BOMService._identifyRow`, which tries three paths in order. A 4-digit Part number gets a composed full number. Otherwise a full number in the Part number cell is used, and failing that, a full number in Name. A row-level Project overrides the Assembly season and must match `V[RF]\d{2}`. Revision must be a single letter. These are the same property IDs `epicService` uses, so Assemblies and Parts are now identified the same way.

The season comes from the server, not the client. `PartService._getAssemblySeason` reads the Assembly's summary and parses it with `applyPartMask ?? applyTitleMask`, as `_parseEpics` does. That GET is chained ahead of the BOM fetch, inside the same `Promise.all` as the stories search, so preview costs one more Jira read and one more point of failure.

`getBOM` keeps returning a bare array, so `GET /api/bom` and the old `/assembly` page's response contract do not change. `getBOMReport` returns `{ parts, unidentified }`, and only `previewParts` uses it. The routes did not change. The old `PartsListTable` gets the extra `unidentified` field and ignores it, so that page still drops bad rows silently. Leaving that page unchanged was the requirement, so this is acceptable.

Unidentified rows include the item path, the raw property values and messages that name the property, such as "missing Revision", "invalid Project "FOO"" and "missing Project (the part has none and the Assembly has no season prefix)". `UnidentifiedPartsWarning` renders them in a `role="status"` region, and the empty-table text points to that list.

Evidence: 32 suites and 472 tests pass, up from 31 and 457 (`bomService.test.js` is new). The vite build is clean, with no warnings. The dry-run script lives in `/tmp/har2029-check/`, makes only GET calls, and replaces Jira's write methods with versions that throw. `.env` was last modified Oct 28, before this work. No secrets appear in findings.md or verification.md. HEAD is still `d35d74c`, matching `origin/feature/assembly-build-part`. The earlier uncommitted files (epicService.js, onshapeClient.js, AssemblySelection.jsx, epicService.test.js, epicRoutes.test.js) are still modified.

<details>
<summary>Issues (3)</summary>

1. **Old /assembly page stays silent** (likely, non-blocking): `PartsListTable.jsx` ignores `preview.unidentified`. If that page is still in use, render `UnidentifiedPartsWarning` there in a follow-up.
2. **Preview now hard-depends on the Assembly getIssue** (confirmed, non-blocking): if `jiraClient.getIssue` fails, the whole preview fails, even for a legacy BOM that needs no season. One option is to catch the error and fall back to a `null` season.
3. **COTS/hardware rows now appear as unidentified** (possible, non-blocking): BOM rows without a Part number, which the parser used to drop silently on purpose, now appear in the warning as "missing Part number". This matches requirement (2). If the list gets noisy, honor `excludeFromBom`.

</details>

<details>
<summary>Details</summary>

### Identification order and its edge cases

```
item ──► partNumber ~ /^\d{4}$/ ? ──yes──► prefix = row Project || V{season}{yy}
                │                          validate Project / Revision
                │                          applyPartMask(`${prefix}P-${pn}${rev} ${name}`)
                no
                ▼
         applyPartMask(partNumber)  ──match──► legacy full number in Part number cell
                ▼ no
         applyPartMask(name)        ──match──► legacy full number in Name (name = mask remainder)
                ▼ no
         unidentified { problems: ["missing Part number" | "invalid Part number …"] }
```

`PART_REGEX` has no end anchor, so the composed string always matches once Project and Revision pass validation, even when the name is empty. The `{ problems: [] }` return after a failed compose therefore cannot be reached. When a row has a 4-digit Part number and also a full number in its Name, the composed number wins.

### Assembly season lookup in previewParts

`_getAssemblySeason` chains `getIssue` → `getBOMReport` in one branch of the `Promise.all`, so the BOM fetch waits on the Jira read. Before this change, a failed `getIssue` affected nothing. Now it rejects the preview, including for Assemblies whose BOMs use the legacy full-number form and need no season (issue 2). The season is also not checked against a row's own Project, so a row tagged `VR26` inside a `VF27` Assembly gets the `VR26` prefix without a warning. The findings asked for exactly this override.

### Test coverage

`bomService.test.js` covers composing from properties, row Project overriding the season, propertyId-first resolution with a header-name fallback, quantity aggregation across rows that compose to the same number, skipping nested rows, the legacy Part number cell and Name fallbacks, the required-columns error, the problem messages for unidentifiable rows, and the return shapes of `getBOM` and `getBOMReport`. `partService.test.js` covers passing the season through, a null season when the summary has no prefix, and passing `unidentified` through.

Not tested: `previewParts` when `getIssue` rejects. The `UnidentifiedPartsWarning` component and the empty-state text in `DesignerPartsTable` have no client tests. The repo has no React test harness, so this matches existing practice.

</details>

<details>
<summary>File map</summary>

- `src/server/services/bomService.js`: `BOM_PROPERTY` id/name table, `resolveItemKey`/`readValue`, `_identifyRow`, `_parseBOM` returns `{ parts, unidentified }`, new `getBOMReport`, and `getBOM` is now a wrapper over it.
- `src/server/services/partService.js`: `_getAssemblySeason`; `previewParts` calls `getBOMReport` and returns `unidentified`.
- `src/client/src/components/DesignerPartsTable.jsx`: `unidentified` state, the warning, and the empty-state text.
- `src/client/src/components/parts/UnidentifiedPartsWarning.jsx` (new): Alert plus a list of rows and their problems.
- `__tests__/services/bomService.test.js` (new), `__tests__/services/partService.test.js`: the tests above.

Full diff: `git -C /Volumes/workplace/6800/bom-uploader diff` plus the two untracked files.

</details>
