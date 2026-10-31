# ValorBOM live write check: final report

Branch `feature/assembly-build-part`. First run 2026-10-31 15:15–15:25 UTC on `9b428c4`. Re-run 16:09–16:15 UTC on the uncommitted fixes, which are now committed (below). Supporting notes in this folder: `findings.md`, `fix-verification.md`, `review.md`, `write-log.md`.

The API server is still running on `127.0.0.1:6803` (PID 11633, plain `node src/server/index.js`, log `/tmp/valorbom-api.log`). Vite on 5173 was not touched.

## Step results

| Step | First run | Final | Notes |
|---|---|---|---|
| a. Link HAR-2031 into Build 1 via save, then repeat | FAIL (link reversed) | **PASS** | Repeat makes no duplicate. New links are created Build → Part (proved by link 16607 in step e). The old link 16601 is still reversed (see "Left for you"). |
| b. Quantity 1 → 2 → 1 via save | PASS | **PASS** | Not re-run; no code on this path changed except error wording. |
| c. Cut Version on Build 1, then retry | FAIL | **BLOCKED (config)** | OnShape refuses `POST /versions` with 403 because the API key has no Write scope (F2). The error now reads "OnShape refused the change (403)." instead of a sign-in prompt (F3 fixed). No version made. |
| d. Create Build 2 (clone from Build 1) | PASS (link reversed) | **PASS** | HAR-2033, Build Number 2, Draft. Its clone link 16603 was made before the fix and is reversed. |
| e. Re-create HAR-2031 for Build 2 | BLOCKED (held for the fix) | **PASS** | HAR-2035 Revision B. Links read "HAR-2035 revises HAR-2031" and "HAR-2033 uses HAR-2035". Revision chain from HAR-2035 is `[HAR-2035, HAR-2031]`. |
| f. Cut Version on Build 2 (Build 1 → Superseded) | BLOCKED | **BLOCKED (F2)** | Needs an OnShape key with write scope. |
| g. Clone a Part from HAR-2031 | PASS (minor F6) | **PASS** | HAR-2034 VF27P-0002A. `fullPartNumber` fix is unit-tested; not re-run live (clone budget used). |
| h. Archive Build 1 (from Superseded) | BLOCKED | **BLOCKED** | Depends on f. |
| i. Read paths after writes | PASS | **PASS** | Builds list, parts per Build, for-part, by-keys, revision chain all correct after the re-run. |
| j. Onboard preview of the HAR-2030 link | PASS | **PASS** | `status: "exists"`, nothing created. |

Totals: 7 pass, 3 blocked on the OnShape key (c, f, h), 0 fail.

## Bugs, root causes and commits

| # | Bug | Root cause | Commit |
|---|---|---|---|
| F1 | Used In and Revises links read backwards in the tracker | Jira's `POST /rest/api/2/issueLink` shows the **outward** phrase on `inwardIssue`. `createIssueLink(type, inwardKey, outwardKey)` was called with the Part (or the previous revision) first, so links read "Part uses Build" and "previous revises new". `_getPreviousRevision` read `inwardIssue`, which only worked because creation was reversed. | `81d31c6` fix(jira): Create issue links in the stated direction |
| F4 (server) | Bugs in our own code (e.g. a TypeError) showed as "the team tracker didn't respond (no connection)"; Jira's reason for a 400 was thrown away | `wrapError` turned every error into `JiraApiError` with status 0 when there was no HTTP status, and kept only axios's generic message, not `response.data.errorMessages/errors`. | `8a0b61b` fix(server): Report status-less errors as internal, keep Jira's reason |
| F3 | An OnShape 403 reached the UI as a ValorBOM sign-in prompt with env-var wording | `onshapeClient._wrapError` used the "authentication failed — verify env vars" message for both 401 and 403, and the browser `request()` turned any 401/403 into `AuthRequiredError`, ignoring `body.source`. | `bdf85dc` fix(onshape): Show an OnShape 403 as a refusal, not a sign-in prompt |
| F4 (client) | The browser said "Couldn't reach ValorBOM" for any non-API error, including its own bugs | `friendlyError` treated every non-`ApiError` as a failed fetch. | `26a4bb5` fix(client): Distinguish internal errors from network errors |
| F6 | Clone response `fullPartNumber` held the whole summary | `partService.clonePart` returned `summary` as `fullPartNumber`. | `a576a16` fix(parts): Return the part number as clone fullPartNumber |
| F2 | Cut Version refused by OnShape (403) | The OnShape API key in `.env` reports `oauth2Scopes: 4097`: Read only, no Write bit. The document itself grants WRITE. Config, not code. | none (user action) |

Each commit includes its tests. `env -i PATH="$PATH" HOME="$HOME" npm test` passed on the full tree before committing (42 suites, 935 tests), and passed again on the staged contents of every intermediate commit, so each commit builds and tests on its own.

Not committed: `.env.authentik` (untracked, not matched by `.gitignore`'s `.env` line, so a `git add .` would pick it up; adding `.env*` to `.gitignore` is recommended) and `.kiro/`. No other uncommitted edits were in the tree; every changed file belonged to these fixes.

## Write log

Every write against Jira and OnShape in this check, from `write-log.md`. No issues or links were deleted. Every target was HAR-2030, HAR-2031, HAR-2032 or an issue this check created.

**Jira issues created**

| Key | What | When (UTC) | Step |
|---|---|---|---|
| HAR-2033 | Build "Test Assembly Build 2" (Build Number 2, Draft, Epic Link HAR-2030) | 15:20:34 | d |
| HAR-2034 | Part "VF27P-0002A Test Part Clone" (Revision A, clone of HAR-2031) | 15:20:53 | g |
| HAR-2035 | Part "VF27P-0001B Test Part" (Revision B, Re-create of HAR-2031 for Build 2) | 16:14:31 | e |

**Jira links created**

| Link id | Type | Tracker reads | When (UTC) | Step | Direction |
|---|---|---|---|---|---|
| 16601 | Used In | "HAR-2031 uses HAR-2032" | 15:18:22 | a | reversed (pre-fix) |
| 16603 | Used In | "HAR-2031 uses HAR-2033" | 15:20:34 | d | reversed (pre-fix) |
| 16606 | Revises | "HAR-2035 revises HAR-2031" | 16:14:31 | e | correct |
| 16607 | Used In | "HAR-2033 uses HAR-2035" | 16:14:31 | e | correct |

Link 16602 was made by someone else during the run and was not touched.

**Jira issues changed**

| Key | Change | When (UTC) | Step |
|---|---|---|---|
| HAR-2031 | Quantity (`customfield_10206`) 1 → 2, then 2 → 1 (restored). Machinery and Material rewritten with the same values; Powdercoat and Thickness set to empty (already empty). | 15:19:04 | b |

No status transitions were made. HAR-2032 and HAR-2033 are still Draft.

**OnShape**

| Document | Action | Result |
|---|---|---|
| `8c64dfdcb66184646a7a3f17` | `POST /versions` for HAR-2032, 4 attempts (15:19:28 ×2, 16:14:51 ×2) | All refused 403. **No OnShape version was created.** The document still has only version "Start". |

Write budget used: new Builds 1 of 2, Re-create 1 of 1, Clone 1 of 1.

## Final state of HAR-2030 (read-only GETs, after the commits)

Assembly **HAR-2030** "VF27A-0000A Test Assembly" (Epic, status New).

**Builds**

| Key | Summary | Status | Build Number | Onshape Version Link | Used In links |
|---|---|---|---|---|---|
| HAR-2032 | Test Assembly Build 1 | Draft | 1 | empty | #16601 with HAR-2031 (reversed: reads "HAR-2032 is used in HAR-2031") |
| HAR-2033 | Test Assembly Build 2 | Draft | 2 | empty | #16607 "HAR-2033 uses HAR-2035"; #16603 with HAR-2031 (reversed: reads "HAR-2033 is used in HAR-2031") |

**Parts**

| Key | Summary | Status | Revision | Used In | Revises |
|---|---|---|---|---|---|
| HAR-2031 | VF27P-0001A Test Part | Backlog | empty (treated as A) | Builds 1 and 2 via #16601, #16603 (both reversed) | "is revised by HAR-2035" (#16606) |
| HAR-2034 | VF27P-0002A Test Part Clone | Backlog | A | none | none |
| HAR-2035 | VF27P-0001B Test Part | Backlog | B | "is used in HAR-2033" (#16607) | "revises HAR-2031" (#16606) |

What ValorBOM shows from this: Build 1 holds HAR-2031. Build 2 holds HAR-2031 and HAR-2035 (the app matches Used In in either direction). Re-create adds the new revision to the Build and leaves the old revision's link in place; whether the old revision should leave the Build is a product question.

## Left for you

1. **OnShape key (unblocks c, f, h).** In OnShape, My account → Developer → API keys, create a key with "Application can write to your documents" (OAuth2Write). Put it in `.env` as `API_KEY` / `SECRET_KEY`, restart the API, then re-run `node .agents/tasks/live-write-check/live-check.mjs c`, then `f`, then `h`. Note that `c` will create a real OnShape version on document `8c64…`, and `h` archives Build 1, which is final.
2. **Reversed links 16601 and 16603.** They still read "HAR-2031 uses …". The app works with them as they are. Fixing the tracker wording means deleting each link and re-creating it Build → Part; that needs your OK.
3. **`.gitignore`.** Add `.env*` so `.env.authentik` can't be committed by accident.
4. **Low-severity follow-up from review.** A Re-create past Revision Z now reads "ValorBOM hit an internal error" because `nextRevisionLetter` throws a plain `Error`. Throwing an `HttpError` (409) there would show the real reason.
