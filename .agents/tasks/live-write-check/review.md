# Live write check fixes: link direction, upstream error mapping, clone part number

The uncommitted changes fix the four code findings from the ValorBOM live write check. F1 (reversed issue links): `JiraClient.createIssueLink` now takes `(type, sourceKey, targetKey)`, and the callers and `_getPreviousRevision` were flipped together. F3 (an OnShape 403 shown as a ValorBOM sign-in prompt): OnShape 403s get their own refusal wording, and the browser client only treats a 401/403 as its own sign-in gate when the body has no `source`. F4 (Jira's error body was dropped, and our own bugs read as "no connection"): both API clients now wrap only real HTTP or network errors and keep Jira's error body for the logs, and status-less errors from our own code reach the browser as `internal`. F6 (the clone response returned the whole summary as `fullPartNumber`) is a one-line fix. F2 needs no code: the OnShape API key has no Write scope, so the user must issue a new key. Every fix targets the cause shown in the live evidence. Each fix has a test, including guard tests that run real jira.js and axios code. The write log stays inside the allowed scope and budget.

Watch for: two links made before the fix (16601, 16603) still read backwards in the tracker and need the user's OK to re-create (confirmed). Cut Version, Supersede and Archive are still unverified live until the OnShape key gets Write scope (confirmed). A Re-create past Revision Z now reads "ValorBOM hit an internal error" where it used to show the reason (confirmed, low severity).

**Verdict**: APPROVED

## High-level view

The link fix renames the client's parameters so callers state the sentence they mean ("Build uses Part", "new revises previous"). The client then maps that sentence onto Jira's `inwardIssue`/`outwardIssue` fields in one place. The revision walk was flipped in the same change, so the two halves can't cancel out again. `__tests__/mocks/jiraLinkModel.js` is a small model of Jira's labelling rule, and `linkDirection.test.js` runs the real `JiraClient` and services against it. The coder showed this test fails on the pre-fix services. The live re-run backs it up: links 16606 and 16607 read the right way, and the revision chain from HAR-2035 walks back to HAR-2031.

Error classification now goes by where the error came from. `isNetworkError` (an axios error, or a socket/DNS code such as ECONNRESET, ETIMEDOUT or ENOTFOUND) decides whether a status-less error belongs to the tracker or OnShape. Anything else is re-thrown unchanged. The error handler marks it `internal: true` with a 500, and `friendlyError` words it as "ValorBOM hit an internal error." A real network failure still becomes `JiraApiError`/`OnshapeApiError` with status 0 and keeps the "didn't respond (no connection)" wording. In the browser, a failed `fetch()` becomes `NetworkError` and keeps "Couldn't reach ValorBOM. Is the server running?". Any other browser-side error is called internal. This matches check 2.

Jira's `errorMessages`/`errors` are kept on `JiraApiError.jiraErrors` and written only to server logs: the `[save]`, `[cut]` and `[revision]` warn lines, plus a 4xx line in the error handler. They are never added to the response body. That fixes the logging gap that made the live check depend on a preload.

The write log and `state.json` agree: 1 of 2 new Builds (HAR-2033), 1 of 1 Re-create (HAR-2035), 1 of 1 Clone (HAR-2034), no OnShape versions, no deletes. Every target is HAR-2030, HAR-2031, HAR-2032, or an issue this run created. The only OnShape target is document `8c64dfdcb66184646a7a3f17`. No secret values from `.env` appear in the diff, the new tests, the scripts or the notes. The scripts read credentials from env and print only scopes and permissions.

<details>
<summary>Issues (5)</summary>

1. **Pre-fix reversed links** — Used In links 16601 (HAR-2031/HAR-2032) and 16603 (HAR-2031/HAR-2033) still read "HAR-2031 uses …". With the user's OK, delete and re-create them as Build → Part. Non-blocking: the app matches either direction.
2. **Cut/Supersede/Archive still unverified live** — Steps c, f and h need an OnShape key with OAuth2Write in `.env`, an API restart, and a re-run. This is config, not a code change. Non-blocking for this diff.
3. **Revision-past-Z message lost** — `nextRevisionLetter` throws a plain `Error('No revision letter follows "Z"')`, which `recreateForBuild` (`buildService.js:602`) can reach. Under the new rules it reads "ValorBOM hit an internal error." Throw an `HttpError` (409) there if the reason should reach the student. Low severity.
4. **`.env.authentik` not ignored** — This untracked file (created Oct 28, before this run) is not matched by the `.env` line in `.gitignore`, so `git add .` would commit it. Add `.env*` (keeping any example file) to `.gitignore` before committing. It is not part of this diff.
5. **Repeated jiraErrors log spread** — `...(err?.jiraErrors ? [JSON.stringify(err.jiraErrors)] : [])` appears four times, and the `[cut]` resume line is mis-indented. A small helper would tidy this. Cosmetic.

</details>

<details><summary>Details</summary>

### Link direction: client contract and revision walk

The evidence for F1 is the live `issuelinks` entry for 16601. Sending `inwardIssue=HAR-2031, outwardIssue=HAR-2032` made HAR-2031 read "uses" HAR-2032. The fix keeps the jira.js body shape and changes what the client's arguments mean:

```
createIssueLink(USED_IN, buildKey, partKey)      // "Build uses Part"
createIssueLink(REVISES, newKey, previousKey)    // "new revises previous"
  -> { inwardIssue: source, outwardIssue: target }
_getPreviousRevision: newer ticket's Revises entry with outwardIssue -> previous
```

This is the root-cause fix the findings asked for, done in the form they recommended (renamed parameters). `hasUsedInLink` and `usedInLinkedClause` already matched either direction. That is why the step-a re-run found the reversed link 16601 as `alreadyLinked: true` and didn't create a duplicate. It also means the two old reversed links keep working until someone fixes them. The HANDOFF note was corrected to match.

There are two guards against a wrong library shape. The first test calls the real jira.js `IssueLinks.linkIssues` with a stub `sendRequest` and checks the POST to `/rest/api/2/issueLink` and its body. It follows the existing `linkIssues` guard pattern. The second is `linkDirection.test.js`, which runs the real `JiraClient`, `BuildService` and `RevisionService` against the labelling model. It checks the tracker wording on both issues, and that a walk from the middle revision goes back, never forward. The model encodes the rule that was observed live, so it would only be wrong if Jira's behaviour differed from the live evidence.

### Status-less errors: our bug or no connection

The F4 evidence is a TypeError (`createIssueLink is not a function`) that became `JiraApiError` status 0 and read "the team tracker didn't respond (no connection)". `wrapError` and `_wrapError` now return such errors unchanged. `_retry` doesn't retry them either, because `isTransient` needs a 5xx or a socket code, and the test asserts a single call. The real-network test builds its error with jira.js's own `BaseClient.buildErrorHandlingResponse`. That shows jira.js passes a no-response axios error through with `isAxiosError` set, so the `isNetworkError` check holds against the real library. The `AxiosError` test does the same for axios.

`describeUpstreamError` now returns "ValorBOM hit an internal error" for anything that isn't an `HttpError`, `JiraApiError` or `OnshapeApiError`. Its callers (the clone `failed[]` entries, the save `fail()` results, `cloneError`, the onboard `buildError`) get the same classification as the error handler. One side effect (confirmed): the plain `Error` that `nextRevisionLetter` throws past "Z" now reaches the student as the internal message. In practice this only matters for a Part that has already been revised 25 times.

The OnShape client no longer strips the secret from errors it passes through unchanged. Those are TypeErrors from our own code and can't hold the signing secret, and every axios error still goes through the sanitising path.

### OnShape 403 and the sign-in gate

The F3 evidence is the live 403 body `{"message":"Access denied."}` together with `oauth2Scopes: 4097`. A 401 keeps the old "authentication failed — verify env vars" message. That message is server-side only, because the browser now picks its wording from `source` and `status`. A 403 says the key may lack write scope. `request()` throws `AuthRequiredError` only when a 401/403 body has no `source`, so a tracker or OnShape refusal stays an `ApiError` and keeps `err.body` (`cutStage`, `onshapeVersionLink`). `apiClient.test.js` covers ValorBOM's own 401, an OnShape 403, a tracker 403, a fetch failure, and an AbortError passing through. The live re-run showed the new body reaching the browser.

### Scope and secrets in the run artifacts

`live-check.mjs` checks every target against `BUILD1`/`PART` plus the keys it created. It also checks sibling Builds a supersede could touch and Parts a clone could link, and it enforces the budget from `state.json`. The run made no DELETE calls and touched no PARTS project, purchasing or receiving endpoints. The sheet-sync poller is the server's existing behaviour, as the findings note. Link 16602, which someone else made during the run, was left alone. The scripts build the Authorization header from env and never print it. A check of the diff, the new test files, the scripts and the notes found none of the `.env` secret values (`SECRET_KEY`, `API_KEY`, `JIRA_KEY`, `OIDC_CLIENT_SECRET`, `SESSION_SECRET`). The test client uses the placeholder token `'tok'`.

### Verification evidence

`fix-verification.md` records `npm test` passing (42 suites, 935 tests). It also records the link test failing on the stashed pre-fix services, a clean `vite build`, a restart of the API only on `127.0.0.1:6803`, the OnShape scope check, and the live re-runs of a, c and e. No extra spot-check was needed.

</details>

<details>
<summary>File map</summary>

- `src/server/clients/jiraClient.js`: source/target `createIssueLink`, `jiraErrors` on `JiraApiError`, wraps only HTTP/network errors.
- `src/server/clients/onshapeClient.js`: separate 401 and 403 messages, wraps only HTTP/network errors.
- `src/server/utils/upstreamError.js`: `isNetworkError`, OnShape 401/403 wording, internal wording for other errors.
- `src/server/middleware/errorHandler.js`: logs `jiraErrors` on 4xx, `internal: true` for status-less errors.
- `src/server/middleware/httpError.js`: `internal` added to reserved detail keys.
- `src/server/services/buildService.js`: Used In as Build → Part, `jiraErrors` in warn lines.
- `src/server/services/revisionService.js`: Revises as new → previous, walk reads `outwardIssue`.
- `src/server/services/partService.js`: clone `fullPartNumber` is the part number only.
- `src/client/src/api/client.js`: `NetworkError`, 401/403 with a `source` is not a sign-in prompt.
- `src/client/src/lib/friendlyError.js`: OnShape refusal, internal and network wording.
- `docs/v3/HANDOFF.md`: corrected link-direction notes.
- Tests: `jiraClient`, `onshapeClient`, `middleware`, `buildService`, `partService`, `revisionService`, `friendlyError` and `upstreamError` updated. New `linkDirection.test.js`, `apiClient.test.js` and `mocks/jiraLinkModel.js`.

Full diff: `git -C /Volumes/workplace/6800/bom-uploader diff` plus the untracked test files.

</details>
