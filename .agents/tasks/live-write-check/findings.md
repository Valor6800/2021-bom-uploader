# Live write check: findings (step 1, diagnose only)

Run 2026-10-31 15:15 to 15:25 UTC against branch `feature/assembly-build-part`, HEAD `9b428c4`. No code was changed.

- **API:** restarted on `127.0.0.1:6803` (PID 58122) as `node --import /tmp/valorbom-errlog.mjs src/server/index.js`, logging to `/tmp/valorbom-api.log`.
  - The preload `/tmp/valorbom-errlog.mjs` only adds logging. It logs Jira and OnShape error response bodies (and OnShape write responses) to stderr. It never logs request headers. It is needed because the app itself drops the upstream error body (finding F4).
  - Vite on 5173 was left alone.
- **Script:** `live-check.mjs` in this folder. Run one step with `node .agents/tasks/live-write-check/live-check.mjs <step>`, where `<step>` is one of `snapshot`, `linktypes`, or `a` to `j`.
  - Before each write it checks that every target is in scope. It also checks that every sibling Build a supersede could touch, and every Part a clone could link, is in scope. Each write is appended to `write-log.md`.
  - `state.json` stores the keys this run created and the write budget used.
- **Read-only helpers:** `createmeta.mjs`, `onshape-perms.mjs`, `linkscan.mjs`.

## Summary

| Step | Result | One line |
|---|---|---|
| a. Link HAR-2031 into Build 1 via save, then repeat | **FAIL** (direction) | The link is created and the repeat makes no duplicate, but the link is **reversed**: the tracker shows "HAR-2031 **uses** HAR-2032". See F1. |
| b. Quantity 1 → 2 → 1 via save | **PASS** | Both writes landed in Jira. Material, Machinery and summary were unchanged. Quantity is back to 1. |
| c. Cut Version on Build 1, then retry | **FAIL** | OnShape answered `403 Access denied` to `POST /versions`. Nothing was written: no version, no link, Build 1 still Draft. The repeat-guard retry could not be tested. See F2 and F3. |
| d. Create Build 2 (clone from Build 1) | **PASS** (except link direction) | HAR-2033 "Test Assembly Build 2": Build Number 2, Epic Link HAR-2030, Draft. The clone linked HAR-2031, with the same reversed direction (F1). |
| e. Re-create HAR-2031 for Build 2 | **BLOCKED** (held on purpose) | Re-create writes a Revises link and a Used In link, and both would come out reversed (F1). The whole run allows only 1 Re-create, so it is kept for the re-run after the fix. The predicted outcome is in F1. |
| f. Cut Version on Build 2 (Build 1 → Superseded) | **BLOCKED** | Needs OnShape version creation (F2). |
| g. Clone a Part from HAR-2031 | **PASS** | HAR-2034 "VF27P-0002A Test Part Clone": the next number in VF27P (0002), Revision A, Epic Link HAR-2030, no links, BOM fields copied. Minor issue in F6. |
| h. Archive Build 1 (from Superseded) | **BLOCKED** | Depends on f. Archiving the Draft Build 1 now would be final. It would also remove the only sibling Build, so the supersede (transition 21) could never be tested. |
| i. Read paths after writes | **PASS** | Details below. |
| j. Onboard preview of the HAR-2030 link | **PASS** | `POST /api/epics/onboard/preview` returned `status: "exists"`, `matchedOn: "workspace"`, Assembly HAR-2030. Nothing was created: one Assembly holds element `faea6282…`. `POST /api/epics/onboard` was not called, as instructed. |

Checked live, read-only:

- **Create screens:** Part has `customfield_10500/10501/10502/10503`. Build has `10110/10500/10501/10502`.
- **Edit screens:** Part has 10500 and 10502. Build has 10502.
- **Build 1 (Draft) transitions:** `31 Archive → Archived` and `11 Cut Version → Active`. These match `buildConstants.js`.
- **No screen problem** was found on any write path tested.

## Write budget

| | Used | Limit | Left | Keys |
|---|---|---|---|---|
| New Builds | 1 | 2 | **1** | HAR-2033 |
| Re-create | 0 | 1 | **1** | none |
| Clone | 1 | 1 | **0** | HAR-2034 |
| OnShape versions created | 0 | n/a | n/a | none (both attempts refused) |

Jira state now:

- **HAR-2032 Build 1:** Draft.
- **HAR-2033 Build 2:** Draft.
- **HAR-2031:** Quantity 1, Revision still empty. It is linked to HAR-2032 (link 16601) and HAR-2033 (link 16603). Both links are reversed.
- **HAR-2034:** Revision A, no links.
- **HAR-2030:** unchanged.

No issues and no links were deleted.

## Failures and root causes

### F1. Issue links are created in the reversed direction (Used In and Revises)

**Evidence (step a).** The save returned `{"op":"link","ok":true,"alreadyLinked":false}`. Afterwards, Jira `GET /issue/HAR-2031?fields=issuelinks` returned:

```
{ id: 16601, type: { name: "Used In", inward: "is used in", outward: "uses" }, outwardIssue: { key: "HAR-2032" } }
```

The tracker therefore shows "HAR-2031 uses HAR-2032" on the Part and "HAR-2032 is used in HAR-2031" on the Build. The intended wording is "Part is used in Build". The clone in step d made link 16603 the same way.

No error was raised. Server log:

```
POST /api/builds/HAR-2032/save 200 485ms
```

**What works anyway.** The functional parts passed:

- The repeat save answered `alreadyLinked: true` and created no duplicate.
- `GET /api/builds/HAR-2032/parts` returned `["HAR-2031"]`.

They pass because `usedInLinkedClause` and `hasUsedInLink` match either direction.

**Root cause.** `src/server/clients/jiraClient.js:256-265`, `createIssueLink(typeName, inwardKey, outwardKey)`, sends `inwardIssue: { key: inwardKey }, outwardIssue: { key: outwardKey }`.

- In Jira's `POST /rest/api/2/issueLink` (jira.js `issueLinks.linkIssues`), the issue in `inwardIssue` is the link's source. The source shows the **outward** description.
- The issue in `outwardIssue` is the destination and shows the **inward** description.
- On `GET /issue`, an entry holding `inwardIssue: X` is labelled with `type.inward`, per [Atlassian's issue linking model](https://developer.atlassian.com/cloud/jira/platform/issue-linking-model/).
- Callers pass the Part, or the earlier Revision, as `inwardKey`, so every link comes out reversed:
  - `src/server/services/buildService.js:293`: `createIssueLink(USED_IN, partKey, buildKey)` produces "Part uses Build".
  - `src/server/services/revisionService.js:103`: `createIssueLink(REVISES, previousKey, newKey)` produces "previous **revises** new" (should be "new revises previous").

**Second half of the bug.** `RevisionService._getPreviousRevision` (`revisionService.js:136-138`) looks for the entry that has `inwardIssue` on the newer ticket. That only finds the predecessor *because* creation is reversed.

- If someone makes a correctly directed link by hand ("B revises A"), B's entry is `outwardIssue: A`, and A's entry is `inwardIssue: B`. The walk from A would then go **forward** to B.
- So the fix has to change creation and `_getPreviousRevision` together.
- `_laterRevisionLink` and `hasUsedInLink` already accept either side.
- The design text (design.md 6.4 step 5, HANDOFF "inward=Part, outward=Build") encodes the same wrong mapping.

**Predicted Re-create result before a fix (step e, not run):**

- A new Part VF27P-0001B, Revision B.
- Tracker reads "HAR-2031 revises VF27P-0001B" and "VF27P-0001B uses HAR-2033".
- `getRevisionChain` would still walk correctly, because both halves of the bug cancel out.

**Existing data.** A read-only JQL `issueLinkType in ("revises","is revised by","uses","is used in")` over HAR found only links 16601 and 16603 (this run). No older Revises or Used In links need migrating. Links 16601 and 16603 still need to be reversed after the fix. Deleting a link and re-creating it is a tracker change; ask first.

**Correct shape.** For "A <outward> B" (Build HAR-2032 uses Part HAR-2031), send:

```
{ type: { name }, inwardIssue: { key: A }, outwardIssue: { key: B } }
```

So the calls should be:

- Used In: `inwardIssue = Build`, `outwardIssue = Part`.
- Revises: `inwardIssue = new revision`, `outwardIssue = previous`.
- `_getPreviousRevision`: on the newer ticket, read `link.outwardIssue`.

Best done by renaming the client's parameters to `(typeName, sourceKey /* outward wording */, targetKey)` so callers can't swap them again.

**Why the mocks missed it.** `__tests__/clients/jiraClient.test.js:196-225` only checks that the arguments were passed through to `linkIssues`. The service tests use fake clients that store the links however they were written. No test knows Jira's source/destination rule or how Jira labels the links, and the fixtures in `tests/visual/fixtures/` were produced by the same fakes.

### F2. OnShape refuses version creation: the API key has no Write scope (config, not code)

**Evidence (step c).** Server log, with the preload capturing the OnShape body:

```
[onshape-error-body] POST /api/documents/d/8c64dfdcb66184646a7a3f17/versions reqBody= {"documentId":"8c64dfdcb66184646a7a3f17","workspaceId":"82f00d3cbea6901ac26040bd","name":"HAR-2032","description":"Cut from ValorBOM for HAR-2032"} status= 403 resBody= {"message":"Access denied.","moreInfoUrl":"","status":403,"code":0}
POST /api/builds/HAR-2032/cut-version 403 305ms
```

The app's response was:

```
403 {"error":"Onshape authentication failed — verify ONSHAPE_ACCESS and ONSHAPE_SECRET env vars and check for clock drift","status":403,"source":"onshape"}
```

The retry got the same answer, and no version was created.

**Root cause.** The OnShape API key in `.env` is read-only. Read-only checks with the same key and signer (`onshape-perms.mjs`) show:

- **Authentication works.** `GET /api/users/sessioninfo` returns `oauth2Scopes: 4097`. OnShape scope bits are Read = 1, Write = 2, Delete = 4, so bit 2 (Write) is **not set**.
- **The user can write to the document.** `GET /api/documents/8c64…` returns `permission: FULL` and `permissionSet` includes `WRITE`.
- **The signature is fine.** Signed GETs succeed, and a bad signature would give 401, not 403.

**Request body.** `onshapeClient.createVersion` sends `{ documentId, workspaceId, name, description }` to `POST /api/documents/d/{did}/versions`, which is OnShape's `BTVersionOrWorkspaceParams` shape. It could not be confirmed live because the call never got past permissions.

**Fix (user action).** In OnShape, go to My account → Developer → API keys. Create a key with "Application can write to your documents" (OAuth2Write), or give the current key that scope. Then update `API_KEY` and `SECRET_KEY` in `.env` and restart the API. After that, re-run steps `c`, `f` and `h`.

**Why the mocks missed it.** The OnShape client is always faked, and nothing ever checked the key's scopes.

### F3. An OnShape 403 reaches the UI as "sign in required", with developer wording

This is an error-mapping bug, found through F2.

- **OnShape client.** `src/server/clients/onshapeClient.js:422` maps every OnShape 401/403 to "Onshape authentication failed — verify ONSHAPE_ACCESS and ONSHAPE_SECRET env vars and check for clock drift". That message is wrong for a 403 (scope or document permission), and it puts env var names into student-facing copy.
- **Server error handler.** `src/server/middleware/errorHandler.js` sends `err.status`, so the browser gets **HTTP 403**.
- **Browser client.** `src/client/src/api/client.js:97` turns *any* 401/403 into `AuthRequiredError`, ignoring `body.source`, as if the ValorBOM sign-in gate had refused.
- **Result.** In the Designer's Cut Version dialog (`DesignerPage.jsx` `confirmCut` → `friendlyClause`), the student would see "Couldn't cut the version: Onshape authentication failed — verify ONSHAPE_ACCESS…". The page that would care treats the error as a sign-in prompt, and `err.body` (`cutStage`, `onshapeVersionLink`) is lost.

A Jira 401/403 (expired PAT, missing permission) takes the same path.

**Correct behaviour.** Upstream auth failures should not keep their 401/403 status on the way out of ValorBOM. Map them to 502 with `source` set, or have the client check for `body.source` before deciding it is ValorBOM's own auth. The OnShape 403 copy should say OnShape refused the change.

**Why the mocks missed it.** The fixtures never use 403 with `source: 'onshape'` or `source: 'tracker'`. The client tests treat 401/403 only as ValorBOM's own gate.

### F4. The server drops Jira's error body, and any non-HTTP error becomes "no connection"

This is an error-mapping bug. It explains the user's report "Not added to Build 1: the team tracker didn't respond (no connection)".

**`wrapError`.** `src/server/clients/jiraClient.js:64-67` builds `JiraApiError(err.message, status)`.

- For a Jira HTTP error, jira.js's `HttpException.message` is axios's generic "Request failed with status code 400". The real reason in `err.response.data` (`errorMessages` and `errors`, e.g. `Field 'customfield_x' cannot be set. It is not on the appropriate screen`) is thrown away.
- The `[save]` and `[cut]` warn lines and the Jest suite therefore never see it. This run needed the preload to see bodies.
- **Fix:** keep `err.response?.data?.errorMessages` and `errors` on `JiraApiError` (for example as `jiraErrors`), and include them in the warn lines. Don't send them to the browser.

**Non-HTTP errors.** Any error without an HTTP status becomes `JiraApiError` with status 0: a TypeError from a wrong method name (the `createIssueLink` bug fixed in `9b428c4`), a bad argument, or a code bug in a callback.

- `describeUpstreamError` (`src/server/utils/upstreamError.js`) then says "the team tracker didn't respond (no connection)". `upstreamSource` says `tracker`.
- Reproduced locally without network: a TypeError thrown inside `JiraClient._retry` → `JiraApiError 0 -> the team tracker didn't respond (no connection) | source tracker`.
- **Fix:** in `wrapError`, wrap only errors that are really HTTP or network errors: those with a status, or an axios error with a network `code` such as `ECONNREFUSED`, `ENOTFOUND`, `ETIMEDOUT` or `ECONNRESET`. Re-throw anything else unchanged, so it becomes a logged 500 ("Something went wrong") and is not blamed on the tracker.
- The browser's `friendlyError` reads only `source` and `status`, so it is correct once the server stops mislabelling these errors.

**Why the mocks missed it.** The client tests mock jira.js to throw objects that already carry `status`. The service tests use fake clients that throw `JiraApiError` directly. No test throws a plain Error or TypeError through `_retry`.

### F5. Untested paths (blocked) that contain unverified writes

These still need the live re-run after F1 and F2 are fixed:

- **Cut Version.** `updateIssue(build, { customfield_10502 })` (on the Build edit screen, so expected to work), transition 11, the supersede (transition 21) and the 409 repeat guard.
- **Archive.** Transition 31 from Superseded.
- **Re-create.**
  - It copies Machinery, Material, Powdercoat and Thickness back to Jira as the raw objects it read, including `self` and `id` (`buildService.js` `_recreateOnce`, `extraFields`). Jira usually accepts this, but it has not been run.
  - The Revision write is `customfield_10500 = "B"`, and the field is on the Part create screen.
  - The Revises link direction is covered in F1.

## Read paths after writes (step i)

All returned 200.

- **`GET /api/builds?assemblyKey=HAR-2030`:** HAR-2033 (Build 2, Draft), then HAR-2032 (Build 1, Draft), newest first.
- **`GET /api/stories?key=HAR-2030&chain=1`:** HAR-2034 and HAR-2031 with the correct BOM fields.
- **`GET /api/builds/HAR-2032/parts` and `GET /api/builds/HAR-2033/parts`:** both `["HAR-2031"]`. Commit `0b0c0f4`'s JQL fix works live.
- **`GET /api/builds/for-part/HAR-2031`:** `[HAR-2033 Build 2, HAR-2032 Build 1]`. The current-Build indicator would show Build 2.
- **`GET /api/builds/for-part/HAR-2034`:** `[]`.
- **`GET /api/parts/by-keys`, `GET /api/revisions/chain/HAR-2034`** (`["HAR-2034"]`) and **`GET /api/builds/status`:** correct.
- **Compare:** not a separate endpoint. Compare is built in the client from the per-Build part lists and `by-keys` above, and those are correct.

### F6 (minor, not a failure). Clone response `fullPartNumber` holds the whole summary

`POST /api/parts/HAR-2031/clone` returned `fullPartNumber: "VF27P-0002A Test Part Clone"` (`src/server/services/partService.js:224` returns `summary`). `part.fullPartNumber` is correct (`VF27P-0002A`), and the UI reads that first, so nothing shows wrongly today.

## Other observations

- The API server starts the sheet-sync poller ("Sheet sync polling every 300s"). That is existing behaviour of the user's server, not this check. This run made no purchasing or receiving calls.
- Link id 16602 (between 16601 and 16603) is not a HAR Used In or Revises link, so someone else made it at the same time. It was not touched.

## Re-run after the fix (step 2)
Run 2026-10-31 16:09 to 16:15 UTC on the uncommitted fix (working tree on `9b428c4`). The API was restarted as plain `node src/server/index.js` (PID 11633, `127.0.0.1:6803`, no preload). Only the failed and blocked steps were re-run.

| Step | Before | Now | One line |
|---|---|---|---|
| a. Link HAR-2031 into Build 1, then repeat | FAIL (direction) | **PASS** (idempotent) | Both saves answered `alreadyLinked: true` and no link was created. The old link 16601 is still reversed (see "Existing data" below). The new direction is proved by step e. |
| c. Cut Version on Build 1, then retry | FAIL | **BLOCKED** (config, F2) | OnShape still answers 403. The key still reports `oauth2Scopes: 4097` (no Write bit). No version was created and HAR-2032 is still Draft. The error now reaches the browser as `403 {source: "onshape", error: "Onshape refused access — …"}`, which the client turns into "OnShape refused the change (403)." and no longer into a sign-in prompt (F3 fixed). |
| e. Re-create HAR-2031 for Build 2 | BLOCKED | **PASS** | HAR-2035 "VF27P-0001B Test Part", Revision B, Epic Link HAR-2030. Material, Machinery and Quantity were copied (the raw-object copy in F5 is accepted by Jira). Revises link 16606 reads **"HAR-2035 revises HAR-2031"**. Used In link 16607 reads **"HAR-2033 uses HAR-2035"** and "HAR-2035 is used in HAR-2033". `GET /api/revisions/chain/HAR-2035` returns `["HAR-2035","HAR-2031"]`. |
| f. Cut Version on Build 2 | BLOCKED | **BLOCKED** (F2) | Needs OnShape version creation. Not attempted: it would get the same 403 as c. |
| h. Archive Build 1 | BLOCKED | **BLOCKED** | Depends on f. |

Read-only checks after the re-run: `GET /api/builds/HAR-2033/parts` returns `["HAR-2035","HAR-2031"]`, `GET /api/builds/HAR-2032/parts` returns `["HAR-2031"]`, `GET /api/builds/for-part/HAR-2035` returns Build 2.

**Write budget now:** New Builds 1 of 2 used (HAR-2033), Re-create 1 of 1 (HAR-2035), Clone 1 of 1 (HAR-2034). OnShape versions: none.

**Fix status by finding:**
- **F1 fixed.** `createIssueLink(type, sourceKey, targetKey)` creates "source <outward> target". Used In is now Build → Part, Revises is new → previous, and `_getPreviousRevision` reads `outwardIssue`. Verified live by links 16606 and 16607.
- **F2 not a code fix.** Still needs a new OnShape API key with write scope (OAuth2Write) in `.env`, then a restart and a re-run of c, f and h.
- **F3 fixed.** The OnShape 403 message no longer blames the key or env vars. The client treats a 401/403 that carries `source` as the upstream refusing, and words OnShape 401/403 as "OnShape refused the change (403)."
- **F4 fixed.** Jira and OnShape clients only wrap real HTTP or network errors. A TypeError from our code is re-thrown, reaches the browser as `500 {internal: true}` and reads "ValorBOM hit an internal error." Jira's `errorMessages`/`errors` are kept on `JiraApiError.jiraErrors` and logged on `[save]`, `[cut]`, `[revision]` and on 4xx in the error handler, never sent to the browser.
- **F6 fixed.** The clone response's `fullPartNumber` is the part number only.

**Existing data still reversed (not changed, needs your OK):** Used In links 16601 (HAR-2031 / HAR-2032) and 16603 (HAR-2031 / HAR-2033) were made before the fix and still read "HAR-2031 uses …". The app treats either direction as linked, so nothing breaks, but the tracker wording is backwards on those two links. Fixing them means deleting each link and re-creating it in the right direction.

**Observation (not a failure):** after the Re-create, Build 2 holds both HAR-2031 (A) and HAR-2035 (B), because Re-create adds the new revision and leaves the old Part's link alone. This matches the code's design ("linked only to targetBuildKey"). Whether the old revision should leave the Build is a product question.
