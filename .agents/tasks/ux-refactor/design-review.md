# Design review: ValorBOM UX refactor (design.md, draft 7)

Reviewer: design-review step, fresh context. Sources checked: `design.md` (draft 7, all sections and the revision log), the draft-6 review (`design-review.md`/`.json`: M1, N1, N2), `docs/v3/HANDOFF.md`, `src/server/services/buildService.js` (`cutVersion`, `getBuildsForAssemblies`, `_parseBuilds`), `src/server/services/revisionService.js` (`_getPreviousRevision`), `src/server/clients/jiraClient.js` (`getIssue`, `_retry`, `createIssueLink`), `src/server/routes/buildRoutes.js` (route order), and the probe files in `/tmp/ux-refactor-check/`.

Note on the step prompt: it describes the prior review as "M1-M5 MEDIUM, N1-N9 LOW". That was an earlier round. The prior review on disk is of draft 6 and raised M1, N1 and N2. Earlier rounds' findings (including the key-list 400, Revision-chain scoping, the Playwright route predicate and the HAR-2031 Build fields) were confirmed resolved by the draft-4 to draft-6 reviews, and I re-checked that draft 7 doesn't regress them.

**Verdict: CHANGES_REQUESTED** (0 HIGH, 1 MEDIUM, 2 NIT).

## Prior findings: resolution check

| Prior (draft-6 review) | Resolved? | Notes |
|---|---|---|
| M1 Two-Active repair is a one-click irreversible Supersede, offered for any Build, from lagging search data | Yes on the Designer; see new M1 for the Assembly page | 3.4 now has four steps. The warning shows only after `GET /api/builds/status` (6.10) confirms two Active Builds by key. A failed check shows a `role="status"` line, no button. `repairCandidates` offers only "Finish cutting Build N" when `cutFailedKey` is known, otherwise only Builds whose link contains `/documents/<documentId>/v/`, which matches the server's `storedLinkMatches`, and no button when none qualify. Every button opens a confirm `Dialog` with focus on Cancel. The repair 409 has its own copy. Tests are in 6.10, `buildNames.test.js` and five Playwright shots with interaction assertions. |
| N1 Re-create `Revises` guard depends on the link side | Yes | 6.9 step 3 accepts either side and counts an entry only when the linked issue's summary parses to the same number with a later letter. Tests cover both sides, the earlier-letter case and a different number. |
| N2 Sibling-key search failure not tagged `supersede` | Yes | One `try/catch` around `_supersedeActiveSiblings` tags every failure, the search included. Tests cover the normal path and the resume path. |

Earlier-round items, re-checked in draft 7:

- **M1/M2/M5 (search lag, Revision-chain scoping).** 6.4 step 2 still falls back to per-key `getIssue` on a 400 from `key in (...)`. 6.8 still derives the chain on the server and checks `issuetype` before sending `"Epic Link" in (...)`. `linkedThisSession`, `createdParts`, `mergeBuilds`, `statusThisSession` and the new by-key status check together cover every lagging search the pages read.
- **M3 (Playwright route predicate).** Section 13 still uses `url.pathname.startsWith('/api/')` and the `/src/api/client.js` smoke check by page navigation.
- **M4 (HAR-2031 Build fields).** The B6 row still explains that 10501 to 10503 are Build fields, never written on a Part, with tests in INC-1, INC-3 and INC-4.

**HANDOFF Jira Data Center constraints**, checked against the draft-7 additions:

- **Epic Link only accepts literal Epics.** Unchanged. Parts and Builds point at Assembly or Revision tickets, both of the Epic type. 6.10 reads `customfield_10110` and writes nothing.
- **`linkedIssues()` ignores direction.** Every direction-sensitive check reads `issuelinks` and now accepts either side (`Used In` in 6.4 step 5, `Revises` in 6.9 step 3).
- **`cf[NNNNN]` in JQL, `customfield_NNNNN` in REST.** 6.10 uses only `getIssue` with `customfield_*` field lists and no JQL. JQL elsewhere uses `cf[10302] ~` and `"Epic Link" in (...)`.
- **Fields must be on the issue type's screen.** Draft 7 adds no writes. The existing writes are on the create screens per `createmeta-output.txt` and `createmeta-epic-output.txt`.

The onboarding create-Build flow (6.6 step 4, 3.3 A, B, E and "B from the commit call") is complete and testable. B1 to B6 each have a concrete fix, an owning layer and named tests. INC-1 to INC-6, INC-8 and INC-9 have concrete scope, files, tests and screenshots. INC-7 has one gap (M1 below).

## Findings

### MEDIUM

**M1. The two-Active warning and repair are specified for "both pages", but INC-7 (the Assembly page) doesn't include them and has no test for them.** (3.4 "Two Active Builds (repair path)", section 9 "A Cut Version that fails partway", section 12 INC-7)

- 3.4 says "Both pages then handle the warning in four steps". Section 9 says "Until then both pages show the 'both Active' warning … so the state is visible and fixable from either page."
- Cut Version is also on the Assembly page (3.5, ⋯ disclosure), so a `cutStage: 'supersede'` failure can happen there too.
- INC-7's scope lists tabs, BOM, Move, Re-create, Save, Clone, the ⋯ disclosure, Compare, Print and the empty state. It does not mention the two-Active warning, the `statusThisSession` overlay, `cutFailedKey`, `fetchBuildStatuses`, the repair confirm, or the `cutStage` copy in `CutVersionDialog`. 3.5 doesn't mention them either. INC-7 has no screenshot or interaction check for any Cut Version state.
- An implementer who follows INC-7 can ship the Assembly page without the repair path. Section 9's "fixable from either page" would then be false, and nothing in the plan would catch it.
- Fix:
  1. Add to INC-7's scope: "Cut Version handling shared with the Designer: `statusThisSession` with `overlayBuildStatus`, `cutFailedKey`, the `cutStage` copy in `CutVersionDialog`, and the two-Active warning (by-key check through `fetchBuildStatuses`, `repairCandidates`, repair confirm `Dialog`), at the top of the Build panel (3.4)." State whether the warning is a shared component (for example `builds/TwoActiveWarning`) so both pages use the same code.
  2. Add a line in 3.5 pointing to the 3.4 repair path, with its placement on the Assembly page (above the tab panel).
  3. Add INC-7 screenshots: `assembly-two-active-builds.png` (same fixture as the Designer shot; assert one button) and `assembly-cut-version-already-cut.png` (409 with `buildStatus: 'Superseded'`; assert the tab chip reads "Superseded", never "409"). Add the interaction check that the Assembly page's cut-version body is `{ assemblyKey }` only.

### NIT

**N1. Section 9 says the "Finish cutting" button appears "in the tab where the cut failed", but `cutFailedKey` is page state and is lost on a mode switch.** (3.4 step 3, section 9)

- `cutFailedKey` lives in the page's local state ("cleared when the Revision changes or the repair succeeds"). The Designer and Assembly pages are separate route components with local state (3.4 "Designer behaviour"), so switching mode in the same tab unmounts the page and drops it.
- After the switch, the other page shows "Make Build N the Active one" for every conflicting Build with this document's link, including the older one. The confirm dialog still protects the student, so this is safe, but the section 9 sentence is inaccurate.
- Fix: either keep `cutFailedKey` in `sessionStorage` under `valorbom.cutFailed.<revisionKey>` (read on mount, removed on repair success or when the by-key check finds no conflict), or change section 9 to "on the page where the cut failed". Pick one and add the matching `buildNames.test.js` or Playwright assertion.

**N2. A key in `missing` becomes the overlay status `'Missing'`, which the Build picker and tabs would render as a Badge with no defined style, and `dropAgreedStatus` never drops it.** (3.4 step 2, 7.1)

- `overlayBuildStatus` returns copies of Builds with the overlaid fields, and both pages render Build status chips from the overlaid list. `Badge` defines Draft, Active, Superseded and Archived only (4.3).
- A fetched Build never reports `'Missing'`, so the entry stays until the page reloads.
- Fix: keep `missing` keys in a separate `Set` that `activeConflict` excludes, and don't write them into `statusThisSession`. Or state that the picker and tabs hide a Build whose overlaid status is `'Missing'` (it was deleted or retyped in the tracker) and add a `buildNames.test.js` case for it.

## Verified assumptions

- `jiraClient.getIssue(key, { fields })` passes `fields` through, and `_retry` throws a 4xx immediately as a wrapped `JiraApiError` carrying the status (`jiraClient.js:198-206`, `275-304`). 6.10's "404 goes to `missing`, other errors are fatal" can be implemented on `err.status`.
- `buildRoutes.js` has no `GET /:key` route. The GET routes are `/`, `/for-part/:partKey` and `/:key/parts` (`buildRoutes.js:31-78`). Registering `GET /status` right after `GET /` is therefore safe, and the design's route-order test is a cheap guard.
- `_parseBuilds` returns `key`, `assemblyKey`, `buildNumber`, `onshapeVersionLink` and `status` (`buildService.js:310-320`). The client has every field that `activeConflict`, `repairCandidates` and `visibleBuilds` read.
- Today's `cutVersion` writes 10502, runs transition 11, then supersedes siblings using **search** statuses from `getBuildsForAssemblies([assemblyKey])` (`buildService.js:126-139`). The by-key sibling read and the single `try/catch` in the design's new `_supersedeActiveSiblings` are therefore real changes, correctly scoped to the Revision ticket's Builds.
- `createIssueLink(type, inwardKey, outwardKey)` posts `inwardIssue`/`outwardIssue` (`jiraClient.js:256-263`). `_getPreviousRevision` reads `inwardIssue` on the newer ticket's `Revises` entry (`revisionService.js:115-127`). The draft-7 guard no longer depends on which side Jira reports.
- `validateIssueKey`'s `KEY_RE` (`/^[A-Z][A-Z0-9_]*-\d{1,7}$/`) rejects lower-case keys, which matches 6.10's "lower-case key gives 400" test.
- The probe scripts and outputs the facts table cites exist in `/tmp/ux-refactor-check/` (`search`, `createmeta`, `createmeta-epic`).

## Unverified or wrong assumptions

- **Unverified, safe:** that Jira DC includes `fields.summary` in an `issuelinks` entry's nested `inwardIssue`/`outwardIssue`. This is standard Jira REST behaviour, but no live read was made, since no `Revises` links exist in HAR. The design handles a missing summary by falling through to the `recentlyRecreated` and number guards (6.9 step 3), so a wrong assumption costs only the first guard.
- **Wrong in effect (N1):** that `cutFailedKey` survives for the whole tab. It survives only while the same page is mounted.
- **Unverified (existing, not introduced here):** that `summary ~ "V{R|F}{yy}P-*"` in `getNextPartNumber` matches every season Part. The probes covered `VF27*` and full numbers, not `P-*`. The allocation floor in `createStory` limits the impact within one process.
