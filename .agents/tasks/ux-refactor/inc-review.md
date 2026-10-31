# INC-9 commit pass: legacy BOM pages and APIs removed, review findings closed

No increment is in progress. `progress.json` has all nine increments `done: true` and `complete: true`. The previous pass APPROVED INC-9, and the coder has since committed it as `f02278b refactor: Remove legacy BOM pages and APIs (INC-9)` on `feature/assembly-build-part`, unpushed. This pass checks that commit: that it matches the diff that was approved, and that the three non-blocking findings from that review were handled. `git diff HEAD` is empty. The only untracked items are `.env.authentik` and `.kiro/`, both deliberately left out. The commit touches the same 26 files the approved review mapped, and `src/server/index.js` is not among them, so auth gating is unchanged (BOM ungated, purchasing and receiving behind the mentor gate). The coder re-ran jest (40 suites, 908 tests passed) and the vite build (clean) after the commit-pass edits, and recorded both in `inc-verification.md`.

Watch for: nothing blocking. `.env.authentik` is still untracked and not ignored (confirmed). It stayed out of the commit because files were named explicitly, but a later `git add .` would pick it up.

**Verdict**: APPROVED

## High-level view

The empty `src/client/src/components/hub/` directory is gone, which closes finding 1 from the prior review. `docs/v3/HANDOFF.md` line 81 now says that `POST /api/export/step`, `POST /api/export/stl` and `POST /api/parts/auto-export` are ungated and need the same gate as the nine BOM write endpoints. That closes finding 3. The paragraph sits right above the loopback-only warning, so whoever adds the Authentik gate will see both together.

The commit content matches the approved diff. It deletes the legacy pages, components and slices, removes the four legacy endpoints along with their service and client functions, adds the 404 and moved-B1 tests, and rewrites HANDOFF. B1 validation coverage now goes through `PUT /api/stories/:key` and `POST /api/builds/:key/save`. With no create route left in `partRoutes.js`, the Build-less save path that produced HAR-2031 (B2) is closed on the server. This pass needed no new screenshots because the only edits were a directory removal and one HANDOFF paragraph. The `screenshots/final/` set from the approved pass (81/81 scenarios, `axe.json` with zero violations) still stands.

<details>
<summary>Issues (1)</summary>

1. **`.env.authentik` not ignored** — (confirmed, non-blocking) the file is untracked and not covered by `.gitignore`. Add `.env.*` (keeping `.env.example`, if there is one) to `.gitignore` in a follow-up so a broad `git add` can't commit it.

</details>

<details>
<summary>File map</summary>

- Commit `f02278b`: the same 26 files listed in the prior INC-9 review (legacy client pages, components and slices deleted; `api/client.js`, `store/index.js` and `partRules.js` trimmed; `epicRoutes`/`epicService` and `partRoutes`/`partService` legacy endpoints removed; route and service tests updated; `docs/v3/HANDOFF.md` and `tests/visual/README.md` updated).
- Commit-pass additions: `docs/v3/HANDOFF.md` export-endpoint paragraph; `src/client/src/components/hub/` removed (it was untracked, so it does not appear in the commit).

Full diff: `git -P show f02278b`.

</details>
