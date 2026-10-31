# ValorBOM UX refactor: design

Status: draft 8, **approved by the user** (draft 7 passed design review; draft 8 folds in the user's answers to section 15 and two orchestrator corrections; see the Revision log at the end). Branch `feature/assembly-build-part`. Nothing in this document has been implemented.

## 1. Overview

Today a student has to know three pages (`/assembly`, `/designer`, `/assembly/:key`), guess an Architecture and Year to find an Assembly, and discover on their own that a Build must exist before Parts can be saved. Nothing on screen offers to create that Build. The old `/assembly` page saves Parts with no Build at all, which is how orphan Part HAR-2031 was created. The `/designer` page is probably unusable as shipped: `store/index.js` imports `createBuildSlice` but never spreads it into the store, so `BuildSelection` calls an undefined `selectBuild` in its first effect (confirmed by reading `src/client/src/store/index.js:2-20`; not reproduced in a browser).

The refactor replaces those three pages with one entry point and two self-contained work pages:

- **Home (`/`)**: a search box first and an OnShape link box second. Search covers every season with no dropdowns. Clicking an Assembly asks "Designer or Assembly?".
- **Designer page (`/a/:key/design`)**: everything a CAD student needs on one page. It shows the Assembly header, a Build picker with "+ New Build" always visible, a "Create Build 1" empty state, Update from CAD, an inline-editable Parts table, a way to add existing Parts to this Build, Save, and Cut Version.
- **Assembly page (`/a/:key/assemble`)**: everything an assembly student needs on one page. It carries over every feature of the current hub (Revision selector, Build tabs, BOM, current-build indicator, Move / Re-create, edit and Save, Clone a part, Compare, Print, OnShape version link) in the new layout. The one exception is Cut Version, which lives only on the Designer (Q3); the Assembly page shows each Build's status and OnShape version link, and keeps the two-Active Build warning with its confirm-gated repair.

Pasting an OnShape link on Home checks for an existing Assembly for that element. If one exists, Home opens its Designer page. If none exists, Home shows a plain-words confirm, then creates the Assembly and Build 1 in one server call and opens the Designer page with Update from CAD already run.

The same effort fixes bugs B1 to B5 and answers the HAR-2031 empty-field report (B6: Build Number and OnShape Version Link are Build fields, empty on Parts on purpose). The server work comes first, in increments that ship on their own (section 12). The bug labels are fixed as follows, and section 8 uses exactly these:

- **B1:** Part create never writes Revision (`customfield_10500`).
- **B2:** when `createStory` succeeds and `linkPartToBuild` then fails, the failure is swallowed with `console.error`. Per-row save, link and update failures must show on the row, and a retry must only re-link, never re-create the Part.
- **B3:** `previewParts` fails entirely when the Assembly `getIssue` (season lookup) fails. It must fall back to a `null` season.
- **B4:** rows OnShape marks "Exclude from all BOMs" must be skipped, not reported as unidentified.
- **B5:** re-pasting an OnShape URL for an existing Assembly creates a duplicate Assembly.

Saving Parts with no Build (the legacy `/assembly` page, which created HAR-2031) is **not** one of B1 to B5. It is still in scope and is closed by two things: the `/assembly` redirect in INC-8 (no page can reach the Build-less save path) and the removal of the legacy create APIs `POST /api/stories` (create) and `POST /api/parts/upload` in INC-9 (no client can call it either). After INC-9 the only server path that creates a Part is a Build save (`POST /api/builds/:key/save`), plus Clone and Re-create, which act on an existing Part.

**Technology stack (locked once approved):** Node 20 + Express 4 API (existing), React 19 + react-router-dom 6.30 data router (`createBrowserRouter`, already in use) + Vite 6 (existing), hand-written CSS in `src/client/src/index.css` extended with design tokens. **No new runtime dependency.** Dialogs use the native HTML `<dialog>` element. Server tests use Jest 29 + supertest (existing). Pure client logic goes in `src/client/src/lib/*.js` and is tested by the existing Jest setup, following the `__tests__/utils/receivingView.test.js` precedent. Visual verification uses Playwright (`playwright` plus `@axe-core/playwright`) as **devDependencies**, run with `npm run test:visual` against a mocked API (section 13). Neither is a runtime dependency; `npm prune --production` in the Dockerfile removes them.

### Facts this design relies on (checked live, read-only)

A throwaway script, `/tmp/ux-refactor-check/search.mjs`, ran Jira search GETs only, with the write methods stubbed to throw. Its output is saved in `/tmp/ux-refactor-check/search-output.txt`.

| Check | Result | Consequence |
|---|---|---|
| `project = HAR AND issuetype = Assembly` | **6** issues in total, all open: HAR-2030 `VF27A-0000A Test Assembly`, HAR-1984 `VF27-0200 Tooling`, HAR-1983 `VF27-0100 Raw Materials`, HAR-1980 `Prototyping end effector…`, HAR-1979 `VR26-1200A End Effector`, HAR-1972 `Second end effector` | Only HAR-2030 passes today's `_parseEpics` mask. Search has to show the other 5 too (section 3.1). |
| `summary ~ "0000"`, `"0000*"`, `"0000A"` | 0 hits | Jira's tokenizer keeps `VF27A-0000A` as one token, so JQL text search **cannot** find a bare number. |
| `summary ~ "VF27A-0000A"`, `summary ~ "VF27*"`, `summary ~ "test*"` | Each one hits as expected | A full number or a word prefix works in JQL. |
| `key = HAR-999999` | **HTTP 400** | Key lookup must not go through JQL `key =`. Use `getIssue` and treat 404 as "no match". **Inferred, not probed:** `key in (...)` naming a missing key probably fails the same way, as a whole. Section 6.4 step 2 handles either behaviour: a 400 switches to per-key reads, and a key silently dropped from the result also takes the per-key fallback. |
| `cf[10302] ~ "faea6282…"` | 1 hit (HAR-2030) | The duplicate check works with `~`. |
| `cf[10302] = "faea6282…"` | **HTTP 400** (it is a text field) | Use `~`, then compare exactly in code. |
| `issuetype = Build` | 0 | No Builds exist yet. |
| `GET /rest/api/2/issue/createmeta/HAR/issuetypes`, then `/issuetypes/10103` (Part) and `/10301` (Build), via `/tmp/ux-refactor-check/createmeta.mjs`, output in `createmeta-output.txt` | Types: `10000:Epic`, `10103:Part`, `10301:Build`. The Part create screen has 17 fields, **including `customfield_10500` (Revision)** and `customfield_10110` (Epic Link). The Build create screen also has `customfield_10500`. The Part create screen **also lists `customfield_10501` (Build Number), `customfield_10502` (OnShape Version Link) and `customfield_10503` (Instructions Data)**, which are Build fields (`BuildField` in `buildConstants.js`). | B1 can write Revision on create without a Jira admin change. The three Build fields show, empty, on every Part (B6 and Q12). The Assembly type's API name is `Epic` (id 10000), which is why `toAssembly` accepts `Epic` or `Assembly`. |
| `GET /rest/api/2/issue/createmeta/HAR/issuetypes/10000` (Epic, the Assembly type), via `/tmp/ux-refactor-check/createmeta-epic.mjs`, output in `createmeta-epic-output.txt` (run 2026-10-30 for draft 5) | 11 fields: `assignee, customfield_10104, customfield_10106, customfield_10300, customfield_10301, customfield_10302, customfield_10500, description, issuetype, project, summary` | Onboarding's `createEpic` can write Revision (10500), the OnShape ids (10300-10302) and 10104 without an admin change. INC-3 re-runs the script as a precondition (section 12). |
| `/tmp/har2029-check/bom-app-call.json` item | Each item has a top-level boolean `"excludeFromBom": false`. The header is `{name:"Exclude from all BOMs", propertyId:"57f3fb8efa3416c06701d61e", propertyName:"excludeFromBom"}` | Field name for B4. |

## 2. Information architecture and routes

```
/                         Home: search + onboarding           (replaces DashboardPage)
/a/:key                   Chooser page (same choice as the dialog, as a shareable link)
/a/:key/design            Designer page        ?build=<BuildKey>&cad=1
/a/:key/assemble          Assembly page        ?build=<BuildKey>&view=bom|compare|print
/purchasing, /receiving   unchanged pages and gating; only nav/styling change
/designer                 -> redirect /                      (INC-6; the legacy page is already broken)
/assembly/:key            -> redirect /a/:key/assemble       (INC-7, keeps query string)
/assembly                 -> redirect /                      (INC-8, closes the Build-less save path)
*                         NotFoundPage (restyled)
```

Decisions:

- **`/a/:key/...` with the Jira key in the path.** The key is the only stable identifier (a number can be renamed in OnShape), and the current hub already uses it. `:key` is the Assembly or Revision ticket the student opened.
- **`design` and `assemble`.** Each name says what the student is about to do. I rejected `build` for the Assembly page because "Build" is one of the four domain words, so `/a/X/build` would read as "a single Build".
- **Revision lives in the path.** `:key` is the ticket for the Revision being viewed. Changing the Revision `<select>` in the shared header navigates to `/a/<revisionKey>/<mode>` (push, so Back returns to the previous Revision) and drops `?build`, because Builds belong to one Revision. Both pages behave the same way, and there is no `?rev` parameter.
- **Query parameters, not more path segments,** for Build and view. They are optional selectors with sensible defaults, so the page still works when they are missing or stale. Pages update them with `setSearchParams(…, { replace: true })`, so the Back button still means "previous page".
- **`cad=1`** is a one-shot instruction: the Designer runs Update from CAD once on load, then strips the parameter (`replace`). A reload therefore does not re-run it silently. Onboarding uses it only when Build 1 was created. The effect is guarded by a `useRef` flag (`cadRunRef.current`) that is set before anything else, and the parameter is stripped **before** the preview request starts, so React StrictMode's double effect run in dev (`main.jsx` uses `<React.StrictMode>`) fires one preview, not two. `cad=1` is evaluated only after the Build list is final, meaning the fetched list merged with any Build handed over in `location.state.onboard.build` (section 3.4, load step 1b). It is ignored when the merged list still gives no selected Build.
- **Nothing is remembered server-side.** The Designer/Assembly choice lives only in the URL.
- **Navigation bar (from INC-8, when Home exists):** brand "ValorBOM" (link to `/`), "Find an Assembly" (`/`), then the two mentor-only items unchanged ("Parts Order 🔒", "Parts Check-in 🔒"). The old "Dashboard", "Assembly BOM" and "Designer" entries go away in the same increment. Before INC-8 the current `NAV_ITEMS` stay as they are. When an Assembly page is open, its header carries a two-option **mode switch** (Designer | Assembly) that keeps `?build`.

## 3. Page-by-page design and wireframes

Every wireframe shows a laptop (1366 px) layout. Tablet behaviour is described under each one, and section 4.4 covers it in general.

### 3.1 Home `/`

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚙ ValorBOM     Find an Assembly     Parts Order 🔒   Parts Check-in 🔒     │
├────────────────────────────────────────────────────────────────────────────┤
│                                                                            │
│   Find an Assembly (?)                                                     │
│   ┌──────────────────────────────────────────────────────────────┐         │
│   │ 🔍  Search by name, number (0000, VF27A-0000A), season, HAR-…│  [×]    │
│   └──────────────────────────────────────────────────────────────┘         │
│   Try "intake", "0000", "VF27", "facility 2027" or "HAR-2030".             │
│   [☐] Include closed                                                       │
│                                                                            │
│   New Assembly from OnShape                                                │
│   ┌──────────────────────────────────────────────────────┐ ┌──────────┐    │
│   │ Paste the OnShape assembly link…                      │ │ Continue │    │
│   └──────────────────────────────────────────────────────┘ └──────────┘    │
│   Open the assembly tab in OnShape and copy the address bar.               │
│                                                                            │
│   ── Facility 2027 ───────────────────────────────────────────── 3 ──      │
│   ┌───────────────────────────────────────────────────────────────────┐    │
│   │ VF27A-0000A  Test Assembly                  Revision A HAR-2030   │    │
│   │                                       [ Designer ]  [ Assembly ]  │    │
│   ├───────────────────────────────────────────────────────────────────┤    │
│   │ VF27-0200  Tooling                  (No number)       HAR-1984    │    │
│   │                                       [ Designer ]  [ Assembly ]  │    │
│   └───────────────────────────────────────────────────────────────────┘    │
│   ── Robot 2026 ──────────────────────────────────────────────── 1 ──      │
│   │ VR26-1200A  End Effector            (No number)       HAR-1979    │    │
│   ── Other ───────────────────────────────────────────────────── 2 ──      │
│   │ Second end effector                 (No number)       HAR-1972    │    │
└────────────────────────────────────────────────────────────────────────────┘
```

- **The empty query lists every open Assembly, grouped by season.** Groups are ordered newest season first, so Facility 2027 and Robot 2027 before Facility 2026 and Robot 2026. Within a year, Robot comes before Facility because Robot is the build-season work. Inside a group, the newest Assembly comes first. Assemblies with no parseable season go in a final "Other" group. I chose grouping over a flat "newest first" list because students think in seasons, and grouping makes "facility 2027" visible without typing.
- **Results while typing** become one flat list ranked by relevance (section 3.1.1), with the season shown as a chip on each row. Headings would split a 3-result list into noise.
- **Each result card** is one row. The left part is a `<button>` that opens the chooser dialog (3.2). The right side has two direct `<Link>`s, "Designer" and "Assembly". Below 640 px the two links drop under the title and stay visible (no hover-only actions on touch).
- **"(No number)"** is a small neutral chip with a `title` and visually hidden text: "This Assembly's name doesn't follow the VF27A-0000A pattern." Unnumbered Assemblies stay usable. They open on both pages, and only the Designer's season prefix for BOM rows is missing (B3 makes that safe).
- **Search input:** `type="search"`, `<label>` "Find an Assembly", autofocus on load, a 250 ms debounce, an `AbortController` that cancels the stale request, and the query mirrored to `/?q=` with `replace`. Esc clears it. The result count goes into a polite `aria-live` region ("3 Assemblies").
- **Server cap:** at most 50 results. When `total > 50` the page shows "Showing 50 of N. Add more words to narrow it."
- **"Include closed" toggle (Q8):** a native checkbox with the visible `<label>` "Include closed", directly under the search hint. It is **off by default**. Its state is mirrored to `/?closed=1` with `replace` (absent means off), so a shared link keeps it. Changing it re-runs the current query at once (no debounce) and cancels any in-flight request through the same `AbortController`. It sends `includeClosed=1` to the search endpoint (6.1). When it is off, closed Assemblies still come up for an exact key match (3.1.1). Every closed result, whichever way it was found, carries a neutral "Closed" chip with visually hidden text "This Assembly is closed." Clicking a closed result works as for any other: the chooser, Designer and Assembly pages open normally.

Home states (each one gets a screenshot):

```
No results                                    Search failed
┌──────────────────────────────────────┐      ┌────────────────────────────────────────┐
│  No Assembly matches "bash".         │      │ ⚠ Couldn't load Assemblies:             │
│  Check the spelling, or paste its    │      │   The team tracker didn't respond (503).│
│  OnShape link above to add it.       │      │                               [Retry]   │
└──────────────────────────────────────┘      └────────────────────────────────────────┘
└──────────────────────────────────────┘
No Assemblies at all (empty tracker)
┌───────────────────────────────────────────────────────────────────────┐
│  No Assemblies yet. An Assembly (?) is one mechanism, like the intake.│
│  Paste its OnShape assembly link above to add the first one.          │
└───────────────────────────────────────────────────────────────────────┘
```

#### 3.1.1 Search semantics (implemented server-side, section 6.1)

- The query is normalized (trimmed, lower-cased, whitespace collapsed) and split into tokens. **Every token must appear as a substring of the Assembly's haystack.** The haystack is the key, summary, full number, bare 4-digit number, season code (`vf27`), season label (`facility 2027`), and the 4-digit year (`2027`).
  - `0000` matches `VF27A-0000A`. `facility 2027` matches through the label. `VF27` matches HAR-2030, HAR-1983 and HAR-1984 through the summary. `har-2030` and `2030` match through the key. `test assem` matches through the summary.
- A **key-shaped** query (`/^[A-Za-z][A-Za-z0-9_]*-\d+$/`) also runs a direct `getIssue`. That covers a Closed Assembly too, since a direct key is a deliberate lookup, so an exact key finds a closed Assembly even with "Include closed" off. With "Include closed" on, closed Assemblies are part of the matched set like any other, and the empty query lists them in their season groups.
- **Ranking** (highest first): 100 for an exact key, 90 for an exact full number, 80 for an exact bare number, 60 when the name starts with the first token, 40 for anything else. Ties go to the newest `created`.

### 3.2 Chooser dialog (and `/a/:key` page)

```
            ┌───────────────────────────────────────────────────┐
            │  VF27A-0000A Test Assembly                    [×] │
            │  Facility 2027 · Revision A · HAR-2030            │
            │                                                   │
            │  What are you doing?                              │
            │  ┌──────────────────────┐ ┌──────────────────────┐│
            │  │ ✎  Designer          │ │ 🔧 Assembly          ││
            │  │ I do CAD: update     │ │ I build it: Parts    ││
            │  │ Parts from OnShape,  │ │ list per Build,      ││
            │  │ edit, save, cut a    │ │ compare, print       ││
            │  │ version.             │ │                      ││
            │  └──────────────────────┘ └──────────────────────┘│
            └───────────────────────────────────────────────────┘
```

- A native `<dialog>` opened with `showModal()`. It has `aria-labelledby` (pointing at the title) and `aria-describedby` (pointing at the meta line). Focus starts on the "Designer" option. Esc and the × button close it, and so does a click on the backdrop. On close, focus returns to the card that opened it. The two options are `<Link>`s styled as large tiles: 44 px minimum height, arrow keys not required, Tab moves between them.
- `/a/:key` renders the same content as a page card (no `<dialog>`). That gives the team a link to share when the receiver should pick the mode.

### 3.3 Onboarding states (Home, OnShape link box)

Flow: the student pastes a link and presses Enter or Continue. The client checks the URL shape locally. If it fails, an inline error appears under the field and no request is sent. Otherwise the client calls `POST /api/epics/onboard/preview` (read-only), and the result opens one of the dialogs A to D below (all four are `ui/Dialog`). E is a banner on the Designer, and F is inline.

```
A. Confirm (new)                                   B. Already exists
┌──────────────────────────────────────────────┐   ┌───────────────────────────────────────────┐
│ Create a new Assembly?                       │   │ This Assembly is already here             │
│                                              │   │                                           │
│   VF27A-0000A Test Assembly                  │   │   VF27A-0000A Test Assembly  (HAR-2030)   │
│   Facility 2027 · Revision A                 │   │                                           │
│                                              │   │ That OnShape assembly was added before,   │
│ This will:                                   │   │ so nothing new will be created.           │
│  • add this Assembly (?) to the team tracker │   │                                           │
│  • start its first Build (?): Build 1, Draft │   │        [ Cancel ]  [ Open in Designer ]   │
│  • open the Designer and read Parts from CAD │   └───────────────────────────────────────────┘
│ Nothing changes in OnShape. Check the number │   (A Dialog like A, C and D; focus starts on
│ and name: they come from the assembly's      │    "Open in Designer", so Enter opens it. If
│ Properties in OnShape.                       │    the match is on another workspace: "…added
│                                              │    before from another branch of this document.")
│   [ Cancel ]  [ Create Assembly and Build 1 ]│
└──────────────────────────────────────────────┘

C. OnShape properties incomplete                   D. Number already used by another Assembly
┌──────────────────────────────────────────────┐   ┌───────────────────────────────────────────┐
│ ⚠ Can't add this assembly yet                │   │ ⚠ VF27A-0000A is already used             │
│ Fill these in the assembly's Properties      │   │ HAR-2040 "VF27A-0000A Old Test" has this  │
│ dialog in OnShape, then try again:           │   │ number but a different OnShape assembly.  │
│  • Project: missing (e.g. VF27)              │   │ Change the Part number in OnShape, or     │
│  • Part number "12": needs 4 digits          │   │ open HAR-2040 if it's the same thing.     │
│                                 [ Got it ]   │   │        [ Cancel ]  [ Open HAR-2040 ]      │
└──────────────────────────────────────────────┘   └───────────────────────────────────────────┘

E. Created, Build failed (shown on the Designer page after redirect)
┌────────────────────────────────────────────────────────────────────────────┐
│ ⚠ Assembly VF27A-0000A Test Assembly (HAR-2050) was created, but Build 1   │
│   couldn't be created: the team tracker didn't respond. Your Assembly is   │
│   saved.                                                                   │
│   [ Try again: Create Build 1 ]                                            │
└────────────────────────────────────────────────────────────────────────────┘
F. Network or OnShape error: an inline error under the link box with the server message and a "Try again" button.
```

- **A:** the primary button shows a spinner and "Creating…" while it works, and both buttons are disabled to stop a double submit. When it finishes with a Build, the page navigates to `/a/HAR-2050/design?build=HAR-2051&cad=1` with `state: { onboard: { assemblySummary, build } }` (the `build` object lets the Designer show the new Build before Jira search indexes it; the Designer merges it in load step 1b of section 3.4, before it picks the selected Build and before the `cad=1` effect runs).
- **B:** a `Dialog` (`ui/Dialog`, `initialFocusRef` on "Open in Designer"); Esc and Cancel close it and return focus to the link box. "Open in Designer" navigates to `/a/<key>/design` with no `cad=1`.
- **B from the commit call (in-flight waiter, 6.6 step 1).** When `POST /api/epics/onboard` itself answers `{ status: 'exists', assembly, build }`, which happens when a double submit or a second tab lost the race to the first call, Home does not show dialog B. If `build` is set, it navigates exactly as for `created`: `/a/<key>/design?build=<build.key>` with `state: { onboard: { assemblySummary, build, alreadyAdded: true } }`, **without** `cad=1` (the winning call's tab runs Update from CAD; this one shouldn't run it a second time). If `build` is `null`, it navigates to `/a/<key>/design` with `state: { onboard: { assemblySummary, alreadyAdded: true } }`. Either way the Designer shows the notice "Already added; opened it." (`role="status"`, dismissible), triggered by `state.onboard.alreadyAdded: true`.
- **C:** the server's `problems[]` array (section 6.5) renders as a list. The existing 400 message stays the fallback text. The client reads it from `ApiError.body.problems` (section 5, `api/client.js`).
- **D and the "properties changed" case** are driven by `ApiError.status === 409`: `err.body.assembly` present gives dialog D; `err.body.proposed` present re-opens dialog A with the new name and the line "The name in OnShape changed since you checked."
- **E (handoff from Home to the Designer):** when `POST /api/epics/onboard` returns `{ status: 'created', build: null, buildError }`, Home calls `navigate(\`/a/${assembly.key}/design\`, { state: { onboard: { assemblySummary: assembly.summary, buildError } } })` **without** `cad=1` and without `?build`. The Designer:
  - shows banner E when `location.state?.onboard?.buildError` is set, **in place of** the normal "No Builds yet" teaching text, with the same "Create Build 1" button inside the banner;
  - disables Update from CAD with the help text "Create Build 1 first." (this applies to every Assembly with no Build, not only after onboarding);
  - on a successful "Create Build 1", sets `?build=<new key>` and clears the state with `navigate(location.pathname + '?build=' + key, { replace: true, state: null })`, so a reload never shows the banner again;
  - if "Create Build 1" fails again, keeps the banner and shows the new error under the button.
  Because `location.state` survives a reload in the same tab but not a copied link, a shared URL simply shows the normal empty state, which is correct.

### 3.4 Designer page `/a/:key/design`

The shared Assembly header appears on both work pages:

```
┌────────────────────────────────────────────────────────────────────────────┐
│ ← All Assemblies                                                           │
│ VF27A-0000A  Test Assembly                       ( Designer | Assembly )   │
│ Assembly (?) · Facility 2027 · Revision (?) A ▾ · HAR-2030 · Open in OnShape ↗ │
└────────────────────────────────────────────────────────────────────────────┘
```

The Revision control is a `<select>` only when the revision chain has more than one ticket. Otherwise it is plain text.

**No Builds (teaching empty state):**

```
 Build (?)   [ + New Build ]
┌────────────────────────────────────────────────────────────────────────────┐
│                         No Builds yet                                      │
│  A Build is one combination of Parts for this Assembly. Parts are saved    │
│  into a Build, so start with Build 1.                                      │
│                       [ Create Build 1 ]                                   │
│  Name: Test Assembly Build 1 · starts as Draft (not ready to build yet)    │
└────────────────────────────────────────────────────────────────────────────┘
 Parts in this Assembly (not in any Build yet)                         1
 │ ☐ HAR-2031  VF27P-0001A Test Part   Qty 1  PLA  3D Printer   Not in any Build │
```

Before any Build exists the Parts list is read-only, with its checkboxes disabled. The helper text says "Create Build 1 to add these Parts to it." **Update from CAD is disabled** (`aria-disabled`, still focusable) with the help text "Create Build 1 first.", because every Part the Designer saves goes into a Build. Clicking "Create Build 1" calls `POST /api/builds` with name = Assembly name and the loaded chain. On success it selects the new Build (`?build=`), the checkboxes and Update from CAD become active. When the page was reached from a failed onboarding, banner E (section 3.3) replaces the "No Builds yet" text and holds the same button.

**Material is an editable select** in every Designer and Assembly-page row (`InlineSelect` over `MATERIALS`, like Machinery). OnShape materials that `BOMService` can't map (for example "Steel", "Brass") reach the preview unchanged. Such a row shows the CAD text as the current, unlisted option "Steel — pick a material" (through `InlineSelect`'s new `extraOption` prop, section 5), gets `aria-invalid="true"` and the row error "\"Steel\" isn't on the material list. Pick one.", and is held back from Save until the student picks a listed value (section 7.3). The other rows still save.

**With Builds, before Update from CAD:**

```
 Build (?)  ( Build 1 · Draft ) ( Build 2 · Active ✓ ) [ + New Build ]
            "Test Assembly Build 1"
┌ Build 1 · Draft ───────────────────────────────── [⟳ Update from CAD] [✂ Cut Version] ┐
│ Part (?)                       Qty  Material  Machinery   Powdercoat  Thickness  Status │
│ ── In Build 1 (2) ─────────────────────────────────────────────────────────────────── │
│   HAR-2031 VF27P-0001A Test Part  [1]  [PLA▾]     [3D Printer▾] [—]      [—]     In Build│
│   HAR-2032 VF27P-0002A Plate      [2]  [AL 6061▾] [CNC Router▾] [Black▾] [0.125▾] In Build│
│ ── Other Parts in this Assembly (1) ──────────────────────────────────────────────── │
│ ☐ HAR-2033 VF27P-0003A Bash bar 2"  1  …                         Also in Build 2      │
└───────────────────────────────────────────────────────────────────────────────────────┘
 Teaching hint (only while there's 1 Build): "Need a different combination of Parts,
 like a 1" vs 2" bash bar? Make a + New Build."
```

**After Update from CAD (one new Part, one changed, one unidentified, a save error):**

```
 ⚠ 1 BOM row couldn't be read: item 3 "Bracket": missing Revision.   (UnidentifiedPartsWarning)
┌ Build 1 · Draft ───────────────────────────────── [⟳ Update from CAD] [✂ Cut Version] ┐
│ ── New from CAD (1) ─────────────────────────────────────────────── [☑ select all]   │
│ ☑ New      VF27P-0004A Spacer   [4] [PETG-CF▾] [3D Printer▾] [—] [—]           New    │
│ ── In Build 1 (2) ─────────────────────────────────────────────────────────────────  │
│   HAR-2031 VF27P-0001A Test Part [3]← "Changed in CAD: Qty 1→3"               Changed │
│   HAR-2032 VF27P-0002A Plate     [2]                                          In Build │
│ ── Other Parts in this Assembly (1) ────────────────────────────────────────────────  │
│ ☐ HAR-2033 VF27P-0003A Bash bar 2"                         Also in Build 2           │
│ ── row error example ──                                                              │
│ ⚠ HAR-2034 VF27P-0005A Clip  Created, but not added to Build 1: the team tracker     │
│   didn't respond (503).                                                     [Retry]  │
│ ⚠ New  VF27P-0006A Shaft  [1] [Steel ▾ pick a material] [Manual Lathe▾]  Not saved:  │
│   "Steel" isn't on the material list. Pick one.        (aria-invalid, held back)     │
└───────────────────────────────────────────────────────────────────────────────────────┘
┌ sticky save bar ────────────────────────────────────────────────────────────────────┐
│ Unsaved: 1 new Part · 1 change · 0 added to Build          [ Discard ]  [ Save ]    │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

**"+ New Build" form** (an inline panel that opens under the Build picker; focus moves to the Name field):

```
┌ New Build ─────────────────────────────────────────────────────────┐
│ Name   [ Test Assembly                    ]                         │
│ What's different? (optional)  [ 1in bash bar             ]          │
│   → "Test Assembly Build 3 - 1in bash bar"                          │
│ Start  (•) Empty   ( ) Copy Parts from [ Build 2 · Active ▾ ]       │
│ A Build is one combination of Parts, like a 1" vs 2" bash bar.      │
│                                   [ Cancel ]  [ Create Build 3 ]    │
└─────────────────────────────────────────────────────────────────────┘
```

**Build names (Q2).** The Name field defaults to the Assembly name. The optional "What's different?" field is a short description (`maxlength="60"`, help text "A few words, like 1in bash bar."). The Jira summary is `{name} Build {N}` when the description is empty, and `{name} Build {N} - {description}` otherwise, built by the server (6.3). Build Number stays numeric and is assigned by the server (`customfield_10501`); the description never affects it, because `_parseBuild` reads `buildNumber` from that field, not from the summary. The "Create Build 1" empty-state button and onboarding's Build 1 send no description. The picker chip shows `buildLabel(build)` ("Build 3"), and the line under the picker shows the full summary, so the description is visible there and in the Assembly page tab's `title`.

The preview line shows the server's naming rule through `buildSummaryPreview(name, nextNumber, description)` (7.1): `{name} Build {next number}`, plus ` - {description}` when one is typed. `next number` is `nextBuildNumber(chainBuilds)` over the **unfiltered** list of Builds for the whole Revision chain (load step 1), so Revision B's first Build reads "Build 3" when Revision A has Builds 1 and 2. It is display-only, because the server assigns the real number. While a create is in flight, and until the new Build is in the list (merged from the response, section 9), "+ New Build" and "Create Build N" are disabled, so two quick clicks can't race on the same number.

**Cut Version confirm** (`<dialog>`): "Cut Build 1's version? This makes a version in OnShape named HAR-2051, marks Build 1 **Active** (the one to build), and marks Build 2 **Superseded**. You can't undo this here." Buttons: Cancel / Cut Version. Cut Version is enabled only when the Build's status is `Draft`. Otherwise the button is disabled with the tooltip "Already cut". The status the button reads is the **overlaid** one (`overlayBuildStatus`, section 7.1), not the raw search result, because `GET /api/builds` lags. While a cut is in flight both the dialog's Cut Version button and the header button are disabled. On success (`{ onshapeVersionLink, superseded }`, section 6.9) the page records the cut Build as `Active` with the returned link, and every key in `superseded` as `Superseded`, in its `statusThisSession` overlay, then re-fetches Builds. So the button stays disabled even when the re-fetch still says Draft. The server refuses a second cut regardless (6.9), so the client check is a convenience, not the guard. A 200 with `resumed: true` (6.9 step 2) is handled exactly like a normal success. On a 409 the page writes an overlay entry only when `err.body.buildStatus` is present (`{ status: err.body.buildStatus }`); without it, it relies on the Builds re-fetch. The client never reads `err.body.status` as a Build status, since that is the HTTP status.

**Two Active Builds (repair path).** A cut whose supersede step failed (6.9, `cutStage: 'supersede'`) leaves the cut Build Active while an older sibling is still Active. The page records the cut Build as `Active` with `err.body.onshapeVersionLink` in `statusThisSession`, so it is shown as it really is, and also stores that Build's key as `cutFailedKey` (page state, cleared when the Revision changes or the repair succeeds). Two Active Builds can also come from a cut in another tab, or from a hand edit in the tracker, so the warning is not tied to the Cut Version button.

**Both the Designer (INC-6) and the Assembly page (INC-7) implement the four steps below**, with the same shared component `builds/TwoActiveWarning` (props: `builds` (overlaid), `cutFailedKey`, `documentId`, `assemblyKey`, `onStatus(entries)`, `onResolved()`) and the same `lib/buildNames.js` functions, so the two pages can't drift. On the Assembly page the warning sits at the top of the Build panel, above the tab panel, and is shown whichever tab is selected. The Assembly page has no Cut Version button (Q3), so its `cutFailedKey` is always `null` and step 3 only ever offers "Make Build N the Active one"; the repair itself calls the cut-version endpoint's resume path, which never makes a new OnShape version (6.9 step 2), so it is a status repair, not a CAD decision. The steps:

1. **Detect.** `activeConflict(overlaid)` (7.1) runs over the overlaid Builds of the selected Revision. When it returns fewer than two Builds, nothing is shown.
2. **Re-check by key before warning.** Search statuses lag, so a tab without an overlay entry can see a Build as Active that was superseded seconds ago. When `activeConflict` returns two or more Builds, the page calls `GET /api/builds/status?keys=<their keys>` (6.10, at most 10 keys; with more than 10 it sends the 10 with the highest Build number). It writes every returned `{ status, onshapeVersionLink }` into `statusThisSession` (so the by-key values win over search until a re-fetch agrees, `dropAgreedStatus`), and treats a key in `missing` as not Active. The warning shows only when `activeConflict` over the re-overlaid list still returns two or more. The check runs once per distinct set of conflicting keys (sorted and joined), and again after a cut, a repair or a Builds re-fetch changes that set, so it can't loop. While it runs, nothing is shown. If it fails, the page shows no warning and no button, only a `role="status"` line: "Couldn't check whether Build 1 and Build 2 are both Active. [Check again]".
3. **Offer only a safe Build.** `repairCandidates({ conflict, cutFailedKey, documentId })` (7.1) picks the buttons. When `cutFailedKey` is one of the conflicting Builds, the session knows which cut failed, so the only button is "Finish cutting Build 1" for that Build. Otherwise the buttons are "Make Build N the Active one" for each conflicting Build whose `onshapeVersionLink` contains `/documents/<assembly.documentId>/v/`, because the server refuses any other Active Build with 409 (6.9 step 2). When no Build qualifies (ValorBOM didn't cut them, or the Assembly has no OnShape link), the warning has no button and says "ValorBOM didn't cut these versions, so it can't choose between them. Ask a mentor to fix it in the team tracker." The warning `Alert` (`role="alert"`, top of the Build panel) reads "Build 1 and Build 2 are both Active. Only one should be." followed by the buttons.
4. **Confirm, because Supersede can't be reversed.** The Build workflow has no transition out of Superseded or Archived, and ValorBOM treats both as final (Q9), so a button never acts in one click. It opens a `ui/Dialog` titled "Make Build 1 the Active one?" with the body "Build 2 will be marked Superseded. This can't be undone from ValorBOM." (every other conflicting Build is named). Buttons: [Cancel] and [Mark Build 2 Superseded]. `initialFocusRef` is on **Cancel**, so Enter does nothing harmful. Esc and Cancel close the dialog and send no request. Confirm calls `POST /api/builds/:key/cut-version` with `{ assemblyKey }` for the chosen Build, which takes the resume path (6.9 step 2): no new OnShape version, and every other Active Build of the Revision is marked Superseded. While it runs both buttons are disabled.
   - 200: the result goes into `statusThisSession` like any cut, `cutFailedKey` is cleared, the dialog closes and the Builds are re-fetched.
   - 409: the chosen Build is no longer Active with this document's link (another tab finished or changed it). The dialog shows "Build 1 is no longer Active; nothing to fix." with [Close], records `err.body.buildStatus` in `statusThisSession` when present, and re-runs the step-2 check. It does not show the Cut Version 409 copy "has already been cut", which would read as an error.
   - Any other failure: the dialog stays open with "Couldn't mark Build 2 Superseded: " + `friendlyError(err)` + " Try again." and the confirm button re-enabled.

Screenshots (INC-6): `designer-two-active-builds.png`, `designer-two-active-confirm.png`, `designer-two-active-stale.png`, `designer-two-active-finish-cut.png`, `designer-two-active-repair-409.png`. Screenshots (INC-7): `assembly-two-active-builds.png`, `assembly-two-active-confirm.png`, `assembly-two-active-stale.png`, `assembly-two-active-repair-409.png` (section 12). There is no Assembly-page "finish cut" shot, because that page never sets `cutFailedKey`.

Designer behaviour. All state is local to the page (`useState`/`useReducer`), with no Zustand slice. This follows the existing HANDOFF decision, "Designer and Assembly hub keep their own local state rather than sharing Zustand slices, on purpose, to avoid cross-page interference", and the precedent of `AssemblyHubPage`, which uses `useState`. The Assembly page does the same. Zustand stays the store for purchasing and receiving, and its BOM slices are deleted in INC-9 (section 5).

1. **On load,** run in parallel: `GET /api/epics/:key`, `GET /api/revisions/chain/:key`, `GET /api/stories?key=:key&chain=1` (the Parts of **every ticket in the Revision chain**, section 6.8). Parts keep the Epic Link of the Revision they were created under (Re-create copies it, Move only adds a link), so a Part made under Revision A can be in a Build of Revision B; scoping to `:key` alone would hide it. When the chain resolves, call `fetchBuildsForAssembly(key, chainKeys)` (`GET /api/builds?assemblyKey=:key&revisionChainKeys=…`, already supported by the route and client) to get `chainBuilds`. The picker shows `chainBuilds.filter(b => b.assemblyKey === key)`; `nextBuildNumber` uses the unfiltered list. Then fetch `GET /api/builds/:b/parts` for each displayed Build, to learn each Part's Build membership for the "Also in Build 2" labels. Any linked key that isn't among the chain Parts is fetched with `GET /api/parts/by-keys` and added to `parts`, which is the same union `AssemblyHubPage.reloadParts` does today, so every Part in a displayed Build is visible. Such a Part (its `epic` is outside the chain, which only a hand-made link can cause) is shown read-only with the label "From another Assembly", because Save would refuse it (6.4 step 2). The Assembly page loads Builds and Parts the same way.
1b. **Merge the handed-over Build.** `chainBuilds = mergeBuilds(fetched, location.state?.onboard?.build)` (section 7.1). This appends the onboarding Build when its key is missing from the fetched list (Jira search lag right after onboarding) and is a no-op otherwise. The same function merges the `build` returned by `POST /api/builds` after "+ New Build" or "Create Build 1". **When that create copied Parts** (`cloneFromBuildKey`), every key in the response's `linked` array is added to `linkedThisSession.get(build.key)` (section 7.2) in the same state update, so the new Build shows its copied Parts under "In Build 3" even when `GET /api/builds/HAR-2053/parts` still returns `[]`. The merged list is then passed through `overlayBuildStatus(builds, statusThisSession)` (7.1), which applies the local result of a Cut Version until a re-fetch agrees. Step 2 and the `cad=1` effect both read the merged list, and the `cad=1` effect waits until step 1b has run (it depends on a `buildsReady` flag set after the merge), so a lagging search can't produce "No Builds yet" or a skipped Update from CAD.
2. **Selected Build:** `?build` if it is in the list. Otherwise the newest Draft, then the Active one, then the highest number. Archived Builds are hidden from the picker unless they are the `?build` target.
3. **Rows** come from the pure function `deriveDesignerRows` (section 7.2). There are three groups: "New from CAD", "In Build N", and "Other Parts in this Assembly". The New group appears only after Update from CAD.
4. **Update from CAD** (`POST /api/parts/preview` with `fresh: true`, section 6.8) merges in the preview. The button always sends `fresh: true`, so it skips `BOMService`'s 60-second BOM cache and reflects a CAD edit made seconds ago. The `cad=1` run after onboarding omits it (the cache is cold for a new element anyway). The preview compares the BOM against the Parts of the whole Revision chain, so a row whose number already belongs to a Revision A Part shows as existing, not New. New rows are pre-checked. Existing Parts whose fields differ get a "Changed" status and the "Changed in CAD" detail, from the preview's `changes`. Running it again replaces the preview, but keeps edits the user typed for rows that still exist (edits are keyed by `rowId`).
5. **Save** calls `POST /api/builds/:buildKey/save` (section 6.4) with every pending, client-valid operation, **in batches of at most 25 items**, sent one after another. The save bar shows "Saving 25/60…" between batches. A batch that fails as a whole stops the run; the items of earlier batches keep their results, and the failed and unsent items stay pending. Small batches keep each request well under Node's 300-second `requestTimeout` (a create is a create call plus a link call, each with up to 3 retries) and make a dropped response cost at most 25 rows. Rows that fail the client check are listed in the save bar ("1 row needs a fix before it can save") and are not sent. Results apply per row. Rows that succeeded clear their pending flags. Failed rows keep their edits and show an inline error and a Retry button (Retry runs Save for that row only). After the save, the page re-fetches chain Parts and Build links. Two overlays cover Jira search lag until a re-fetch catches up: keys the server created stay in `createdKeys`, and every successful link (from a create, an update with `link: true`, or a link) goes into `linkedThisSession` (section 7.2), so a Part just added to Build 1 stays under "In Build 1" even when `GET /api/builds/:b/parts` doesn't list it yet.
6. **Unsaved-changes guard:** react-router `useBlocker(({ currentLocation, nextLocation }) => hasPending && currentLocation.pathname !== nextLocation.pathname)` plus `beforeunload` while pending operations exist. The blocker fires only on a path change (leaving the page, switching mode, switching Revision), so the page's own `?build`, `cad=1` and post-save `replace` navigations are never blocked. A Build switch changes only the search string, so it isn't caught by the blocker; the Build picker shows its own confirm, "Discard 2 unsaved changes?", before it calls `setSearchParams`. That way no navigation gets two prompts. The Assembly page uses the same guard.
7. **Revision chain** is loaded once and passed as `revisionChainKeys` to `POST /api/builds`. The server also derives it (section 6.3), so numbering stays continuous across Revisions (fixes HANDOFF gap 3).

How HAR-2031 gets linked: open `/a/HAR-2030/design`, click "Create Build 1", check HAR-2031 under "Other Parts in this Assembly" (label "Not in any Build"), then Save. The Save sends a single `link` operation.

### 3.5 Assembly page `/a/:key/assemble`

```
 (Assembly header as above, mode switch on "Assembly")
 Builds (?)  ┌──────────────────┬───────────────────┬────────────────────┐
             │ Build 1 Superseded│ Build 2 ● Active  │ Build 3  Draft     │   role=tablist
             └──────────────────┴───────────────────┴────────────────────┘
             ● Active = the one to build. There's always one per Revision.
┌ Build 2 · Active ────────── [OnShape version ↗] [⇄ Compare] [🖨 Print] [Clone a part] [⋯] ┐
│                                                                            ⋯ = Archive   │
│ Part                         Qty  Material   Machinery    Powdercoat Thickness  Current?  │
│ HAR-2031 VF27P-0001A Test Part [1]  PLA     [3D Printer▾]  [—]       [—]       ✓ Current  │
│ HAR-2033 VF27P-0003A Bash bar  [1] [AL 6061▾] [CNC Router▾] [Black▾]  [0.250▾] Build 3 is │
│                                                                                newer     │
│ ── Parts in other Builds, not in Build 2 (1) ──────────────────────────────────────────  │
│ HAR-2035 VF27P-0003B Bash bar 1"   in Build 3            [Move here] [Re-create here]   │
└───────────────────────────────────────────────────────────────────────────────────────────┘
 sticky save bar (only when edits exist):  Unsaved: 1 change      [ Discard ] [ Save ]
```

- The tabs follow the WAI-ARIA tabs pattern: `role="tablist"` / `tab` / `tabpanel`, `aria-selected`, roving `tabIndex`, Left/Right arrow keys. A status chip appears in each tab. Archived Builds sit behind a "Show archived (1)" toggle at the end of the strip.
- **Default tab:** `?build` if present. Otherwise the Active Build, then the highest number (today's `pickDefaultActiveBuild`).
- The rows show the in-Build Parts first. Below them, "Parts in other Builds" lists the Move and Re-create candidates. Assembly Parts that are in no Build, such as clones, appear there too, labelled "Not in any Build". Each action button carries `aria-label="Move HAR-2035 to Build 2"`.
- **Clone a part** opens a `<dialog>` with three fields: Copy from (a select of Parts), New Part name, and Quantity. Its Clone button is disabled from the click until the response arrives, so one dialog can't send two requests. On success it shows a notice: "Cloned as HAR-2040 (VF27P-0007A). It's listed under Parts in other Builds; Move it here to add it." The response carries the new Part object (section 6.9), which goes into the page's `createdParts` overlay (section 7.2), so the row is visible at once even though the chain-Parts re-fetch is a search that doesn't list it yet.
- **Move here** sends `POST /api/builds/:key/save` with `{ links: [{ ref: partKey, key: partKey }] }` (6.4), not the old `POST /api/builds/:key/parts`, so a Move gets the save endpoint's Build-type, chain-membership and `issuelinks` duplicate checks. A `results[0]` with `ok: true` adds the key to `linkedThisSession.get(buildKey)`; `ok: false` shows `results[0].error` in the action `Alert` (3.6). The old route stays on the server, unused by any page (6.7).
- **Re-create here** responds with the new Part object (6.9). The page adds it to `createdParts`, adds its key to `linkedThisSession.get(buildKey)`, and adds the source key to `recreatedThisSession` (7.2). The source row's "Re-create here" button is then disabled with the tooltip "Already re-created as HAR-2041", until a re-fetch lists HAR-2041. It is **also** disabled, with no session entry needed, on any Part for which `hasNewerRevision(part, mergeParts(parts, createdParts))` is true (7.2): another Part has the same number with a later letter. The tooltip then names that Part: "Already re-created as HAR-2041. Re-create HAR-2041 instead." The server also refuses a second Re-create of the same Part (409, 6.9), which covers a second tab.
- **Re-create where the new Part was made but its Revision link failed** (6.9, `err.body.stage === 'revises-link'`): the page adds `err.body.part` to `createdParts` and `[source → err.body.key]` to `recreatedThisSession`, and shows "Created HAR-2041, but couldn't record it as the next Revision of HAR-2035: " + `friendlyError(err)`. The new Part is not in the Build yet, so its row (under "Parts in other Builds", "Not in any Build") offers "Move here".
- **⋯ "More actions" disclosure** (`ui/DisclosureMenu`, not an ARIA menu): a `<button aria-expanded aria-controls="build-more">` with the visible label "⋯" and `aria-label="More actions for Build 2"`, which shows a `<div id="build-more">` holding ordinary `<button>`s. Tab moves through them; Esc and an outside click close it and return focus to the toggle. No `aria-haspopup`, no `role="menu"`, so no arrow-key contract is implied. The menu holds one action, **Archive Build**, with its own confirm: "Archive Build 3? It will be hidden from the Build list and marked as a dead end. This can't be undone from ValorBOM." Archived is final in the UI (Q9): there is no un-archive action anywhere, and an archived Build's tab (behind "Show archived") shows no Archive button. The disclosure stays (rather than a bare Archive button) so a destructive action is one step removed from the everyday buttons.
- **No Cut Version on the Assembly page (Q3).** Cutting a version is a CAD decision, so the button and `CutVersionDialog` exist only on the Designer. The Assembly page shows each Build's status chip in its tab and in the panel title ("Build 2 · Active"), and the "OnShape version ↗" link when the Build has one. For a Draft Build the panel shows the line "Draft: not ready to build yet. The designer cuts a version when it is." with an [Open Designer] link to `/a/:key/design?build=<key>`. The two-Active warning and its confirm-gated repair are on this page too (3.4, "Two Active Builds").
- **Edit and Save** uses the same save endpoint with `updates` only, in the same batches of 25. Failures show per row. Successful Move and Re-create results go into the page's own `linkedThisSession` overlay (section 7.2), so the moved Part stays in the Build after the re-fetch even if search lags. Re-create and Clone also put the new Part object into `createdParts`, because a linked key with no Part object has no row.
- **No Builds:** a teaching empty state: "No Builds yet. Builds are made by the designer from CAD. [Open Designer]". **Parts can't be edited on the Assembly page until a Build exists. This is intended.** Today's hub can edit Build-less Parts through `PUT /api/stories/:key`, but on the new page every edit is a save into the selected Build, and an Assembly with no Build has nothing to build from, so there is nothing for an assembly student to edit. The empty state sends them to the Designer, which creates Build 1 and edits the same Parts. `PUT /api/stories/:key` stays on the server (6.7) but no page calls it.
- **The current-build indicator** works as it does today: it uses the highest-numbered linked Build.

**Compare (`?view=compare`)** replaces the BOM panel inside the page. It is not a dialog, because a wide table needs the room.

```
┌ Compare Builds ────────────────────────────────────────────────── [← Back to BOM] ┐
│  [ Build 2 · Active ▾ ]   vs   [ Build 3 · Draft ▾ ]                               │
│ Part                         Qty   Build 2   Build 3                                │
│ HAR-2031 VF27P-0001A Test Part  1     ✓         ✓      (Same)                       │
│ HAR-2033 VF27P-0003A Bash bar 2" 1    ✓         —      Only in Build 2              │
│ HAR-2035 VF27P-0003B Bash bar 1" 1    —         ✓      Only in Build 3              │
└─────────────────────────────────────────────────────────────────────────────────────┘
```

The defaults are the selected Build vs the next-newest. The ✓ and — marks also have visually hidden text ("in Build 2" / "not in Build 2"). There is no "only show differences" toggle (not requested). Rows keep today's `BuildComparison.jsx` order: shared Parts first, then by summary.

**Print (`?view=print`)** is an on-screen preview with a "Print" button that calls `window.print()`. The `@media print` rules hide the nav, the header actions and the print button itself.

```
┌──────────────────────────────────────────────────────────────┐
│ VF27A-0000A Test Assembly — Build 2 (Active)                  │
│ Revision A · OnShape version: https://cad.onshape.com/…/v/…   │
│ Printed 2026-10-30                                            │
│ ┌─────┬─────┬──────────────────────┬────────┬──────────┬────┬────┐ │
│ │ ☐   │ Qty │ Part                 │Material│Machinery │ PC │ Th │ │
│ │ ☐   │ 1   │ VF27P-0001A Test Part│ PLA    │3D Printer│ —  │ —  │ │
│ └─────┴─────┴──────────────────────┴────────┴──────────┴────┴────┘ │
│ (Assembly instructions will appear here once they exist.)    │
└──────────────────────────────────────────────────────────────┘
```

The ☐ column is an empty checkbox for ticking parts off at the pit table. It is printed only, never interactive.

### 3.6 Error states on the Chooser, Designer and Assembly pages

Every message goes through `friendlyError(err)` (section 7.3), so the copy never shows raw axios text or the word Jira. Every `Alert` that reports a failed action uses `role="alert"`. Load failures that don't block the whole page use `role="status"` so they don't interrupt a screen reader mid-sentence. "Retry" re-runs only the failed request.

| Case | Where it shows | Copy (example) | Recovery | Screenshot |
|---|---|---|---|---|
| `GET /api/epics/:key` 404 (no such key) or 400 (bad key, or a key that isn't an Assembly, e.g. a Part key pasted into the URL) | Full-page `EmptyState` card in place of the header and body. Applies to `/a/:key`, `/design` and `/assemble`. | 404: "We couldn't find Assembly HAR-9." 400 not-an-Assembly: "HAR-2031 is a Part, not an Assembly." (server message passes through) | [Back to all Assemblies] (link to `/`). No Retry, because retrying won't change the answer. | `designer-load-404.png`, `chooser-load-404.png` |
| `GET /api/epics/:key` 5xx or status 0 | The same full-page card | "Couldn't open this Assembly: the team tracker didn't respond (503)." | [Retry] and [Back to all Assemblies] | `assembly-load-error.png` |
| A secondary load fails: chain, Builds, Assembly Parts or a Build's Parts | Inline `Alert` above the Parts table. The header still renders from the Assembly load. The Build picker (Designer) or tab strip (Assembly page) is disabled, and so are Update from CAD, Save and Cut Version, because acting on a partial list could link or create the wrong Parts. | "Couldn't load the Builds: the team tracker didn't respond (503)." | [Retry] re-runs the failed loads, then load steps 1b and 2. | `designer-builds-load-error.png` |
| Update from CAD fails (OnShape error, or `_parseBOM`'s "BOM table is missing required columns…" 500) | Inline `Alert` directly under the Update from CAD button | "Couldn't read Parts from CAD: OnShape didn't respond (502)." / "Couldn't read Parts from CAD: BOM table is missing required columns: Revision." | Existing rows and any edits stay. The button is re-enabled, which serves as the retry. | `designer-cad-error.png` |
| "+ New Build" or "Create Build 1" fails (`POST /api/builds` 4xx/5xx) | Error text inside the `NewBuildForm` (or under the empty-state button), linked with `aria-describedby` to the Create button | "Couldn't create Build 3: the team tracker didn't respond (503)." | The form stays open with its values, and the button is re-enabled. | `designer-new-build-error.png` |
| "+ New Build" with copy succeeds but `cloneError` is set or `failed[]` is non-empty | The new Build is merged (step 1b) and selected. A warning `Alert` appears at the top of the Build panel. | "Build 3 was created, but 2 Parts weren't copied: HAR-2031, HAR-2032. Add them from Other Parts in this Assembly." (`cloneError` with nothing linked: "Build 3 was created, but its Parts couldn't be copied: …") | The Parts are visible under "Other Parts in this Assembly", where the student ticks them and saves (a `links` save). | `designer-new-build-clone-partial.png` |
| Move, Re-create, Clone or Archive fails (Assembly page) | Inline `Alert` at the top of the Build panel. It replaces today's `actionMsg` line. | "Couldn't move HAR-2035 to Build 2: the team tracker didn't respond (503)." (Move is a save: a whole-request failure uses `friendlyError(err)`, a per-item `ok: false` uses `results[0].error`.) | The row's buttons, or the dialog's buttons for Clone and Archive, are re-enabled. A Clone or Archive dialog stays open and shows the error inside it as well. | `assembly-action-error.png` |
| Cut Version fails (Designer only; the Assembly page has no Cut Version) | Inside `CutVersionDialog`, which stays open | "Couldn't cut the version: OnShape didn't respond (502)." When the OnShape version was made, the copy depends on `err.body.cutStage` (6.9): `link` (the Build's OnShape version link wasn't saved): "The OnShape version was made, but Build 1 couldn't be updated: the team tracker didn't respond (503). Try again." `transition` (link saved, Build still Draft): "The OnShape version was made, but Build 1 couldn't be marked Active: …. Try again; it will reuse that version." `supersede` (Build 1 is Active, an older Build is still Active): "Build 1 is now Active, but Build 2 couldn't be marked Superseded: …. Try again to finish; it won't make a new version." For `supersede` the page also records Build 1 as Active (3.4, two-Active repair). | [Cut Version] re-enabled (labelled "Try again") | covered by `designer-cut-version-confirm.png`'s error variant `designer-cut-version-error.png` |
| Cut Version answers 409 (the Build is Superseded or Archived, or Active with no OnShape version link of this document; 6.9 step 2) | Inside `CutVersionDialog` | "Build 1 has already been cut." | [Close]. The page records `err.body.buildStatus` in `statusThisSession` when present (never `err.body.status`, which is 409) and re-fetches Builds, so the button becomes "Already cut". | `designer-cut-version-already-cut.png` |
| Two-Active repair answers 409 (both pages; the chosen Build is no longer Active with this document's link; 3.4 step 4) | Inside the repair confirm `Dialog` | "Build 1 is no longer Active; nothing to fix." | [Close]. The page records `err.body.buildStatus` when present and re-runs the by-key status check (6.10), which normally hides the warning. | `designer-two-active-repair-409.png`, `assembly-two-active-repair-409.png` |
| Two-Active status check fails (both pages; `GET /api/builds/status`, 3.4 step 2) | A `role="status"` line at the top of the Build panel; no warning and no repair button | "Couldn't check whether Build 1 and Build 2 are both Active." | [Check again] re-runs only the status check. | covered by the `designer-two-active-stale.png` and `assembly-two-active-stale.png` variants |
| Re-create answers 409 (already re-created) | Inline `Alert` at the top of the Build panel | "HAR-2035 was already re-created as HAR-2041. Re-create HAR-2041 instead." | The page re-fetches Parts; the source row's button stays disabled (`hasNewerRevision`, 7.2). | covered by `assembly-action-error.png` variants |
| Re-create: new Part made, Revision link failed (`err.body.stage === 'revises-link'`) | Inline `Alert` at the top of the Build panel | "Created HAR-2041, but couldn't record it as the next Revision of HAR-2035: the team tracker didn't respond (503)." | The new Part's row offers "Move here"; the source row's Re-create is disabled. | `assembly-recreate-link-failed.png` (INC-7) |
| Save: the whole request fails (a 400 from structural validation, a non-Build key, or a step-2 read failure) | `Alert` in the sticky save bar | "Couldn't save: the team tracker didn't respond (503). Nothing was changed." | Every pending edit is kept; [Save] re-enabled. | `designer-save-error.png` |
| Save: per-item failures | Per row (section 3.4 wireframe) | from `results[].error` | Per-row [Retry] | `designer-save-partial-failure.png` (already listed) |

## 4. Visual system

### 4.1 Direction and justification

I keep the dark background with gold accents. That is the Valor 6800 identity, the existing CSS already has it, and the purchasing and receiving pages depend on it. "Modern" here means four changes:

1. One consistent spacing and type scale instead of ad-hoc rem values.
2. Fewer boxes: page sections are separated by headings and whitespace, and cards are kept for real groupings.
3. Gold is used only for the primary action, focus and "Active". Today it also decorates links, icons and headers, so it means nothing.
4. Visible focus rings and 44 px touch targets for tablets in the pit.

**Extend the hand-written CSS with tokens; no framework.** Tailwind, MUI or Chakra would mean rewriting every page, purchasing and receiving included, plus a build-step dependency. That is the "heavy UI framework" the constraints rule out. Native `<dialog>` covers the modal needs. I considered Radix and Headless UI for dialogs and menus and rejected them: one dependency for two widgets, when the native element handles focus and Esc.

### 4.2 Tokens (added to `:root` in `index.css`)

The old `--color-*` variables stay, so every existing rule keeps resolving. INC-5 rewrites them as aliases where the new token has the **same** value, and leaves the rest as literals:

| Old variable (value today) | Becomes | Colour change? |
|---|---|---|
| `--color-gold` (#eea608), `--color-gold-light` (#f5c842), `--color-gold-dark` (#cc9007) | `var(--accent)`, `var(--accent-hover)`, `var(--accent-press)` | none |
| `--color-bg` (#111827) | `var(--surface-1)` | none |
| `--color-surface` (#1f2937) | `var(--surface-2)` | none |
| `--color-surface-hover` (#374151) | `var(--surface-3)` | none |
| `--color-border` (#374151) | stays `#374151` (new components use `--border`) | none |
| `--color-text` (#f3f4f6) | `var(--text)` | none |
| `--color-text-muted` (#9ca3af) | `var(--text-muted)` | **#9ca3af → #a3acb9**, the one deliberate change (7.0:1 → 7.7:1 on #111827; both pass AA, the lighter one reads better on a tablet in a bright pit) |
| `--color-text-dim` (#6b7280) | `var(--text-disabled)` | none |
| `--color-green-*`, `--color-yellow-*`, `--color-blue-*`, `--color-red-*`, `--color-black`, `--color-white`, `--radius`, `--radius-lg` | unchanged literals | none |

Two shared rules change on purpose and affect every page, purchasing and receiving included. `body` and `.app-wrapper` move from `var(--color-bg)` to the darker page token `var(--bg)` (#0b1220), so cards on `--surface-1` stand out from the page. Muted text gets the lighter grey above. Everything else on the purchasing and receiving pages keeps its current colours. The INC-5 screenshots of those pages (section 12) show the result. No existing variable name is given a different meaning: before adding a token, INC-5 greps `index.css` for the name, and any clash gets a new name instead (this is why the radius scale is `--r-*`, since `--radius-lg` already exists with a different value).

```css
:root {
  /* surfaces (elevation goes lighter) */
  --bg:            #0b1220;   /* page */
  --surface-1:     #111827;   /* sections, cards */
  --surface-2:     #1f2937;   /* raised: dialogs, menus, table header */
  --surface-3:     #374151;   /* hover, selected row */
  --border:        #2b3544;
  --border-strong: #4b5563;
  /* text: contrast vs --surface-1 (#111827), computed */
  --text:          #f3f4f6;   /* 16.1:1 */
  --text-muted:    #a3acb9;   /* 7.7:1  (new BOM text uses this, never #6b7280, which is 3.7:1 and fails AA) */
  --text-disabled: #6b7280;   /* disabled controls only (exempt from 1.4.3) */
  /* brand */
  --accent:        #eea608;   /* 8.5:1 on surface-1; text on accent uses --on-accent */
  --accent-hover:  #f5c842;
  --accent-press:  #cc9007;
  --accent-soft:   rgba(238,166,8,.14);
  --on-accent:     #111827;   /* 8.5:1 on gold */
  /* status (text colors all ≥ 7.7:1 on surface-1) */
  --success: #86efac; --success-soft: rgba(22,163,74,.18);
  --warning: #fde047; --warning-soft: rgba(202,138,4,.18);
  --danger:  #fca5a5; --danger-soft:  rgba(220,38,38,.18); --danger-solid: #dc2626;
  --info:    #93c5fd; --info-soft:    rgba(37,99,235,.18);
  /* spacing (4px base) */
  --space-1: .25rem; --space-2: .5rem; --space-3: .75rem; --space-4: 1rem;
  --space-5: 1.5rem; --space-6: 2rem;  --space-7: 3rem;
  /* type */
  --font-sans: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  --font-mono: ui-monospace, "SF Mono", Menlo, Consolas, monospace;
  --text-xs: .75rem; --text-sm: .875rem; --text-md: 1rem; --text-lg: 1.25rem;
  --text-xl: 1.5rem; --text-2xl: 2rem;
  --leading: 1.5;
  /* shape and depth */
  /* new scale uses the r- prefix: index.css:31 already defines --radius-lg: 0.5rem,
     which purchasing/receiving use; it is left untouched */
  --r-sm: .375rem; --r-md: .5rem; --r-lg: .75rem; --r-pill: 999px;
  --shadow-1: 0 1px 2px rgba(0,0,0,.4);
  --shadow-2: 0 8px 24px rgba(0,0,0,.45);
  /* interaction */
  --focus-ring: 0 0 0 2px var(--bg), 0 0 0 4px var(--accent);
  --tap-min: 2.75rem;  /* 44px */
  --dur: 120ms;
}
```

The contrast ratios above were computed with the WCAG relative-luminance formula for these hex values. INC-5 re-checks them with axe (section 13).

New components use `--r-sm`/`--r-md`/`--r-lg`/`--r-pill`; existing rules that use `--radius-lg` keep it.

### 4.3 Component styling rules

- **Buttons:**
  - `primary` is a gold fill with `--on-accent` text. There is at most one per region.
  - `secondary` is `--surface-2` with a border.
  - `ghost` is text only, for toolbars.
  - `danger` uses a red outline, with a solid fill only inside its confirm dialog.
  - Every button has a `min-height: var(--tap-min)` and a `:focus-visible { box-shadow: var(--focus-ring) }`. A disabled button gets `--text-disabled` and `cursor: not-allowed`, and it stays focusable through `aria-disabled` where a tooltip explains why.
- **Inputs:** `--surface-2` background, a 1 px `--border`, a gold focus ring, a visible `<label>`, and help text linked with `aria-describedby`. Errors use `aria-invalid` and a message in `--danger`.
- **Part numbers and keys** use `--font-mono` with `font-variant-numeric: tabular-nums`, so columns line up.
- **Status chips** (`Badge`): pill shape, `--text-xs`, uppercase. Colour is never the only signal, because every chip shows its word.
  - Build: Draft = info-soft. Active = accent-soft with a ● and the text "Active". Superseded = neutral. Archived = disabled.
  - Part row: New = success-soft. Changed = warning-soft. In Build = neutral. Saved = success-soft with a ✓. Error = danger-soft.
- **Tables:** row height ≥ 44 px, a sticky header, a sticky first column (Part) when the table scrolls sideways, and group-header rows (`<tr><th colspan scope="colgroup">`).
- **Motion:** only a `--dur` fade on dialogs and menus, disabled under `prefers-reduced-motion`.

### 4.4 Responsive (laptop and tablet)

The breakpoints are `≥1280` (laptop, content max 80 rem), `768–1279` (tablet landscape and portrait), and `<768` (phone; it should work, but it isn't optimized for).

- **Tablet:** the header actions wrap under the title. The Build picker scrolls sideways with snap points. Parts tables keep every column with sideways scroll and a sticky Part column, and Qty inputs stay at least 3 rem wide. Result-card actions stay inline on tablet and move below the title under 640 px.
- **Sticky save bar:** `position: sticky; bottom: 0`, so the on-screen keyboard doesn't cover it on iPad.

### 4.5 Words and guidance

- The UI uses only Assembly, Build, Part and Revision. Words that must not appear on screen: Epic, Epic Link, issue, issue type, custom field, story, Jira. The system is called "the team tracker" in all copy, including error text. Error copy is chosen from structured data, never by matching message text:
  - **Server, whole-request errors:** `errorHandler` adds `source: 'tracker'` when `err.name === 'JiraApiError'` and `source: 'onshape'` when `err.name === 'OnshapeApiError'`. Other errors get no `source`. Both client error classes already set `name` (`jiraClient.js:23`, `onshapeClient.js:23`).
  - **Server, per-item errors** (`saveBuildParts`, `cloneBuildParts`, the onboarding `buildError`): the `error` string is built with `describeUpstreamError(err)` from the new `src/server/utils/upstreamError.js`, and the item also carries `status: err.status ?? null` and `source`. The function returns "the team tracker didn't respond (503)" for a `JiraApiError` with status ≥ 500 or 0 (shown as "(no connection)" for 0), "the team tracker refused the change (400)" for a `JiraApiError` 4xx, "OnShape didn't respond (502)" for any `OnshapeApiError`, and `err.message` otherwise (our own `HttpError` and validation messages are already student copy). Callers prefix it: "Created, but not added to Build 1: the team tracker didn't respond (503)."
  - **Client:** `friendlyError(err)` in `lib/friendlyError.js` branches on `err.body?.source` and `err.status`. Tracker 5xx or 0 gives "The team tracker didn't respond (503)."; tracker 4xx gives "The team tracker refused the change (400)."; any OnShape error gives "OnShape didn't respond (502)."; a non-`ApiError` (fetch threw, so the local server is unreachable) gives "Couldn't reach ValorBOM. Is the server running?"; anything else returns `err.message` unchanged. Callers add the action prefix ("Couldn't load Assemblies: …"). `fullPartNumber` shows as "number". A Jira key shows as the key itself (e.g. HAR-2031), linking to the tracker with `title="Open in the team tracker"`.
- **GlossaryTerm "?"** is a toggletip: a 24 px circular `<button type="button" aria-expanded aria-controls="gloss-build" aria-label="What is a Build?">` placed after the word, and a sibling `<span id="gloss-build" role="status">` that is empty when closed and holds one sentence from the field guide when open (so screen readers announce it on open). No `role="tooltip"`. Esc or a click outside closes it. The button has a 44 px hit area through padding, even though it draws at 24 px. It appears once per page per word: on the heading where the word first appears. The definitions:
  - Assembly: "A mechanism that does one job, like the intake."
  - Build: "One specific combination of Parts for an Assembly, like the 1-inch vs 2-inch bash bar version."
  - Part: "One physical piece. It can be reused across Builds, or redesigned when a Build needs something different."
  - Revision: "The same Assembly, reworked significantly. Rare. Most Assemblies stay on Revision A."
- The teaching empty states are the ones drawn above: Home with no Assemblies, the Designer with no Builds, the Designer with exactly 1 Build (the "+ New Build" hint), and the Assembly page with no Builds. Each one is at most two sentences.

## 5. Component inventory

| Component | Fate | Notes |
|---|---|---|
| `ui/Alert`, `ui/Select`, `ui/ComboBox`, `ui/SignInRequired` | Reused, restyled via tokens | `ComboBox` and `SignInRequired` are used by purchasing and receiving; no API change. |
| `ui/InlineSelect` | Reused, extended | Adds an optional prop `extraOption: { value, label }`. When present it renders first as `<option value={value}>{label}</option>`, so an unlisted CAD value such as "Steel" shows as "Steel — pick a material" instead of the browser silently displaying the first option. Callers that don't pass it behave exactly as today. |
| `ui/Button` | Reused, extended | Adds the `ghost` variant and `aria-disabled` support; existing variants keep their names. |
| `ui/Badge` | Reused, extended | Adds `Changed`, `In Build`, `Saved`, `Error`, `Not in any Build`. Only BOM components use Badge (grep: `PartRow`, `BuildTabs`, `HubPartRow`), so `Changes`/`Updated` are renamed outright. |
| `ui/Card` | Reused, fixed | Today the whole header `div` is clickable (`onClick` toggles), which keyboards can't reach, and `headerRight` sits inside it. **Four callers pass `collapsible`:** `purchasing/VendorGroup.jsx`, `purchasing/BudgetPanel.jsx`, `receiving/ReceivingGroup.jsx`, `receiving/UnmatchedPanel.jsx`, and `VendorGroup`'s `headerRight` holds the funding-source `<select>` (it currently uses `stopPropagation` on its `<label>` to avoid collapsing). New markup: `<div className="card-header no-print"><div className="card-header-inner"><h2 className="card-title">{collapsible ? <button type="button" className="card-toggle" aria-expanded={!collapsed} aria-controls={bodyId}>{icon && <span className="card-title-icon">{icon}</span>}{title}<span className="card-collapse-icon" aria-hidden="true">{collapsed ? '▼' : '▲'}</span></button> : <>{icon && <span className="card-title-icon">{icon}</span>}{title}</>}</h2><div className="card-header-right">{headerRight}</div></div></div>`, followed by `<div id={bodyId} hidden={collapsed}>{!collapsed && children}</div>` with `bodyId` from `useId()`. The existing `no-print`, `card-header-inner`, `card-title-icon` and `card-collapse-icon` classes are kept, so print views and current layout rules still apply. The body wrapper is always in the DOM, so `aria-controls` always resolves, while collapsed children stay unmounted as today. `card-header-clickable` is dropped, since the header itself is no longer clickable. The header `div` has **no** `onClick`, and `headerRight` is a **sibling** of the toggle button, never inside it, so no interactive control is nested in a `<button>`. The props and the four callers are unchanged; `VendorGroup`'s `stopPropagation` becomes harmless and stays. The chevron moves from the right side to after the title. |
| `ui/Dialog` | **New** | Wraps `<dialog>`: `open`, `onClose`, `title`, `description`, `initialFocusRef`. Restores focus on close. |
| `ui/GlossaryTerm` (toggletip, section 4.5), `ui/EmptyState`, `ui/StickySaveBar`, `ui/DisclosureMenu` (section 3.5) | **New** | Small and presentational. |
| `layout/AppNav`, `layout/AppLayout` | Reused, changed | INC-5 adds a skip link ("Skip to content") and a `<main id="main">` and restyles; `NAV_ITEMS` stay as they are. INC-8 replaces `NAV_ITEMS` (section 2). |
| `parts/PartRow` | **Replaced** by `designer/DesignerPartRow` | The new row has group-aware status, a per-row error and Retry, a `rowId` key, and an editable Material select (section 3.4). It does **not** carry over the "STEP auto-export" label (`partRules.isStepAutoExport`), because no save path calls `/api/parts/auto-export` and the label promises something that doesn't happen. `isStepAutoExport` is deleted with `PartRow` in INC-9 if nothing else imports it. |
| `hub/HubPartRow` Material cell | Changed when moved | Material becomes an `InlineSelect` over `MATERIALS` with the same unlisted-value handling as the Designer. |
| `parts/DuplicateWarning`, `parts/UnidentifiedPartsWarning`, `parts/partRules.js` | Reused | Restyled. |
| `parts/PartsTableToolbar` | **Deleted** (INC-9) | Its actions move into the Designer header and the save bar. |
| `hub/HubPartRow` | Reused, moved to `assembly/AssemblyPartRow` | Accessible button labels; candidate rows render in their own section. |
| `hub/BuildTabs` | Reused, moved to `assembly/BuildTabs` | ARIA tabs pattern and an archived toggle. |
| `hub/BuildComparison` | Reused, moved to `assembly/BuildCompare` | Now a view instead of a collapsible card; hidden text for ✓/—. |
| `hub/HubPrintView` | Reused, moved to `assembly/PrintView` | On-screen preview plus print CSS; adds the tick column. |
| `home/AssemblySearch`, `home/AssemblyResultList`, `home/OnboardBox`, `home/OnboardDialogs`, `home/ChooserDialog` | **New** | |
| `assembly-shared/AssemblyHeader`, `assembly-shared/ModeSwitch` | **New** | Used by both work pages. |
| `builds/BuildPicker`, `builds/NewBuildForm`, `builds/CutVersionDialog`, `builds/TwoActiveWarning` | **New** | `CutVersionDialog` is used on the Designer only (Q3). `NewBuildForm` has the optional "What's different?" description field (3.4, Q2). `TwoActiveWarning` (the Alert, the by-key status check, the repair buttons and the repair confirm `Dialog`, 3.4) is built in INC-6 and used by both the Designer and the Assembly page (INC-7). |
| `designer/DesignerPartsTable` | **New** (replaces the old one) | Local state, groups, per-row results. |
| `pages/HomePage`, `pages/ChooserPage`, `pages/DesignerPage` (rewritten), `pages/AssemblyPage` | **New** | |
| `pages/DashboardPage`, `pages/AssemblyBomPage`, `pages/AssemblyHubPage`, `components/AssemblySelection`, `components/BuildSelection`, `components/PartsListTable`, `components/DesignerPartsTable` (old) | **Deleted** (INC-9) | Deleted only after a `grep` shows no imports remain. |
| `store/assemblySlice.js`, `store/partsSlice.js`, `store/buildSlice.js` | **Deleted** (INC-9) | Only the deleted components use them. `store/index.js` keeps purchasing and receiving. |
| `lib/designerRows.js`, `lib/designerSave.js`, `lib/buildNames.js`, `lib/partValidation.js`, `lib/friendlyError.js` | **New** | Pure functions with Jest tests (section 7). |
| `api/client.js` | Changed | INC-5 adds `export class ApiError extends Error { constructor(message, status, body) { super(message); this.name = 'ApiError'; this.status = status; this.body = body; } }`. `request()` throws `new ApiError(body.error \|\| \`Request failed: ${res.status}\`, res.status, body)` for every non-OK response except 401/403, which keep throwing `AuthRequiredError` unchanged (purchasing and receiving depend on it). Existing callers that read only `err.message` keep working because `ApiError` is an `Error`. INC-5 also adds `searchAssemblies`, `previewOnboarding`, `onboardAssembly`, `saveBuildParts`, and `fetchChainParts(key)` (`GET /api/stories?key=…&chain=1`); `previewParts(params)` passes an optional `params.fresh` through in the body. `cutBuildVersion(buildKey, payload)` is unchanged in code; its JSDoc becomes `{ assemblyKey }`, because the server ignores the OnShape ids (6.9). INC-6 adds `fetchBuildStatuses(keys)` for `GET /api/builds/status` (6.10). `linkPartToBuild` stays but no new page calls it (Move uses `saveBuildParts`, 3.5). INC-9 removes `fetchEpics`, `createEpicFromURL` and `uploadSelectedParts`. |

## 6. API: new and changed endpoints

All routes stay on the existing ungated BOM surface (section 10), are thin `asyncHandler` wrappers, and validate with `badRequest()`. Error responses use the existing `errorHandler` shape `{ error, status }`. Key format everywhere: `KEY_RE = /^[A-Z][A-Z0-9_]*-\d{1,7}$/`, plus a check that the project prefix equals `PROJECT_KEY`. Both live in a new `validateIssueKey(key)` in `src/server/utils/validators.js`. It reads the project **at call time** (`process.env.PROJECT_KEY ?? process.env.JIRA_PROJECT ?? 'VAL'`, the same expression `PartService.getStory` uses), not at module load, so tests and the fixture generator can set `PROJECT_KEY` after import. Every key still goes through `sanitizeJQL` before it is interpolated into JQL.

Error status: `errorHandler` sends `err.status || 500`. A Jira 5xx keeps its status (a Jira 503 reaches the client as 503); a network failure (`JiraApiError` with status 0) becomes 500. Nothing in this design maps errors to 502, and no test asserts 502 (the "(502)" in copy examples is whatever status OnShape returned).

**Error body and `HttpError` (INC-2).** `HttpError`'s constructor becomes `new HttpError(status, message, details?)`, storing `details` (a plain object) on `this.details`. `badRequest(message, details?)` passes `details` through, and a new `conflict(message, details?)` returns a 409. `errorHandler` sends `{ ...(err.details ?? {}), error, status, ...(source && { source }) }`, with `error`, `status` and `source` spread last so `details` can never overwrite them. `source` is the tracker/onshape marker defined in section 4.5. The response stays backward compatible: existing callers read only `error` and `status`.

**Reserved detail keys.** `error`, `status` and `source` must never be used as `details` keys, because the spread order above silently replaces them; a detail that means "a Build's status" is named `buildStatus`. `HttpError`'s constructor enforces this in code: a `details` object holding any reserved key throws a plain `Error("HttpError details may not use reserved key 'status'")`, so the mistake fails the first test that hits it instead of shipping. Code that adds details to an upstream error (`err.details = { ...err.details, … }` in 6.9) uses only the keys named there. Tests (`middleware.test.js`): `conflict('x', { buildStatus: 'Active' })` gives a body with `status: 409` and `buildStatus: 'Active'`; `conflict('x', { status: 'Active' })` throws at construction.

### 6.1 `GET /api/epics/search?q=<text>&limit=<n>&includeClosed=1` (new)

The route is registered **before** `GET /api/epics/:key`; otherwise `:key` would capture `search`.

Validation:

- `q` is optional. If it is not a string (an array from a repeated parameter), the response is 400 "q must be a single string". The server strips control characters and trims; after that, a length over 100 gives 400 "Search is limited to 100 characters". An empty string means "list everything".
- `limit` is optional, an integer from 1 to 50, default 50. Anything else gives 400.
- `includeClosed` is optional: absent or `"0"` means off, `"1"` means on. Any other value (including a repeated parameter) gives 400 "includeClosed must be 0 or 1". The client sends it only when the Home toggle is on (Q8).

**Approach: server-side match over the open-Assembly set.** The live probe showed JQL text search can't match bare numbers ("0000") or season words ("facility 2027"), and requirement 1 needs both. The set is small and bounded. It is one project, one issue type, open status only, and 6 issues today. A season of FRC work is a few dozen; across several years it is low hundreds. The JQL fetches only 9 fields, so even 500 Assemblies is 10 pages of 50 small rows on the server and one ≤50-row response to the browser.

Thousands of Assemblies never reach the client, and the matching rules (section 3.1.1) are exact and testable instead of depending on Lucene tokenization. JQL still does the narrowing it is good at: `project`, `issuetype`, `status`, the field list. The direct key lookup uses `getIssue`, because JQL `key = X` returns 400 for a key that doesn't exist.

Rejected alternatives:

- **Pure JQL** `summary ~ "q*"`: fails on bare numbers and season words.
- **A client-side list of everything:** the constraint rules it out, and it would ship every Assembly to every tablet.
- **A server cache:** a freshly onboarded Assembly would be missing for the cache lifetime. A cache can be added later if Jira latency hurts.

`EpicService.searchAssemblies(query, { limit, includeClosed = false })`:

1. Run `jql = project = ${P} AND issuetype = Assembly AND status not in (Closed, Finished) ORDER BY created DESC`; when `includeClosed` is true the `status not in (Closed, Finished)` clause is dropped (the JQL is otherwise identical, so the set grows only by closed Assemblies). Each result carries `closed: true` when its `status.name` is `Closed` or `Finished`, else `false`; the client shows the "Closed" chip from it (3.1). with `fields: ['summary','status','created','customfield_10104','customfield_10500','customfield_10300','customfield_10301','customfield_10302','issuetype']`.
2. If `q` is key-shaped (case-insensitive), upper-case it (`har-2030` → `HAR-2030`) and run it through `validateIssueKey`. If it passes and its prefix is the project, `getIssue(KEY)` in parallel. On 404 there is no extra hit. The hit counts only if `issuetype.name` is `Epic` or `Assembly`. Other errors from this lookup are logged with `console.warn` and do not fail the search.
3. Map each issue through `toAssembly(issue)` (below), filter with `matchAssembly(assembly, tokens)` and rank with `rankAssembly`. All three are pure, in the new `src/server/utils/assemblySearch.js`. **Merge the step-2 hit by `key`:** if the key is already among the list matches (an open Assembly whose key is in its own haystack), the list copy is kept and the direct hit is dropped; the direct hit is added only when its key isn't in the list, which is the Closed-Assembly case. It is ranked like any other match (100 for the exact key). Then count `total` and slice to `limit`. Test: `har-2030` gives `total: 1` and one result.
4. If the main search fails, the error propagates with its own status (Jira 5xx passes through; a network failure is 500), and the client shows "Search failed" with Retry.

Response 200:

```json
{
  "query": "0000",
  "total": 1,
  "results": [{
    "key": "HAR-2030",
    "summary": "VF27A-0000A Test Assembly",
    "name": "Test Assembly",
    "numbered": true,
    "fullPartNumber": "VF27A-0000A",
    "partNumber": "0000",
    "revision": "A",
    "seasonType": "F", "year": "27",
    "seasonCode": "VF27", "seasonLabel": "Facility 2027",
    "status": "New",
    "closed": false,
    "created": "2026-10-29T20:15:40.000+0000",
    "documentId": "8c64dfdcb66184646a7a3f17",
    "workspaceId": "82f00d3cbea6901ac26040bd",
    "elementId": "faea62821490977c33bc8d7c",
    "onshapeUrl": "https://cad.onshape.com/documents/8c64…/w/82f0…/e/faea…",
    "score": 80
  }],
  "groups": null
}
```

When `q` is empty, `groups` is `[{ "label": "Facility 2027", "seasonCode": "VF27", "keys": ["HAR-2030","HAR-1984","HAR-1983"] }, …, { "label": "Other", "seasonCode": null, "keys": [...] }]` in display order, and `results` holds them in that same order, capped at `limit`. Semantics: `total` is the number of matches **before** slicing to `limit`; `groups[].keys` lists only keys that are present in `results` (a group whose members were all cut off is omitted); group counts shown in the UI are `keys.length`. When `total > results.length`, the page shows the "Showing 50 of N" line under the list.

**`toAssembly(issue)`** gives the one shared Assembly shape. `getEpicByKey` uses it too.

- `parsed = applyPartMask(summary) ?? applyTitleMask(summary)`. `numbered = !!parsed && parsed.isEpic`.
- The season comes from `parsed`, or else from the loose `/^V([RF])(\d{2})/` on the summary, so `VF27-0200 Tooling` still groups under Facility 2027.
- `revision` is `customfield_10500`, else `parsed.version`, else `null`.
- `name` is `parsed.name` when numbered, otherwise the summary.
- `onshapeUrl` is built from `onshapeClient.baseUrl` when all three ids are present, otherwise `null`.

### 6.2 `GET /api/epics/:key` (changed)

It now returns `toAssembly(issue)` for **any** issue whose type is Epic/Assembly, numbered or not. If the type is anything else the response is still 400 "\"HAR-2031\" is not an Assembly". Today it drops non-conforming summaries and accepts any type that happens to parse, so a Part key returns a Part as if it were an Assembly. The key is validated with `validateIssueKey`, and a bad key gives 400. Jira's 404 is passed through as a 404, with the message "No Assembly HAR-9 found". `_parseEpics` stays for the legacy `GET /api/epics?seasonType` until INC-9 removes it.

### 6.3 `POST /api/builds` (changed)

The request `{ assemblyKey, name, description?, revisionChainKeys?, cloneFromBuildKey? }`. Validation:

- `assemblyKey` is required and must pass `validateIssueKey`.
- `name` is a required string, trimmed, 1 to 80 characters, with no control characters.
- `description` (Q2) is optional. When present it must be a string; it is trimmed and internal whitespace is collapsed to single spaces; after that it may be empty (treated as absent) or 1 to 60 characters, with no control characters. A non-string, an over-long value or a control character gives 400 naming `description`.
- `revisionChainKeys` is an optional array of at most 50 strings, each passing `validateIssueKey`.
- `cloneFromBuildKey` is optional and must pass `validateIssueKey`.

Any failure gives 400 naming the field.

Service changes in `BuildService.createBuild`. The signature becomes `createBuild({ assemblyKey, revisionChainKeys, name, description, cloneFromBuildKey })` and returns the Build object. The summary becomes `` `${name} Build ${buildNumber}` `` plus `` ` - ${description}` `` when `description` is non-empty (today's line 89 of `buildService.js` is the only place it is built). `customfield_10501` still receives the numeric `buildNumber`, which stays the only source `_parseBuild` reads it from, so a description can never change a Build's number. Onboarding's Build 1 (6.6) passes no description. When `cloneFromBuildKey` is set, `createBuild` only **validates** the source (below) before it creates anything; it never copies Parts. The route does the copy afterwards:

```js
const build = await buildService.createBuild({ assemblyKey, revisionChainKeys, name, cloneFromBuildKey });
let linked = [], failed = [], cloneError = null;
if (cloneFromBuildKey) {
  try { ({ linked, failed } = await buildService.cloneBuildParts(cloneFromBuildKey, build.key)); }
  catch (err) { cloneError = describeUpstreamError(err); console.warn('[builds] clone into', build.key, 'failed:', err.status, err.message); }
}
res.json({ build, linked, failed, cloneError });
```

- **The chain is derived on the server.** When `revisionService` is injected (it is in `index.js`), `chain = union(revisionChainKeys ?? [], await revisionService.getRevisionChain(assemblyKey))`. The Revises chain is the Jira-side invariant, so the server owns it. A union can only raise the next number, never reuse one, so a stale client copy can't make a duplicate number. The Designer still sends its loaded chain.
- **It returns the Build object,** not just `{ key, buildNumber }`: `{ key, summary, assemblyKey, buildNumber, status: 'Draft', onshapeVersionLink: null }`. The client can then select the new Build even when Jira search hasn't indexed it yet. Draft is the workflow's initial status (HANDOFF).
- **Clone is no longer all-or-nothing.** The route calls `cloneBuildParts` inside a try/catch and responds 200 with `{ build, linked: string[], failed: [...], cloneError: string|null }` (code above). Today a clone failure throws after the Build exists, which is the same half-state pattern as B2. The service's `cloneBuildParts` keeps going past per-Part link failures and returns `{ linked, failed: [{ partKey, error, status, source }] }`, with `error` from `describeUpstreamError`. It still throws when reading the source Build's Parts fails, which the route turns into `cloneError`.

- **Clone source must belong to this Assembly's chain.** When `cloneFromBuildKey` is set, the service first reads it with `getIssue(cloneFromBuildKey, { fields: ['issuetype', 'customfield_10110'] })`, before creating anything. If the type isn't Build, or its Epic Link isn't in `chain`, the call fails with **400** "\"HAR-77\" isn't a Build of this Assembly" and no Build is created. The invariant "Parts never span Assemblies" (HANDOFF) is owned by the server here, since a crafted request could otherwise copy another Assembly's Parts. A Jira 404 on the source becomes the same 400.

Response 200: `{ "build": { …Build }, "linked": ["HAR-2031"], "cloneError": null, "failed": [] }`. The response shape changes. The only other caller is the legacy `BuildSelection.jsx:55` (reads `result.key`) on `/designer`. That page is already non-functional (`selectBuild` is undefined because `createBuildSlice` isn't spread into the store, section 1), so INC-3's shape change breaks nothing that works today, and INC-6 replaces `/designer` with a redirect.

### 6.4 `POST /api/builds/:key/save` (new; fixes B2 on the server)

One Designer or Assembly-page Save.

```json
{
  "creates": [{ "ref": "VF27P-0004A", "summary": "VF27P-0004A Spacer", "revision": "A",
                "quantity": 4, "material": "PETG-CF", "machinery": "3D Printer",
                "powdercoat": "None", "thickness": "None" }],
  "updates": [{ "ref": "HAR-2031", "key": "HAR-2031",
                "quantity": 3, "material": "PLA", "machinery": "3D Printer",
                "powdercoat": "None", "thickness": "None", "link": true }],
  "links":   [{ "ref": "HAR-2033", "key": "HAR-2033" }]
}
```

Validation is split in two, so one bad row can't block a whole Save.

**Structural validation at the route** (badRequest 400, before any Jira call, nothing written). These are errors only a buggy or crafted client can produce:

- `:key` passes `validateIssueKey`.
- The body is an object with `creates`, `updates` and `links`, each an optional array, at most 200 items in total, and at least 1 item in total. Each item is an object.
- `ref` on every item is a non-empty string of at most 40 characters, unique across the whole request.
- **Each create:** `summary` is a string of at most 255 characters that passes `applyPartMask` with `isEpic === false` ("summary must start with a Part number like VF27P-0001A"). `revision`, if present, is a string.
- **Each update:** `key` passes `validateIssueKey`; `link`, if present, is a boolean. A `summary` on an update is **ignored** (not rejected, so an older client still works). The server always writes the stored summary (step 4), so a Save can never renumber or rename a Part. The Designer and Assembly page never edit names, and `compareBOMWithJira` doesn't diff them, so nothing is lost.
- **Each link:** `key` passes `validateIssueKey`.
- Errors are reported with their path, as `creates[2].summary: summary must start with a Part number like VF27P-0001A`.

**Field-value validation per item, in the service** (`ok: false` result for that item, no Jira call for it, the other items go ahead). These are problems a student can cause and fix on screen:

- `material`, `machinery`, `powdercoat`, `thickness` in the BOM constants and `quantity` an integer ≥ 1, using the existing `validateMaterial` … `validateQuantity` so each failure names its field. Result: `{ ref, op, ok: false, field: 'material', error: 'Material "Steel" isn\'t on the list. Pick one.' }`. Material is checked first, then machinery, powdercoat, thickness, quantity; the first failing field is reported.
- **Creates only:** `revision`, if present, must match `/^[A-Z]$/` (`field: 'revision'`), and must equal `applyPartMask(summary).version` when the summary carries a letter ("Revision B doesn't match the number's letter A in VF27P-0004A"). This stops B1 writing a Revision that contradicts the number.
- The client runs the same checks first (section 7.3), so in practice these results appear only when the client is out of date with the server constants.

`BuildService.saveBuildParts({ buildKey, creates, updates, links })` has a new optional dependency `partService`, following the same pattern as the existing optional `revisionService` (which the save also uses for the chain). `saveBuildParts` throws a 500 "save needs partService and revisionService" if either is missing, which only a wiring mistake can cause. `PartService` gains one read method, `getStoriesByEpics(keys)` (section 6.8); `findPartByNumber` from draft 1 stays dropped in favour of the single chain-wide `byNumber` map.

1. `getIssue(buildKey, { fields: ['issuetype', 'customfield_10110'] })`. If the type isn't Build, the call fails with **400** "\"X\" is not a Build". The Build's Epic Link is its `assemblyKey`. **Invariant: a Part created through a Build save belongs to that Build's Assembly.** The server owns this rule; any `epic` the client sends is ignored.
2. The reads below run in parallel, except that `chainParts` waits for the chain. If any of them fails, the whole call fails with that read's status and nothing has been written. The one exception is a 400 from `getStoriesByKeys`, handled below.
   - `linked = new Set(await getLinkedParts(buildKey))`.
   - `chain = new Set(await revisionService.getRevisionChain(assemblyKey))` (the Build's Assembly and its Revisions).
   - `chainParts = await partService.getStoriesByEpics([...chain])` (it runs after the chain read, so this bullet and the chain bullet form one sequential pair inside the parallel group). It is turned into `byNumber = Map(fullPartNumber → story)` with `preferNewestRevision(chainParts, chainOrder)` (section 6.8): when two chain tickets hold the same number, the Part under the newest Revision (lowest index in `getRevisionChain`'s newest-first order) wins. One query for the whole save, using the parser `previewParts` already uses. Scoping to the chain, not just `assemblyKey`, is what stops a Save on a Revision B Build from creating a second `VF27P-0002A` when that Part was made under Revision A.
   - If `updates` or `links` is non-empty: `known = Map(key → story)` from **one** `partService.getStoriesByKeys([...updateKeys, ...linkKeys])`. That JQL already restricts to `issuetype = Part`.
   **A rejected membership read.** `getStoriesByKeys` uses `key in (...)`, and Jira DC answers **400** for the whole query when any listed key doesn't exist (the facts table's `key = HAR-999999` probe shows the same check). That happens when a Part is deleted or moved in the tracker while the Designer is open, or with a crafted key. So the service wraps this one call: if it rejects with a `JiraApiError` whose `status` is 400, it logs `console.warn('[save] key list rejected (400); checking', n, 'keys one by one')`, sets `known = new Map()`, and sends **every** update and link key through the per-key fallback below. Any other error from `getStoriesByKeys` (5xx, status 0) stays fatal for the request, as for the other step-2 reads. I chose this over `validateQuery: false` because the per-key path already exists and needs no unverified Jira behaviour; it costs at most one GET per key, run in parallel batches of 10, and only on the rare 400.
   **Fallback for keys search didn't return.** Search can miss a key that exists: a Part created seconds ago (index lag, which is exactly the B2 retry-link moment), an archived issue (`jiraClient.getIssue`'s comment notes search excludes them), or a Part whose summary fails `applyPartMask` (`_parseStories` drops it). So for every update or link key **absent** from `known`, the service calls `jiraClient.getIssue(key, { fields: ['issuetype', 'summary', 'customfield_10110', 'issuelinks'] })`, in parallel batches of 10, at most one call per missing key (the request is capped at 200 items). The `issuelinks` it returns are kept for the step-5 link check. The result is added to `known` as `{ key, summary, epic: fields.customfield_10110, isPart: fields.issuetype.name === 'Part' }`. A 404 means "not found". Any other error on this lookup fails **only that item**, with `{ ok: false, status, source, error: describeUpstreamError(err) }`.
   **Invariant: a Save only touches Parts of this Build's Assembly chain.** For each update or link, if the key is still unknown after the fallback (404), its type isn't Part, or its `epic` is not in `chain`, the item gets `{ ok: false, error: "HAR-123 isn't a Part of this Assembly" }` and no write. The server owns this (HANDOFF: "Parts never span Assemblies"), because the client can't be trusted to filter.
3. **Creates**, one at a time, after the per-item field checks pass. First look up `byNumber.get(fullPartNumber)` (exact match, chain-wide). If a Part is found, reuse its key (`reused: true`). Otherwise call `partService.createStory({ ...item, epic: assemblyKey })` and add the new Part to `byNumber`, so a duplicate number later in the same request reuses it. Then link the Part to the Build (step 5's link rule; a Part created in this request has no links, so the `issuelinks` check is skipped for it).
   - **A reused Part gets the CAD values.** When `reused` is true, the service compares the create's `quantity`, `material`, `machinery`, `powdercoat` and `thickness` with the stored story from `byNumber`. If any differ, it runs the step-4 update path (`updateStory` with the stored summary) before linking, and the result reports `{ reused: true, updated: true }`; otherwise `updated: false`. If that update fails, the result is `ok: false, key, reused: true, error: "Already existed, but couldn't update it: " + describeUpstreamError(err)`, the link is not attempted, and the client's next Retry sends an update with `link: true` for that key (the key is in `createdKeys`). Without this, a Part whose search entry lagged at preview time would be linked but keep its old quantity and material while the row said "Saved".
   - **Invariant: one Part ticket per full number per Assembly, across all of its Revisions.** The server owns it, through the chain-wide `byNumber`. The client's `createdKeys` covers the seconds when Jira search hasn't indexed a new Part yet.
   - The result is `{ ref, op: 'create', ok, key, reused, updated, linked, alreadyLinked, error }`. If the create succeeds and the link fails, the result is `ok: false, key: "HAR-2034", linked: false, status, source, error: "Created, but not added to Build 1: " + describeUpstreamError(err)`. Every other per-item Jira failure in steps 3 to 5 also builds `error` with `describeUpstreamError` and carries `status` and `source` (section 4.5). Because the key comes back, the client sends a `link`, not a `create`, next time.
4. **Updates** (after the membership and field checks pass): `partService.updateStory(key, { ...item, summary: known.get(key).summary })`. The stored summary comes from the same `known` entry the membership check used (search result or `getIssue` fallback), so the client's `summary`, if any, never reaches Jira. `updateStory` now clears Powdercoat and Thickness when the value is "None" (section 8, B2), so choosing None actually takes effect. If `link` is true and the Part isn't linked yet, link it. The result is `{ ref, op: 'update', ok, linked, error }`. If the update fails, the link is not attempted.
5. **Links** (after the membership check passes). The same rule applies to every link the save makes (step 3 creates and reuses, step 4 `link: true`, and `links`):
   - skipped (`ok: true, alreadyLinked: true`) if the Part is already in `linked`;
   - otherwise, **check the Part's own `issuelinks`**, because `linked` comes from JQL `linkedIssues()`, which lags the search index just like the Part and Build searches. The service uses the `issuelinks` from the step-2 `getIssue` fallback when it has them, else one `getIssue(key, { fields: ['issuelinks'] })`. `linkPartToBuild` creates the link with the Part as `inwardIssue` and the Build as `outwardIssue` (`createIssueLink(USED_IN, partKey, buildKey)`), so on the Part an existing link is expected as an entry with `type.name === 'Used In'` and `outwardIssue.key === buildKey`. The check accepts **either side**: `type.name === 'Used In' && (outwardIssue?.key === buildKey || inwardIssue?.key === buildKey)`. A Part↔Build pair has only one meaning, so matching both directions costs nothing and removes the dependency on which side Jira reports, which no live probe confirmed. If one exists, the result is `alreadyLinked: true` and no `createIssueLink` is sent. This follows `RevisionService._getPreviousRevision`, which reads `issuelinks` for the same reason. If that `getIssue` fails, the item fails (`ok: false`, `describeUpstreamError`) rather than risk a duplicate link; the row's Retry repeats it. Skipped for a Part created in this request.
   - otherwise `linkPartToBuild`.
   The design therefore never relies on what Jira does with a second identical "Used In" link, which is unverified.
6. Response **200** `{ "results": [...] }`, even when some items failed. The client renders each row from its result. Each per-item failure is logged once with `console.warn('[save] HAR-2051 create VF27P-0004A failed:', err.status, err.message)`, never the error object, because axios errors carry request headers.

Failure classes: structural validation is a 400 with nothing written. A Build that isn't a Build is a 400. Failing any of the step-2 reads is fatal for the request (the Jira status, nothing written), except a 400 from `getStoriesByKeys`, which switches to the per-key fallback. The route still accepts up to 200 items so scripts and older clients keep working; both pages send at most 25 per request (3.4 step 5). Per-item field errors, foreign-Part items and per-item Jira errors are recoverable: they come back in `results` and the user fixes or retries that row.

The Assembly page uses the same endpoint with `updates` only. There `key` is the active Build and `link: false`.

### 6.5 `POST /api/epics/onboard/preview` (new, read-only; B5)

The request is `{ url }`. `url` is a required string of at most 2,000 characters; otherwise 400. The service:

1. **Parse** with `ONSHAPE_URL_REGEX`. Version (`/v/`) and microversion (`/m/`) URLs give 400 "Use the link to the workspace (it has /w/ in it), not a version." That message is added because a pasted version link is a likely student mistake.
2. **Duplicate check, Jira, before OnShape:** `findAssembliesForElement(documentId, workspaceId, elementId)` runs `project = P AND issuetype = Assembly AND cf[10302] ~ "<elementId>"` over any status, with `fields: [summary, status, created, 10300, 10301, 10302, 10500, issuetype]`. The ids are validated hex (`/^[a-f0-9]{24}$/i`) before they go into JQL, and they pass through `sanitizeJQL` anyway. The results are filtered to an **exact** `customfield_10302 === elementId && customfield_10300 === documentId` match.
   - A match on the same workspace wins. If none matches the workspace, the newest match is used, with `matchedOn: 'document'`. Branches of one document share element ids, and a Revision may live on another workspace.
   - An element id match in a different document is **not** a duplicate. Copying a document keeps element ids, and a copy is a different design.
3. **In-process guard:** a module-level `Map<elementId, {key, documentId, at}>` of Assemblies this process created in the last 10 minutes. It covers Jira index lag for a second paste right after the first. It is checked alongside step 2 (only when step 2 found nothing, and only when `documentId` matches). A hit is turned into the `exists` response by `jiraClient.getIssue(key)` followed by `toAssembly(issue)`, with `matchedOn: 'workspace'`. If that `getIssue` fails, the error propagates (the client shows "Try again"), because answering "new" would risk a duplicate. The map is process-local: a restart clears it, which is acceptable.
4. **Read OnShape** with `getElementMetadata` (existing). Then check the element is an assembly and validate the properties, as `generateEpicFromURL` does now. That logic is refactored into `resolveOnshapeAssembly(url)`, which returns `{ documentId, workspaceId, elementId, project, partNumber, revision, name, summary }` or throws the 400.
   - The 400 body adds `problems: [{ property: 'Project', issue: 'missing', hint: 'e.g. VF27' }]`, which the client renders as a list. It is thrown as `badRequest(message, { problems })`, using the `details` argument defined in the section 6 preamble.
   - OnShape 403/404 becomes a 400 "OnShape couldn't open that link. Check it's an assembly tab in a document shared with the team." Other OnShape errors propagate unchanged as `OnshapeApiError`, so `errorHandler` marks them `source: 'onshape'` and the client shows "OnShape didn't respond (502)." through `friendlyError`.
5. **Number collision:** `getEpic(fullNumber)` finds an Assembly with the same number but a different element. Today `getEpic` uses `text ~ "${safe}"` (`epicService.js:89`), which was not the form probed. INC-3 changes it to the verified phrase form `summary ~ "\"${safe}\""` and keeps the exact `fullPartNumber` comparison on the parsed results. Test: `getEpic` sends JQL containing `summary ~ "\"VF27A-0000A\""` and ignores a hit whose parsed number differs.

Responses (all 200 unless noted):

- `{ "status": "exists", "assembly": {…toAssembly}, "matchedOn": "workspace"|"document" }`
- `{ "status": "conflict", "assembly": {…toAssembly}, "proposed": {…} }`
- `{ "status": "new", "proposed": { "summary": "VF27A-0000A Test Assembly", "fullPartNumber": "VF27A-0000A", "name": "Test Assembly", "revision": "A", "seasonLabel": "Facility 2027", "documentId": "…", "workspaceId": "…", "elementId": "…" } }`
- 400 with `problems` (above) for an invalid URL, a non-assembly tab, or incomplete properties.

### 6.6 `POST /api/epics/onboard` (new; creates Assembly and Build 1)

The request is `{ url, expectedSummary }`. `url` follows the same rules as the preview. `expectedSummary` is a required string of at most 255 characters: the summary the user confirmed.

`EpicService.onboardAssembly({ url, expectedSummary })` has a new optional dependency `buildService`. `index.js` constructs `buildService` before `epicService`, and the BuildService constructor doesn't need EpicService, so there is no cycle.

1. **An in-flight lock** per `elementId`: a `Map<elementId, Promise<result>>`, deleted in a `finally` when the first call settles. A second concurrent request for the same element awaits the first instead of running its own create, so a double click cannot create two Assemblies. The waiter then answers for itself, using its own `expectedSummary`:
   - the first call created or found an Assembly whose `assembly.summary === expectedSummary` → 200 `{ status: 'exists', assembly, build }` (the waiter didn't create it; `build` is the first call's Build 1 or `null`, so the Designer can still merge it in load step 1b; the client's handling of this response is in section 3.3, "B from the commit call");
   - the summaries differ → 409 drift, `conflict("The OnShape properties changed since you checked. Review the new name.", { proposed })`, with `proposed` built from the first call's resolved properties;
   - the first call failed → the waiter re-runs the whole sequence itself (the lock is gone by then), so one failure doesn't fail both.
2. **Re-run the preview steps 1 to 5.** A request that confirmed an old preview could race another student, or someone could edit OnShape in between.
   - `exists` → 200 `{ status: 'exists', assembly, build: null }`. Nothing is created. The client opens the Designer with the notice "Already added; opened it." (section 3.3).
   - `conflict` → `throw conflict("VF27A-0000A is already used by HAR-2040.", { assembly })`, giving 409 `{ assembly, error, status: 409 }`.
   - `proposed.summary !== expectedSummary` → `throw conflict("The OnShape properties changed since you checked. Review the new name.", { proposed })`, giving 409 `{ proposed, error, status: 409 }`. The client re-shows the confirm with the new name.
3. **Create the Assembly:** `createEpic({ summary, revision, documentId, workspaceId, elementId })`, as today. If this fails, the error propagates with its status and nothing was created. The client shows "Couldn't create the Assembly: " + `friendlyError(err)` + " Nothing was saved. Try again." The failure is logged by `errorHandler` (5xx). Record the result in the recently-created map of section 6.5 step 3.
4. **Create Build 1:** `buildService.createBuild({ assemblyKey: key, revisionChainKeys: [key], name: proposed.name })`, giving the summary `"Test Assembly Build 1"`.
   - On failure: `console.warn('[onboard] Build 1 for HAR-2050 failed:', status, message)`, and the response is **200** `{ status: 'created', assembly, build: null, buildError: describeUpstreamError(err) }` (for example "the team tracker didn't respond (503)"). The Assembly is real and must not be hidden behind an error status. The client always navigates to the Designer, which shows state E with a working "Create Build 1". The exact handoff (route state, no `cad=1`, Update from CAD disabled until a Build exists, state cleared after Build 1) is specified in section 3.3 E.
   - Nothing is ever rolled back by deleting. Deleting is forbidden and hard to reverse, and a created Assembly is valid on its own.
5. Success → 200 `{ status: 'created', assembly: {…toAssembly}, build: {…Build}, buildError: null }`.

**How `assembly` is built after the create (steps 3 to 5, and the step-1 waiter).** `createEpic` returns only `{ key }`, and a read straight after it could fail or lag, which would wrongly report "Nothing was saved" for an Assembly that exists. So the service builds it **without a read**, from the created key and the properties it just wrote:

```js
const assembly = toAssembly({
  key,
  fields: {
    summary: proposed.summary,
    issuetype: { name: 'Epic' },
    customfield_10500: proposed.revision,
    customfield_10300: proposed.documentId,
    customfield_10301: proposed.workspaceId,
    customfield_10302: proposed.elementId,
    status: { name: 'New' },
    created: new Date().toISOString(),
  },
});
```

The same object goes into the recently-created map's entry and into the in-flight promise's result, so the waiter of step 1 and a later preview hit compare against it. Test (`epicService.test.js`): with `getIssue` mocked to reject, `onboardAssembly` still returns `created` with `assembly.key`, `assembly.fullPartNumber === 'VF27A-0000A'` and `assembly.onshapeUrl` set, and `getIssue` is not called after `createIssue`.

`POST /api/epics/from-url` (legacy) and `GET /api/epics?seasonType&year` (legacy) are **removed in INC-9**, together with their tests and client functions, once `AssemblySelection` is deleted. Nothing else calls them (checked by grep: only `AssemblySelection.jsx` uses `fetchEpics` and `createEpicFromURL`).

### 6.7 Unchanged endpoints the new pages use

- `GET /api/revisions/chain/:key`
- `GET /api/builds?assemblyKey`
- `GET /api/builds/:key/parts`
- `GET /api/parts/by-keys`
- `POST /api/builds/:key/archive`

**Move no longer uses `POST /api/builds/:key/parts`.** That route calls `linkPartToBuild` with no Build-type, chain or `issuelinks` check, so a Move from a second tab would send a duplicate "Used In" link, which 6.4 step 5 says the design never relies on. The Assembly page's Move sends `POST /api/builds/:key/save` with `links: [{ ref, key }]` instead (3.5). `POST /api/builds/:key/parts` stays on the server unchanged, called by no page. (It links, it doesn't create, so the Q6 removal of the legacy create APIs doesn't cover it.)

`GET /api/stories?key=` and `POST /api/parts/preview` gain chain scoping and `fresh` (section 6.8). `POST /api/parts/:key/clone`, `POST /api/builds/:key/parts/:partKey/recreate` and `POST /api/builds/:key/cut-version` change their responses and guards (section 6.9). `GET /api/builds/status` is new (section 6.10).

**Legacy create APIs are removed in INC-9 (Q6).** `POST /api/stories` (the create route in `partRoutes.js`) and `POST /api/parts/upload` are deleted from the server in INC-9, together with the client functions `createStory` and `uploadSelectedParts` in `api/client.js`, once `grep -rn` over `src/client/src` shows nothing references them (the old `PartsListTable`/`AssemblyBomPage` path is the only caller, and it is deleted in the same increment). After removal both paths answer 404 through `apiNotFound`. `PartService.createStory` itself **stays**: `saveBuildParts` creates through it (6.4 step 3), and the B1 Revision write lives in its `_buildJiraFields`. `PartService.uploadSelected` is deleted with its route, since nothing else calls it. **Kept:** `GET /api/stories`, `GET /api/stories/:key` and `PUT /api/stories/:key` (reads and an update, which create nothing). This closes the Build-less creation path on the server as well as in the UI.

### 6.8 Part reads scoped to the Revision chain (changed: `GET /api/stories`, `POST /api/parts/preview`)

Parts keep the Epic Link of the Revision ticket they were created under: `BuildService.recreateForBuild` copies `customfield_10110` from the previous Part, and Move (`linkPartToBuild`) only adds a link. So a Build of Revision B can contain Parts whose Epic Link is Revision A. Every read the Designer uses to show or dedupe Parts is therefore scoped to the **chain**, not to one ticket.

**Who owns the chain.** The server derives it with `revisionService.getRevisionChain(key)`, as `createBuild` and the save already do (6.3, 6.4). The client does not send chain keys for these reads. Every key `getRevisionChain` returns is a real issue it just read, so the `"Epic Link" in (...)` JQL can't hit the missing-key 400 that a client-sent stale key could cause (the M1 trap). Wiring: `PartService` gets an optional `revisionService` dependency (the same optional-dependency pattern as `BuildService`), and `index.js` constructs `revisionService` before `partService`. `RevisionService` needs only `jiraClient`, so there is no cycle. Without `revisionService` (older tests), the chain is `[key]`, which is today's behaviour.

**New `PartService` methods:**

- `getStoriesByEpics(keys)`: `project = ${P} AND issuetype = Part AND "Epic Link" in (${keys.map(sanitizeJQL).join(', ')})`, paginated, parsed by `_parseStories` (which already returns `epic`). An empty array returns `[]` without a call. At most 50 keys; more throws a 500 (the chain walk stops at 100, but a Revision chain of 50 tickets doesn't occur in practice; the cap stops an unbounded JQL).
- `getStoriesForChain(key)`: first `getIssue(key, { fields: ['issuetype'] })`. A Jira 404 becomes 404 "No Assembly HAR-9 found"; an `issuetype.name` other than `Epic` or `Assembly` throws `badRequest('"HAR-2031" is not an Assembly')` before any chain walk or JQL, so `"Epic Link" in (<Part key>)`, whose Jira answer was never probed, is never sent. Other errors propagate with their status. This one by-key read is not search, so a just-onboarded Assembly passes it. Then `chain = this.revisionService ? await this.revisionService.getRevisionChain(key) : [key]`, then `preferNewestRevision(await this.getStoriesByEpics(chain), chain)`. Returns `{ chain, stories }`.
- `preferNewestRevision(stories, chain)` (pure, exported from `src/server/utils/partChain.js` so `BuildService` and tests use the same function): when two stories share a `fullPartNumber`, keep the one whose `epic` has the lowest index in `chain` (`getRevisionChain` returns newest first). Stories with no `fullPartNumber` are kept as they are.

**`GET /api/stories?key=:key&chain=1`.** `chain` is optional; any value other than `1` or absent gives 400 "chain must be 1". `key` is validated with `validateIssueKey` when `chain=1` is set (today's unvalidated `key` path is unchanged when `chain` is absent, so existing callers behave as before). With `chain=1` the route returns `getStoriesForChain(key).stories`. Both work pages call it with `chain=1`.

**`POST /api/parts/preview { epicKey, documentId, workspaceId, elementId, fresh? }`.**

- Validation added: `epicKey` passes `validateIssueKey`; `documentId`, `workspaceId` and `elementId` match `/^[a-f0-9]{24}$/i`; `fresh`, if present, is a boolean. Failures give 400 naming the field.
- `previewParts` compares the BOM against `getStoriesForChain(epicKey).stories` instead of `getStoriesByEpic(epicKey)`, so a CAD row whose number belongs to a Revision A Part lands in `existingParts`, not `newParts`.
- **`fresh: true`** is passed down as `bomService.getBOMReport(epicKey, documentId, workspaceId, elementId, assembly, { fresh })`. With `fresh`, the cache read is skipped (the fetched BOM is still written to the cache). The Designer's Update from CAD button sends it; the onboarding `cad=1` run doesn't need it (3.4 step 4). Without it, behaviour is today's 60-second cache.
- Failure handling is unchanged: a chain or stories read failure propagates with its status, and the Designer shows the "Couldn't read Parts from CAD" error of section 3.6.

**Tests:**

- `partService.test.js`: `getStoriesByEpics` sends `"Epic Link" in (HAR-B, HAR-A)` and returns `[]` without a call for `[]`; preview on HAR-B with a HAR-A Part `VF27P-0002A` and a CAD row `VF27P-0002A` puts that row in `existingParts`; `preferNewestRevision` keeps the HAR-B copy when both tickets hold the number; `fresh: true` reaches `getBOMReport`; without `revisionService` the chain is `[epicKey]`.
- `bomService.test.js`: with `fresh: true` and a warm cache, `onshapeClient` is called again; without it, it isn't.
- `partRoutes.test.js`: `chain=2` gives 400; `chain=1` with key `har-1` gives 400; **`chain=1` with a Part key (mocked `getIssue` returning `issuetype.name: 'Part'`) gives 400 "\"HAR-2031\" is not an Assembly" and `searchIssues` is not called**; `chain=1` with a key whose `getIssue` is 404 gives 404; preview with a non-hex `elementId` gives 400; `fresh: "yes"` gives 400.
- `buildService.test.js` (save): a save on a HAR-B Build with a create for `VF27P-0002A` reuses the HAR-A key (`reused: true`, no `createIssue`).

### 6.9 Clone, Re-create and Cut Version (changed: responses and server guards)

These three Assembly-page actions write to Jira (and, for Cut Version, OnShape), and the page re-reads through lagging searches afterwards. Each one therefore returns what it wrote, and the server refuses a repeat by reading by key, which doesn't lag.

**Part object returned without a read.** Clone and Re-create build the new Part in the `_parseStories` shape from the fields they just wrote, the same no-read pattern as `toAssembly` in 6.6: `{ key, summary, fullPartNumber, seasonType, year, partNumber, version, name, epic, quantity, material, machinery, powdercoat, thickness, project, revision }`. A shared helper `partFromWritten(key, summary, fields)` in `partService.js` does it. It spreads `applyPartMask(summary)` and maps each written field exactly as `_parseStories` (`partService.js:365-385`) maps a fetched one, with the same fallbacks:

- `epic` ← `fields.customfield_10110 ?? null`
- `material` ← `fields.customfield_10202?.value ?? Material.NONE`
- `machinery` ← `fields.customfield_10201?.[0]?.value ?? Machinery.NONE` (Machinery is a multi-select, written as an array: `clonePart` via `_buildJiraFields` writes `[{ value }]`, and Re-create copies the raw array)
- `powdercoat` ← `fields.customfield_10204?.value ?? Powdercoat.NONE`
- `thickness` ← `fields.customfield_10207?.value ?? Thickness.NONE`
- `quantity` ← `fields.customfield_10206 ?? 0`
- `project` ← `fields.project?.key ?? JIRA_PROJECT`
- `revision` ← `fields.customfield_10500 ?? null`. **Added on purpose:** `_parseStories` doesn't output `revision`, but Re-create's caller needs the new letter, and an extra key is harmless to every reader of the fetched shape. All other keys match a fetched Part, so `mergeParts` (7.2) never mixes two shapes.

Test (`partService.test.js`): `partFromWritten` over the exact `fields` `clonePart` passes to `createIssue` deep-equals `_parseStories([{ key, fields }])[0]` plus `revision`; with Powdercoat and Thickness omitted it gives `Powdercoat.NONE` and `Thickness.NONE`.

**`POST /api/parts/:key/clone`** → 200 `{ key, fullPartNumber, part }` (`key` and `fullPartNumber` stay for compatibility).

- `PartService.clonePart` returns `{ key, fullPartNumber, part: partFromWritten(...) }`. It makes no extra `getIssue` or search after `createIssue`.
- **Number allocation can't repeat inside the lag window.** `getNextPartNumber` is a JQL search, so a second Clone seconds after the first would read the same max and get the same number, breaking the one-ticket-per-number invariant. `PartService` keeps a process-local `Map<seasonCode, highestAllocated>` (for example `VF27 → 7`). **It is updated inside `createStory`**, the one method every Part create passes through (`clonePart`, `saveBuildParts` creates, and until INC-9 removes them, `uploadSelected` and `POST /api/stories`): after a successful `createIssue`, if `applyPartMask(fields.summary)` parses with `isEpic === false`, the entry for `V${seasonType}${year}` becomes `max(current, parseInt(partNumber, 10))`. So a CAD-numbered `VF27P-0008A` that a Designer Save created seconds earlier raises the floor before the next Clone allocates. (Re-create keeps the old number with a new letter, so it never needs the floor.) `getNextPartNumber` returns `max(searchMax, highestAllocated) + 1`. Allocation and create run under a per-season promise chain (`this._allocLock.get(seasonCode)`), so two concurrent clones in one process are serialized and get 0007 and 0008. Like the onboarding guard (6.5 step 3), the map is lost on restart, which is acceptable: after a restart the search has long since caught up. Two server processes can still collide; that is the same class as the Build-number race in section 9 and out of scope. A Save create runs outside the per-season lock (its number comes from CAD, not from allocation), so a Clone and a Save of the same new number in the same instant can still both write it; that needs CAD to pick a number a Clone is allocating at that moment, and is accepted.
- Validation (unchanged route checks, made explicit): `:key` and `epicKey` pass `validateIssueKey`; `name`, if present, is a string of 1 to 80 characters after trimming; `quantity`, if present, passes `validateQuantity`. Failures give 400. A Jira failure on create propagates with its status, logged by `errorHandler`; nothing was created.

**`POST /api/builds/:key/parts/:partKey/recreate`** → 200 `{ key, revision, part }`.

`recreateForBuild({ partKey, targetBuildKey })` runs, in order:

1. **In-flight lock** per `partKey`: a `Map<partKey, Promise>`, deleted in a `finally`. A concurrent second request (double click, second tab) awaits the first and then runs its own step 3, which sees the first one's result in `recentlyRecreated` and answers 409.
2. **Read the old Part and the target Build by key, in parallel.** The old Part read is the `getIssue` it already does, with `issuelinks` added to the fields. The target read is `getIssue(targetBuildKey, { fields: ['issuetype', 'customfield_10110'] })`. A 404 or a type other than Build gives 400 "\"HAR-77\" is not a Build". Then `chain = await revisionService.getRevisionChain(target.fields.customfield_10110)`; if the old Part's `customfield_10110` (its Epic Link) isn't in `chain`, the call gives 400 "\"HAR-2035\" isn't a Part of this Assembly". The chain is taken from the **target Build's** Assembly, because `getRevisionChain` walks backward only (HANDOFF gap 4): a Revision B Build's chain is `[B, A]` and so admits a Part made under A, while the chain of the Part's own Revision A would be `[A]` and would wrongly refuse it. This is the same chain rule the save uses (6.4 step 2). All of this runs before any write.
3. **Guards against a second revision of the same Part,** all before any write. The first one that hits throws `conflict('HAR-2035 was already re-created as HAR-2041. Re-create HAR-2041 instead.', { recreatedAs: 'HAR-2041' })`:
   - **The `Revises` link, either side.** `createRevision` links `(REVISES, previousKey, newKey)`, and `RevisionService._getPreviousRevision` reads `inwardIssue` on the newer ticket, so the older ticket's entry should carry `outwardIssue = newer`. No live read has confirmed that side, and if it were reversed, an outward-only check would answer 409 for every Part that is itself a revision (its own link to the Part it revised would look like "already revised"). So the guard doesn't trust the side. For each `issuelinks` entry with `type.name === 'Revises'`, it takes the linked issue from whichever of `outwardIssue` or `inwardIssue` is set, and parses that issue's `fields.summary` (Jira includes `summary` in an issue link's nested issue) with `applyPartMask`. The entry counts as "already revised" only when the parsed `seasonType`, `year` and `partNumber` equal the old Part's and its `version` letter is **later** than the old Part's. An entry whose linked issue has no summary, doesn't parse, has another number, or has an earlier or equal letter is ignored (an earlier letter is the Part this one revised). `recreatedAs` is the linked issue's key. If two entries qualify, the one with the latest letter is named. A missing or unusable summary falls through to the other two guards, so the number guard below still catches an indexed revision.
   - **`recentlyRecreated`**, a process-local `Map<sourcePartKey, { key, at }>` with a 10-minute lifetime, like onboarding's recently-created map (6.5 step 3). It is written as soon as the new ticket's key is known: after `createRevision` returns, and also from `err.details.key` when the `Revises` link failed (step 4). It covers a Retry when the `Revises` link is missing and search hasn't indexed the new ticket yet.
   - **The number.** `partService.getStoriesByEpics(chain)` (6.8; `recreateForBuild` now uses the optional `partService` dependency added for the save in 6.4, and throws the same wiring 500 without it) holds a Part whose `fullPartNumber` equals the new summary's number (same number, letter `nextRevision`). This covers a missing `Revises` link after a restart has cleared `recentlyRecreated`, when search has long since indexed the new ticket.
   This stops a second click, a second tab or a lagging list from making a second `VF27P-0003B`. A student who wants the Part in another Build after A → B re-creates B (giving C) or moves B; the 409 copy says so.
4. **Create the revision.** `revisionService.createRevision(...)`, as today. **`createRevision` changes:** the `createIssueLink(REVISES, previousKey, result.key)` call is wrapped. On failure it logs `console.warn('[revision]', result.key, 'created but Revises link to', previousKey, 'failed:', err.status, err.message)`, sets `err.details = { ...err.details, key: result.key, revision, stage: 'revises-link' }` on the original error and rethrows it, so its `status` and `source` are kept. `recreateForBuild` catches an error with `details.stage === 'revises-link'`, records `recentlyRecreated`, adds `part: partFromWritten(err.details.key, summary, { ...extraFields, customfield_10500: revision })` to `err.details`, and rethrows. It does **not** attempt the `Used In` link, because the new ticket isn't recorded as a revision and the student should see that before using it. Any other error from `createRevision` propagates with nothing created (the issue create itself failed).
5. **Link to the target Build** with `linkPartToBuild`, as today. A failure propagates with its own status, with `err.details = { ...err.details, key: 'HAR-2041', part, stage: 'used-in-link' }` set on the original error before the rethrow (so `errorHandler` still adds `source` and spreads the details). The client shows "Created HAR-2041, but couldn't add it to Build 2: " + `friendlyError(err)`, adds `err.body.part` to `createdParts`, and the new row offers "Move here" (a save `links` item, 3.5).

- The returned `part` is `partFromWritten(result.key, summary, { ...extraFields, customfield_10500: nextRevision })`.
- Other failures: a summary that doesn't parse stays a 400 (today it is a plain `Error`, so it becomes `badRequest`). A missing `revisionService` stays the existing 500.
- Validation: `:key` and `:partKey` pass `validateIssueKey`; otherwise 400.

**`POST /api/builds/:key/cut-version`** → 200 `{ onshapeVersionLink, superseded, resumed }` (`resumed` is new and always present; existing readers of the first two keys are unaffected).

**The OnShape ids come from the Assembly, not the request.** The request body is `{ assemblyKey }`. `documentId`, `workspaceId` and `elementId` in the body are accepted for compatibility with older clients but **ignored**; the server reads them from the Assembly by key (step 2). So a crafted or stale body can't version some other document, and the step-2 resume check compares against stored values. I chose "ignore" over "400 on mismatch" because the client got those ids from the same Assembly record, so a mismatch could only be a stale page, and refusing it would add an error state with no student fix. The new pages call the existing `cutBuildVersion(buildKey, { assemblyKey })` in `api/client.js` with only the key.

`cutVersionFromOnshape({ buildKey, assemblyKey })` now runs, in order:

1. **In-flight lock** per `buildKey`: a `Map<buildKey, Promise>`, deleted in a `finally`. A concurrent second request awaits the first and then runs its own step 2. That sees the Build Active with this document's link and takes the resume path, which finds no Active sibling and answers 200 `{ superseded: [], resumed: true }`. So two tabs make one OnShape version, and both see success.
2. **Read the Build and the Assembly by key, in parallel.**
   - Build: `getIssue(buildKey, { fields: ['issuetype', 'status', 'customfield_10110', 'customfield_10502'] })`. A 404 or a type other than Build → 400 `"X" is not a Build`. `customfield_10110 !== assemblyKey` → 400 `"X" isn't a Build of this Assembly`, so a crafted `assemblyKey` can't supersede another Assembly's Builds.
   - Assembly: `getIssue(assemblyKey, { fields: ['issuetype', 'customfield_10300', 'customfield_10301', 'customfield_10302'] })`. A 404 or a type other than `Epic`/`Assembly` → 400 `"X" is not an Assembly`. Any of the three ids missing → 400 "This Assembly has no OnShape link." (the same case the UI already disables, section 9). The stored ids are validated with `/^[a-f0-9]{24}$/i` before use.
   - `storedLinkMatches` is true when the Build's `customfield_10502` is a version URL of the Assembly's `documentId` (`/documents/<documentId>/v/<id>/`).
   - Then by `status.name`:
     - `Draft` → continue at step 3.
     - `Active` and `storedLinkMatches` → **resume**: skip `createVersion` and transition 11, run only the supersede stage of `cutVersion` (below), and return 200 `{ onshapeVersionLink: stored, superseded, resumed: true }`. This finishes a cut whose supersede failed (it leaves two Active Builds otherwise), and it is the call behind the two-Active repair button (3.4).
     - `Active` without a matching link (cut outside ValorBOM, or for another document), `Superseded`, `Archived`, or anything else → `conflict('Build 1 has already been cut.', { buildStatus: status.name })` (409). The detail is named `buildStatus`, not `status`, because `errorHandler` spreads `status` (the HTTP 409) last (section 6 preamble). I don't resume an Active Build without this document's link, because ValorBOM can't tell that it made that cut, and superseding siblings on that basis would act on a state it didn't create.
   All of these checks run **before** `createVersion`, so nothing is written on a 400 or 409.
3. **Resume a half-done cut (Draft).** If the Build is Draft and `storedLinkMatches`, a previous attempt created the OnShape version and saved the link, then failed at the transition. The service reuses that link and skips `createVersion`. `resumed` is `true` in the response.
4. Otherwise `createVersion(documentId, workspaceId, …)` with the Assembly's stored ids, as today, then `cutVersion`.

**`cutVersion` stages and `cutStage`.** `cutVersion({ buildKey, assemblyKey, onshapeVersionLink })` keeps its three writes in order and tags a failure with the stage it was in, by setting `err.details = { ...err.details, cutStage }` on the original error and rethrowing it:

- `'link'`: `updateIssue(buildKey, { customfield_10502 })` failed. The link isn't stored, so a Retry can't resume and makes one more OnShape version. That extra version is harmless, and it is the only remaining duplicate case. Skipped when the stored link already equals `onshapeVersionLink` (the step-3 resume).
- `'transition'`: transition 11 (Cut Version) failed. The link is stored and the Build is still Draft, so a Retry resumes at step 3.
- `'supersede'`: anything inside `_supersedeActiveSiblings` failed: the `getBuildsForAssemblies` search for sibling keys, a sibling's `getIssue` status read, or transition 21 (Supersede) on one. The tag is set by one `try/catch` around the whole body of `_supersedeActiveSiblings`, so no failure in that stage can leave the tag off. The Build is Active with its link stored, so a Retry resumes at step 2. Siblings superseded before the failure stay superseded; a Retry supersedes the rest. On the step-2 resume path the stored link is the `onshapeVersionLink` that `cutVersionFromOnshape` adds to the details, so the client gets the same body from a resumed or a first cut.

**The supersede stage** (`_supersedeActiveSiblings(buildKey, assemblyKey)`, used by both the normal path and the resume) takes the sibling **keys** from `getBuildsForAssemblies([assemblyKey])` (search), excluding `buildKey`, then reads each sibling's status with `getIssue(key, { fields: ['status'] })`, in parallel batches of 10. Existing Builds are already indexed, so search finds their keys, but their `status` values in search lag; a sibling cut seconds earlier would still read Draft there and be skipped. Every sibling whose **by-key** status is Active gets transition 21, one at a time. It returns `superseded: string[]`.

If `cutVersion` throws after `createVersion` succeeded (or after a resume), `cutVersionFromOnshape` logs `console.warn('[cut]', buildKey, 'stage', err.details.cutStage, 'failed after the OnShape version was made:', err.status, err.message)`, sets `err.details = { ...err.details, onshapeVersionLink }` and rethrows the original error, so its status and `source` are kept and `errorHandler` spreads both details. The client picks its copy from `cutStage` (3.6). A failure before or inside `createVersion` carries no `cutStage` and nothing was written.

- Validation at the route: `:key` and `assemblyKey` pass `validateIssueKey`; otherwise 400. Body ids are not validated, because they are not used.

**Tests:**

- `partService.test.js`: `clonePart` returns `part` with `fullPartNumber`, `epic` and `quantity`, and makes no `getIssue` or `searchIssues` call after `createIssue`; two sequential `clonePart` calls with the search mocked to return the same max give two different numbers (0007, 0008); two concurrent calls do too.
- `partService.test.js` (clone floor, N2 of the draft-5 review): after `createStory` creates `VF27P-0008A` (as a `saveBuildParts` create does), a `clonePart` in season VF27 with the search still returning a maximum of 7 allocates `0009`; a `createStory` whose summary doesn't parse as a Part leaves the floor unchanged.
- `buildService.test.js`, Re-create:
  - `recreateForBuild` returns `part` with `revision: 'B'`, `epic` copied and `project` set.
  - `Revises` guard, both sides (N1 of the draft-6 review). Old Part `VF27P-0003A`: a `Revises` entry whose `outwardIssue` has summary `VF27P-0003B …` gives 409 with `recreatedAs` and the "Re-create HAR-2041 instead." message, and no `createIssue`; the same entry with the newer issue under `inwardIssue` gives the same 409. Old Part `VF27P-0003B` whose only `Revises` entry links `VF27P-0003A` (on either side) is **not** refused, and `createIssue` runs for `VF27P-0003C`. An entry linking a Part with another number, or with no `fields.summary`, is ignored.
  - A target key whose `getIssue` says Part, or whose Epic Link chain doesn't contain the old Part's Epic Link, gives 400 and no `createIssue`. A Revision A Part re-created into a Build of Revision B (target chain `[B, A]`) is accepted.
  - `createRevision`'s `Revises` link rejecting with a `JiraApiError` 503 gives an error whose `details` has `key`, `revision`, `stage: 'revises-link'` and `part`, keeps `status: 503`, and `createIssueLink` is **not** called for `Used In`.
  - After that failure, a second `recreateForBuild` for the same source (with `issuelinks` still empty and search not listing the new ticket) gives 409 from `recentlyRecreated` and makes no `createIssue`.
  - With `recentlyRecreated` empty (a restart) and no `Revises` entry, a chain Part whose number equals the new summary's gives 409.
  - Two concurrent calls for the same source give one `createIssue`.
  - A `Used In` link failure after a successful create gives `details.stage: 'used-in-link'` with `key` and `part`.
- `revisionService.test.js`: a rejected `Revises` link rethrows the original error with `details.key` and `details.stage === 'revises-link'`; a successful create returns `{ key, revision }` as today.
- `buildService.test.js`, Cut Version:
  - Draft Build: `createVersion` gets the **Assembly's** stored `documentId` and `workspaceId`, even when the call passes different ones.
  - An Assembly with no `customfield_10300` gives 400 "This Assembly has no OnShape link." and no `createVersion`.
  - A foreign `customfield_10110` gives 400 before any write.
  - A Superseded Build gives 409 with `details.buildStatus === 'Superseded'` and no `createVersion`. An Active Build without a stored link of this document gives 409 with `buildStatus: 'Active'`.
  - An Active Build with a stored link of this document and one sibling that is Active by key: no `createVersion`, no transition 11, one transition 21 on the sibling, and the result has `resumed: true`.
  - A sibling that search reports as Draft but `getIssue` reports as Active is superseded.
  - Two concurrent calls give one `createVersion`, and the second resolves with `resumed: true, superseded: []`.
  - A Draft Build with `customfield_10502` already set to this document's version skips `createVersion` and still transitions.
  - `cutStage` is set at each stage: `updateIssue` rejecting gives `'link'`, transition 11 rejecting gives `'transition'`, a sibling `getIssue` or transition 21 rejecting gives `'supersede'`; each also carries `details.onshapeVersionLink`. A `createVersion` failure carries no `cutStage`.
  - The sibling-key search (`getBuildsForAssemblies`) rejecting after transition 11 succeeded gives `cutStage: 'supersede'` with `details.onshapeVersionLink` (N2 of the draft-6 review). The same search rejecting on the step-2 resume path gives `cutStage: 'supersede'` with the stored link.
- `buildRoutes.test.js` / `partRoutes.test.js`: the 400 validation cases above. The cut-version 409 body is `{ error, status: 409, buildStatus: 'Active', source? }` (`status` is 409, `buildStatus` is the Build's). The resume 200 body has `resumed: true`. A body with no OnShape ids is accepted (200). The Re-create 409 body has `recreatedAs`.

### 6.10 `GET /api/builds/status?keys=<k1,k2,…>` (new, read-only)

The two-Active warning (3.4 step 2) uses this to read Build statuses by key, because `GET /api/builds` reads them from a lagging search. It writes nothing.

- **Route:** registered in `buildRoutes.js` directly after `GET /`, before `GET /for-part/:partKey` and every `/:key/...` route. It is on the ungated BOM surface like the rest of `/api/builds` (section 10).
- **Validation** (`badRequest`, 400): `keys` is required and must be a string (a repeated `keys` parameter, which Express gives as an array, is a 400). It is split on `,`, each part trimmed, empty parts dropped and duplicates removed. After that there must be 1 to 10 keys ("keys must list 1 to 10 Build keys"), and each must pass `validateIssueKey` ("\"har-1\" is not a valid key"; keys are not upper-cased, since the client sends keys it got from the server). The keys never reach JQL, so `sanitizeJQL` isn't needed.
- **Service:** `buildService.getBuildStatuses(keys)` calls `getIssue(key, { fields: ['issuetype', 'status', 'customfield_10110', 'customfield_10502'] })` for every key in parallel. A 404, or an issue whose type isn't Build, puts the key in `missing` (recoverable; the caller treats it as not Active). Any other error is fatal for the request: it propagates with its own status (a Jira 503 stays 503, a network failure becomes 500), is logged by `errorHandler`, and the client shows the "Couldn't check…" line (3.6).
- **Response** 200: `{ builds: [{ key, status, assemblyKey, onshapeVersionLink }], missing: [] }`, where `status` is `fields.status.name`, `assemblyKey` is `customfield_10110 ?? null` and `onshapeVersionLink` is `customfield_10502 ?? null`. `builds` keeps the request order.
- **Client:** `fetchBuildStatuses(keys)` in `api/client.js` (INC-6) joins the keys with `,` and URL-encodes them.

**Tests** (`buildRoutes.test.js`, `buildService.test.js`): no `keys`, an empty `keys`, 11 distinct keys, a repeated `keys` parameter and a lower-case key each give 400 with no `getIssue`; `HAR-1,HAR-1` reads once; a 404 and a Part key go to `missing`; a Build returns its by-key `status` and link even when the `GET /api/builds` mock says otherwise; a `JiraApiError` 503 on one key gives 503; the route is matched before `/:key/...` (a request for `/api/builds/status?keys=HAR-1` never reaches the `:key` handlers).

## 7. Client logic (pure modules, Jest-tested)

### 7.1 `lib/buildNames.js`

- `buildLabel(build)` gives `Build ${buildNumber}`, falling back to the summary.
- `buildSummaryPreview(name, number, description)` gives `` `${name.trim()} Build ${number}` `` plus `` ` - ${d}` `` where `d` is the description trimmed with whitespace collapsed, when `d` is non-empty. It mirrors the server rule in 6.3 for the New Build form's preview line. Tests: no description → "Test Assembly Build 3"; `"  1in   bash bar "` → "Test Assembly Build 3 - 1in bash bar"; a whitespace-only description → no suffix.
- `nextBuildNumber(chainBuilds)` gives `max(buildNumber) + 1` over the **whole chain's** Builds (not filtered by Revision), or 1 when empty, for display only. Test: Builds 1 and 2 under HAR-A, none under HAR-B, chain `[HAR-A, HAR-B]` → 3; and `visibleBuilds(chainBuilds, 'HAR-B')` is empty while `nextBuildNumber` is still 3.
- `visibleBuilds(chainBuilds, key)` filters to `b.assemblyKey === key`.
- `defaultBuildKey(builds, requested)` implements the selection rules in 3.4 and 3.5.
- `mergeBuilds(fetched, extra)` returns `fetched` unchanged when `extra` is null or its key is already present, otherwise `[...fetched, extra]`. It also accepts an array of extras (Builds created in this session). Used by load step 1b and after every Build create. Tests: `extra` null; key already present (the fetched copy wins, since it is fresher); key absent with `fetched = []` gives `[extra]`, and `defaultBuildKey` then picks it.
- `overlayBuildStatus(builds, statusThisSession)` applies `statusThisSession: Map<buildKey, { status, onshapeVersionLink? }>`, filled from a successful or resumed Cut Version (the cut Build → `Active` with its link, each `superseded` key → `Superseded`), a `cutStage: 'supersede'` failure (the cut Build → `Active` with `err.body.onshapeVersionLink`), or a 409's `err.body.buildStatus`. A 409 without `buildStatus` adds no entry, and nothing ever reads `err.body.status` as a Build status. `activeConflict(builds)` returns the Active Builds when there is more than one, otherwise `[]`. It only decides whether to run the by-key check (3.4 step 2); the warning shows only after that check confirms it. Entries written from `GET /api/builds/status` (6.10) go into `statusThisSession` like any other, and a key in its `missing` list gets `{ status: 'Missing' }`, which `activeConflict` doesn't count as Active. `repairCandidates({ conflict, cutFailedKey, documentId })` returns the Builds the warning offers a button for, each with its label: `[{ build, label: 'Finish cutting Build 1' }]` when `cutFailedKey` is a key in `conflict`; otherwise every Build in `conflict` whose `onshapeVersionLink` contains `/documents/${documentId}/v/`, labelled "Make Build N the Active one"; `[]` when `documentId` is empty or nothing matches. `supersedeTargets(conflict, chosenKey)` returns the other Builds, named in the confirm body. For each Build with an overlay entry it returns a copy with the overlaid fields. `dropAgreedStatus(statusThisSession, fetched)` removes an entry once the fetched Build's `status` equals it (same drop rule as `mergeBuilds` and `createdKeys`). Tests (`buildNames.test.js`): after a cut of HAR-2051 with `superseded: ['HAR-2052']`, a lagging re-fetch that still says Draft/Active gives HAR-2051 `Active` with the link and HAR-2052 `Superseded`; once a re-fetch agrees, the entries are dropped and the output is unchanged. An entry built from a 409 body `{ status: 409, buildStatus: 'Active' }` gives the Build `Active`; a 409 body with no `buildStatus` adds no entry and leaves the Build as fetched. A `cutStage: 'supersede'` failure for HAR-2051 while HAR-2052 is fetched as Active makes `activeConflict` return both; after the resume succeeds with `superseded: ['HAR-2052']` it returns `[]`. Two Builds fetched as Active, with a by-key entry `{ status: 'Superseded' }` for one, give `activeConflict` `[]` (the stale-search false positive); a `missing` key does the same. `repairCandidates`: with `cutFailedKey: 'HAR-2051'` it returns only HAR-2051, labelled "Finish cutting Build 1", even when HAR-2052 also has a link of this document; with no `cutFailedKey`, HAR-2051 linked to `/documents/8c64…/v/…` and HAR-2052 linked to another document, it returns only HAR-2051; with `documentId` empty it returns `[]`. `supersedeTargets(conflict, 'HAR-2051')` returns HAR-2052.

### 7.2 `lib/designerRows.js`

`deriveDesignerRows({ parts, chainKeys, linkedByPart, linkedThisSession, buildKey, preview, edits, createdKeys, rowResults })` returns `{ groups: { newFromCad, inBuild, other }, pendingOps }`.

- `parts` is the chain Parts plus any build-linked Parts fetched by key (3.4 step 1). A Part whose `epic` isn't in `chainKeys` is marked `readOnly` with the label "From another Assembly".
- `rowId` is the Jira key when there is one, otherwise `fullPartNumber`. A new row whose key appears in `createdKeys[fullPartNumber]` is treated as an existing Part with that key. That is the B2 client half.
- **`linkedThisSession: Map<buildKey, Set<partKey>>`** is merged into `linkedByPart` first (`mergeLinks(linkedByPart, linkedThisSession)`, exported for the Assembly page too). It is filled from Save results (7.3), Move and Re-create results (3.5), and the `linked` array of a `POST /api/builds` with copy (3.4 step 1b). An entry stays until a re-fetch of that Build's Parts includes the key, then the caller drops it (same rule as `createdKeys`). The map is keyed by Build, so switching Builds neither loses nor misapplies it.
- **`createdParts: Map<key, Part>`** holds Part objects returned by Clone and Re-create (section 6.9) and by a Re-create link failure's error body. `mergeParts(fetched, createdParts)` (exported for the Assembly page) appends every entry whose key is absent from `fetched`; the caller drops an entry once a re-fetch includes its key. `deriveDesignerRows` and the Assembly page both render from `mergeParts(parts, createdParts)`, so a just-created Part has a row before search lists it.
- **`recreatedThisSession: Map<sourceKey, newKey>`** (Assembly page) marks Parts re-created in this session, including a Re-create whose `Revises` link failed (`err.body.key`, 3.5). Their "Re-create here" button is disabled with the tooltip "Already re-created as HAR-2041" until a re-fetch lists `newKey`, then the entry is dropped. The server's 409 (6.9) is the real guard.
- **`hasNewerRevision(part, allParts)`** (exported) is true when another Part in `allParts` has the same `seasonType`, `year` and `partNumber` and a later `version` letter. The Assembly page disables "Re-create here" for such a Part, whatever the session holds, and names the newest one in the tooltip ("Re-create HAR-2041 instead."). It is called with `mergeParts(parts, createdParts)`, so it holds both before and after the session entry is dropped. Tests (`designerRows.test.js`): VF27P-0003A with VF27P-0003B present → true, and the newest is named; VF27P-0003B alone → false; VF27P-0003A with VF27P-0004B → false; VF27P-0003A whose B exists only in `createdParts` → true.
- `inBuild` holds Parts with `buildKey` in the merged `linkedByPart[key]`.
- `other` holds the rest of the Assembly's Parts. Their labels come from `linkedByPart`: "Also in Build 2", or "Not in any Build".
- Preview `existingParts` merge their `changes` (from `compareBOMWithJira`) as the CAD values, marked `changedInCad`. User edits from `edits[rowId]` win over CAD values.

### 7.3 `lib/designerSave.js`

- `planSave(groups, selection)` produces the request body of 6.4:
  - selected new rows become `creates`, with `revision` from `row.version`;
  - edited or CAD-changed existing rows become `updates`, with `link` true when the row is in `other` and selected;
  - selected unedited `other` rows become `links`.
- Before adding a row to the body, `planSave` runs `validateRowFields(row)` from `lib/partValidation.js`. That module applies the same rules as the server's per-item field checks (section 6.4) over the constants already mirrored in `api/client.js` (`MATERIALS`, `MACHINERY`, `POWDERCOAT`, `THICKNESS`), plus the revision-vs-letter check. A failing row is **held back**: it goes into `planSave`'s second return value `heldBack: [{ rowId, field, error }]` and not into the body. The page marks the row `aria-invalid` with the error before Save is pressed, and the save bar counts it.
- `planSave` returns `{ body, heldBack }`. When `body` has no items and `heldBack` is non-empty, Save is disabled with the help text "Fix the marked rows to save."
- `applySaveResults(state, results, buildKey)` produces the next `edits`, `createdKeys`, `linkedThisSession`, `selection` and `rowResults`. A result with `field` set marks that field's control `aria-invalid`. Every result with `ok: true` that has `linked: true` or `alreadyLinked: true` (creates, updates with `link: true`, links) adds its key to `linkedThisSession.get(buildKey)`. A reused create with `updated: true` shows the row note "Already existed; updated and added to Build 1."
- `batchBody(body, 25)` splits a `planSave` body into requests of at most 25 items, creates first, then updates, then links, preserving order. Test: 60 items give 3 batches of 25, 25 and 10 with every `ref` exactly once.

Tests (`__tests__/utils/designerSave.test.js`) cover: a create where the link fails, then a retry that sends only a link; an unchanged row that produces no operation; edits surviving a second Update from CAD; HAR-2031 producing one link (`links: [{ ref: 'HAR-2031', key: 'HAR-2031' }]`); a save made of updates only; **"unmapped material row is held back with an error, other rows still planned"**; a revision letter that disagrees with the number is held back; `applySaveResults` adds an `ok` link result for HAR-2031 to `linkedThisSession` for the saved Build; and `batchBody` splitting.

`__tests__/utils/designerRows.test.js` adds (M2, M5): after a link result for HAR-2031, a re-fetch whose `linkedByPart` lacks HAR-2031 still puts it in `inBuild`, and once a re-fetch includes it the overlay entry can be dropped with no change in grouping; a HAR-A Part linked to the HAR-B Build (chain `[HAR-B, HAR-A]`) is in `inBuild`; a linked Part whose `epic` is outside the chain is `readOnly`. It also adds (draft-4 review M1): `mergeParts` keeps a created Part when the re-fetch lacks it and returns the fetched copy once present (with the entry then droppable); a created Part plus its key in `linkedThisSession` lands in `inBuild` with an unchanged `parts` fixture; after a "+ New Build" with copy whose response has `linked: ['HAR-2031','HAR-2032']`, an empty `GET /api/builds/HAR-2053/parts` still puts both under "In Build 3".

`__tests__/utils/partValidation.test.js` runs a table of cases (each material, machinery, powdercoat and thickness value, plus `"Steel"`, `""`, quantity `0`, `1.5`, `"2"`) through both the client `validateRowFields` and the server `validatePartPayload`, and asserts they agree on valid/invalid. That catches drift between the mirrored constants and `src/server/utils/bomConstants.js`.

`lib/friendlyError.js`: `friendlyError(err)` turns an error into student copy using `err.body.source` and `err.status` only (section 4.5). `__tests__/utils/friendlyError.test.js` covers tracker 503, tracker status 0 (`ApiError` 500 with `source: 'tracker'` from a network failure), tracker 400, OnShape 500, a plain 400 `badRequest` message passed through unchanged, and a `TypeError` from `fetch` giving "Couldn't reach ValorBOM…". The server helper has its own `__tests__/utils/upstreamError.test.js`: `JiraApiError` 503, 0 and 400, `OnshapeApiError` 404, and an `HttpError` 400 whose message passes through.

## 8. How each bug is fixed

| Bug | Fix | Layer that owns it | Tests (server, Jest) |
|---|---|---|---|
| **B1** Part create never writes Revision (`customfield_10500`) | In `PartService._buildJiraFields`, set `fields[RevisionField.REVISION]` (`customfield_10500`) to `payload.revision`, else `applyPartMask(summary)?.version`, else `'A'`. `payload.revision`, when present, must match `/^[A-Z]$/`; otherwise `_validatePayload` fails. `_validatePayload` (both the existing field check and the new revision check) changes from `throw new Error(...)` to `throw badRequest(...)`, keeping the "Validation failed: …" message text, so `POST /api/stories` and `PUT /api/stories/:key` with bad input answer 400 instead of 500. Inside `saveBuildParts` the per-item checks run first, so this throw is only a backstop there. Every Part-creating path goes through this: `createStory`, `uploadSelected` (via `createStory`), `clonePart` (summary carries `A`), and `saveBuildParts` creates. `updateStory` builds its own field map and never includes `customfield_10500`. A test asserts that. **Screen check done:** the read-only createmeta probe (section 1 facts table) confirmed `customfield_10500` is on the HAR Part create screen (type 10103), so the write is accepted without an admin change. If a future screen change removed it, the create fails loudly with Jira's 400 (no silent second write); the implementer re-runs `/tmp/ux-refactor-check/createmeta.mjs` before shipping INC-1 if more than a few days have passed. | PartService: one place every create passes through | `partService.test.js`: revision from the payload; from the summary letter (`VF27P-0001C …` → `C`); default `A` when the summary has no letter (legacy title-only, e.g. `uploadSelected` with `summary: 'VR26P-0001 X'`, which `applyPartMask` rejects, giving `A`); invalid `revision: 'AA'` rejected with an error whose `status` is 400; `clonePart` writes `A`; `updateStory` fields have no `customfield_10500`. `__tests__/routes/partRoutes.test.js` (`partRoutes.js` serves `/api/stories`): `POST /api/stories` with `revision: 'AA'` answers **400**, and with material "Steel" answers 400. |
| **B2** `createStory` succeeds, `linkPartToBuild` then fails, and the failure is swallowed with `console.error`; per-row save, link and update failures must show on the row, and a retry must only re-link, never re-create | Today's swallow is in the legacy Designer's client-side save loop (`components/DesignerPartsTable.jsx`, the `console.error('Failed to link existing part to build:', …)` catch at line 201), which INC-9 deletes; the new pages never call `createStory` then `linkPartToBuild` from the client. The server side is `saveBuildParts` (6.4): find-or-create by number, link with "already linked" detection, and per-item results that carry the created key. The client side is `createdKeys` plus per-row error and Retry (7.2, 7.3). Per-row update failures surface the same way (HANDOFF gap 5) on both pages. Three server rules close the silent-failure gaps in updates: (1) an update always writes the stored summary, never the client's, so it can't renumber a Part (6.4 step 4); (2) `PartService.updateStory` sends `customfield_10204: null` when `powdercoat === 'None'` and `customfield_10207: null` when `thickness === 'None'`, because Jira REST clears a single-select with `null` and omitting the field left the old value in place while the row reported "Saved". `_buildJiraFields` (create) keeps omitting them, since a new issue has nothing to clear. This also applies to `PUT /api/stories/:key`, which is the intended behaviour there too; (3) keys missing from search fall back to `getIssue` for the membership check, so a retry-link right after a create isn't refused because of index lag (6.4 step 2). Error text on every per-item failure comes from `describeUpstreamError` (section 4.5). | Server for the no-duplicate, membership and stored-summary invariants; client for presentation | `buildService.test.js`: create, then a link failure returns `ok:false` with the key; a second call with a `link` for that key links only; a create with an existing number under the Assembly reuses it (`reused:true`, no `createIssue`) and `getStoriesByEpics` (chain-wide) is called once for a 3-create save; two creates with the same number in one request give one `createIssue`; a non-Build key gives 400; a links-read, chain-read or chain-Parts-read failure throws before any write; the update and link combo; skipping already-linked Parts; **an update and a link whose key belongs to another Assembly get `ok:false` "isn't a Part of this Assembly" and no write**; a link to a key absent from `getStoriesByKeys` whose `getIssue` fallback returns a non-Part, or 404, gets the same; **a link to a key absent from `getStoriesByKeys` whose `getIssue` returns a Part with `customfield_10110` in the chain is linked** (the retry-after-create case); a `getIssue` fallback that rejects with 503 fails only that item, with `status: 503, source: 'tracker'` and "the team tracker didn't respond (503)"; **an update whose `summary` differs from the stored one calls `updateStory` with the stored summary**; a create whose link fails reports `error` starting "Created, but not added to Build 1: the team tracker didn't respond (503)"; **`creates[0]` with material "Steel" gets `ok:false, field:'material'` and no `createIssue`, while `creates[1]` is still created**; revision "B" on a summary with letter A gets `ok:false, field:'revision'`; **`getStoriesByKeys` rejecting with `new JiraApiError('…', 400)`, `getIssue` returning 404 for HAR-999 and a chain Part for HAR-2031, gives HAR-999 `ok:false` "isn't a Part of this Assembly" and HAR-2031 linked** (M1), while a 503 from `getStoriesByKeys` still fails the request; **`getLinkedParts` returning `[]` while HAR-2031's `issuelinks` hold a "Used In" entry with `outwardIssue.key` equal to the Build gives `alreadyLinked:true` and no `createIssueLink`** (M5), and **the same holds when the entry is reported the other way round (`inwardIssue.key` equal to the Build), one test per direction** (draft-4 review N1); a failing `issuelinks` read fails only that item; a create for a number held by a Revision A Part on a Revision B Build reuses the Revision A key (M2); **a reused create whose quantity differs from the stored Part calls `updateStory` with the stored summary and reports `updated:true`; one with identical fields reports `updated:false` and no `updateStory`** (N7). `createBuild`: a `cloneFromBuildKey` whose Epic Link is outside the chain gives 400 before `createIssue`. `buildRoutes.test.js`: every structural rule in 6.4; "invalid material in creates[1] gives a per-item error (200), creates[0] still created"; foreign `cloneFromBuildKey` gives 400; a `cloneBuildParts` that throws gives 200 with `build` set and `cloneError` set. `partService.test.js`: an update with powdercoat and thickness "None" sends `customfield_10204: null` and `customfield_10207: null`; an update with "Black" and "0.125" sends `{ value }`; a create with "None" omits both. Client: `__tests__/utils/designerSave.test.js`. |
| **B3** `previewParts` fails entirely if the Assembly `getIssue` (season lookup) fails; it must fall back to a `null` season | In `PartService._getAssemblySeason`, wrap `getIssue` in try/catch. On error: `console.warn('[preview] season lookup for', epicKey, 'failed:', err.status, err.message)` and return `null`. Legacy BOMs and rows with their own Project still identify. Rows that need the season come back `unidentified` with the existing "missing Project…" message, so the student sees why. | PartService | `partService.test.js`: when `getIssue` rejects, the preview still resolves, the season is `null`, and the BOM rows with a Project parse. |
| **B4** Rows OnShape marks excluded from BOM must be skipped, not reported as unidentified | In `BOMService._parseBOM`, right after the nested-row skip, `if (item.excludeFromBom === true) continue;`. The field name was verified in the saved live response (`/tmp/har2029-check/bom-app-call.json`): a top-level boolean, matching header `propertyId 57f3fb8efa3416c06701d61e` / `propertyName excludeFromBom`. Strings `"true"` are not treated as true; OnShape sends a boolean. | BOMService | `bomService.test.js`: an excluded row with no Part number is neither in `parts` nor `unidentified`; an excluded row with a valid number is skipped; `excludeFromBom: false` parses normally. |
| **B5** Re-pasting an OnShape URL for an existing Assembly creates a duplicate | 6.5 steps 2 and 3, plus the 6.6 re-check and the in-flight lock. | EpicService | `epicService.test.js`: an exact element and document match gives `exists`; a match on another workspace gives `matchedOn:'document'`; an element match in a different document is not a duplicate; a JQL `~` hit with a non-exact element is ignored; the recently-created map hits; two concurrent `onboardAssembly` calls give one `createIssue`; a summary drift gives 409; a Build failure returns `created` with `buildError`; an Assembly create failure creates no Build; `conflict` when the number is used by another element. `epicRoutes.test.js`: the url validation, the `problems` body, and `/search` not being captured by `/:key`. |
| **B6** HAR-2031 shows empty Build Number and OnShape Version Link (user report, message 6) | **Intended; no code writes them on a Part.** Build Number (`customfield_10501`), OnShape Version Link (`customfield_10502`) and Instructions Data (`customfield_10503`) are Build fields (`BuildField` in `buildConstants.js`). The createmeta probe shows them on the Part create screen too, so they appear, empty, on every Part. A Part can be in several Builds (HANDOFF: "Many-to-many with Builds via an issue link"), so a single Build Number on a Part would be wrong as soon as it is reused, and ValorBOM never writes these fields on a Part. A Part's Builds come from its "Used In" links, and ValorBOM shows them as "In Build 1" / "Also in Build 2" on the Designer and "Current?" on the Assembly page. After this refactor HAR-2031 gets linked to Build 1 (section 3.4, "How HAR-2031 gets linked"). Build 1's own Build Number is written when the Build is created (`createBuild` already sets `customfield_10501`), and its OnShape Version Link is written on Cut Version (`cutVersion` sets `customfield_10502`). Removing the three fields from the Part screen is a tracker admin change, outside this refactor (Q12). The empty Revision on HAR-2031 is B1 (new Parts) plus Q4 (this one existing Part). | PartService never writes Build fields on Parts; BuildService owns them on Builds | INC-1, `partService.test.js`: the fields passed to `createIssue` by `createStory` and `clonePart`, and the fields passed to `updateIssue` by `updateStory`, contain none of `customfield_10501`, `customfield_10502`, `customfield_10503`. INC-4, `buildService.test.js`: the fields passed to `createIssue` by a `saveBuildParts` create contain none of the three (the save endpoint doesn't exist before INC-4). INC-3, `buildService.test.js`: `createBuild` writes `customfield_10501` equal to the returned `buildNumber`; `cutVersion` writes `customfield_10502`. |

## 9. Edge cases

- **Unnumbered Assembly (HAR-1984):** both pages work. The Designer header shows the "(No number)" chip. Update from CAD identifies only rows that carry their own Project (B3 path).
- **`?build` points to a Build of another Assembly or a missing key:** the page ignores it, falls back to the default, and shows the notice "That Build isn't part of this Assembly; showing Build 2."
- **A Build that was just created is missing from search (index lag):** `mergeBuilds` (7.1) adds it to the list if the key is absent. For "+ New Build" the Designer has the `POST /api/builds` response itself. For onboarding, Home made the `/onboard` call, so the Build arrives through `location.state.onboard.build` and is merged in load step 1b, before the Build is selected and before `cad=1` runs (3.4). It stays until a reload returns it from search.
- **Build number race (existing behaviour, not fixed here):** `createBuild` reads the max Build Number, then writes. Two creates seconds apart, before Jira indexes the first, can both get N. The client reduces this for one tab by disabling "+ New Build" / "Create Build N" from the click until the new Build is in its list. Two students on two tablets can still collide; fixing that needs a server-side lock or a Jira-side sequence and is out of scope.
- **A CAD material that isn't on the list** (for example "Steel"): the row is held back with a pick-a-material error; the rest of the Save goes ahead (sections 3.4, 6.4, 7.3).
- **A Revision chain longer than 1:** the Designer and Assembly page both show the Revision select. The page lists Builds for the selected Revision. Numbering uses the whole chain (server-derived). Parts are read across the whole chain (section 6.8): a Part created under Revision A that is in a Revision B Build shows under "In Build N"; a CAD row whose number belongs to a Revision A Part shows as existing, not New; and Save reuses that Part instead of creating a second ticket with the same number (6.4 step 3). Changing a carried-over Part's fields on Revision B updates the Revision A ticket, because it is the same Part; a Part that needs to differ is a Re-create (Assembly page). HANDOFF gap 4 (the chain walks backward only) is unchanged: opening an old Revision's key won't list newer Revisions. That is out of scope and noted for the backlog.
- **Cut Version on a non-Draft Build:** disabled in the UI, using the `statusThisSession` overlay so a lagging Build list can't re-enable it (3.4, 7.1). A forced or concurrent request (second tab, crafted call) is refused by the server with 409 **before** anything is written: `cutVersionFromOnshape` reads the Build by key and checks its type, Assembly and Draft status before `createVersion`, and an in-flight lock per Build serializes two simultaneous cuts (6.9). Without that check, a second cut would make a second OnShape version and overwrite the Build's OnShape Version Link before Jira rejected transition 11. A repeat cut of an Active Build whose stored link is this document's is not refused: it resumes the supersede stage only and answers 200 `resumed: true` (6.9 step 2). The OnShape ids always come from the Assembly record, never the request (6.9).
- **A Cut Version that fails partway** (6.9, `cutStage`):
  - `link` (the OnShape version exists but its link wasn't saved): Retry makes one more OnShape version. The copy says only "Try again."
  - `transition` (link saved, Build still Draft): Retry reuses the stored version (step 3).
  - `supersede` (Build Active, an older Build still Active): Retry, or the two-Active repair button (3.4), runs only the supersede stage, reading each sibling's status by key so a lagging search can't hide an Active sibling. Until then both pages show the "both Active" warning. If the student never retries, the warning stays on every load while two Builds are Active, so the state is visible and fixable from either page. The warning appears only after a by-key status check (6.10) confirms both are Active, so a lagging search alone never shows it. In the tab where the cut failed, the only button is "Finish cutting" the Build that was just cut, so the student can't supersede it by mistake. In any other tab, buttons are offered only for Builds whose version link is this document's, and every button goes through a confirm whose default is Cancel, because Supersede can't be undone from ValorBOM.
- **Clone or Re-create right after another one (search lag):** the new Part comes back in the response and is shown through `createdParts` (7.2). A second Clone in the same process gets the next number from the allocation floor, not the lagging search (6.9). A second Re-create of the same Part is disabled on the page (session entry, or `hasNewerRevision` over the merged Parts) and refused with 409 by the server, which checks the old Part's `Revises` link by key, its own `recentlyRecreated` map, and the chain for a Part with the new number (6.9). A Clone right after a Designer Save that created a CAD-numbered Part allocates above that number, because `createStory` raises the floor (6.9).
- **Re-create whose `Revises` link fails:** the new ticket exists without a link to the Part it replaces. The server returns its key and Part object in the error body, doesn't add it to the Build, and refuses a Retry (409). The page shows the new Part with "Move here". The missing link is logged at `warn` with both keys, so a mentor can add it by hand in the tracker; ValorBOM doesn't repair it (no writes beyond what the student asked for). Only the Revision history of that Part is affected: its Build membership and number checks don't use the `Revises` link.
- **Move from a second tab:** Move is a save `links` item, so a Part the other tab already linked comes back `alreadyLinked: true` and no second "Used In" link is sent (6.4 step 5, 6.7).
- **Update from CAD with no OnShape ids on the Assembly** (a legacy Assembly): the button is disabled, with the help text "This Assembly has no OnShape link."
- **Many pending operations:** the client always splits them into sequential requests of at most 25 (`batchBody`, 7.3) and shows "Saving 25/60…". The server cap of 200 per request is only a backstop. If a response is lost mid-run (tab closed, network drop), at most one batch's results are unknown; on the next Update from CAD those rows match existing Parts by number (chain-wide `byNumber` on the server, `createdKeys` on the client), so a re-save links or updates them instead of creating duplicates once search has indexed them.
- **A Part key, or any non-Assembly key, in `/a/:key/...` or `GET /api/stories?chain=1`:** the page's `GET /api/epics/:key` already answers 400 (3.6); the chain read also answers 400 "\"HAR-2031\" is not an Assembly" without sending the Epic Link query (6.8).
- **Search lag on links:** right after a Save, `GET /api/builds/:b/parts` (JQL `linkedIssues`) may not list a Part that was just linked. `linkedThisSession` keeps it under "In Build N" on the client, and the server checks the Part's own `issuelinks` before linking again (6.4 step 5), so a second Save never sends a duplicate link.
- **A Part deleted or moved in the tracker while the page is open:** Save's key-list read gets a 400 from Jira; the server checks the keys one at a time, the missing one fails with "HAR-123 isn't a Part of this Assembly", and the rest save (6.4 step 2).
- **CAD edited seconds before Update from CAD:** the button sends `fresh: true`, which bypasses the 60-second BOM cache (6.8).
- **The same full number twice in the BOM:** `BOMService._parseBOM` already merges repeated numbers into one row with the summed quantity (existing behaviour), before `detectDuplicates` runs, so `duplicates` from `previewParts` is always empty and the Designer shows one row. `DuplicateWarning` stays in the component tree only because it is harmless; it never renders from a preview. The server's in-request `byNumber` reuse (6.4 step 3) remains as defensive code for crafted requests.
- **A Part number already used under another Assembly:** not detected. `byNumber` covers only this Assembly's Revision chain, so a BOM row whose number matches a Part of a different Assembly creates a new Part here. HANDOFF says Parts never span Assemblies, so a matching number elsewhere is either a CAD numbering mistake or a deliberate copy. Flagging it in the preview is out of scope and asked as Q11.
- **A pasted URL with extra parameters** (`?configuration=…`) or surrounding whitespace: trimmed, and the regex still matches.

## 10. Security and exposure

- **Bind:** no listener changes. The server keeps `HOST || '127.0.0.1'`. The Playwright Vite instance binds `--host 127.0.0.1` (section 13), never `0.0.0.0`.
- **Auth:** gating is unchanged, per the user's constraint. The new BOM endpoints, including the writing ones (`/api/epics/onboard`, `/api/builds/:key/save`), are on the same ungated surface as today's `/api/epics/from-url` and `/api/stories`. So this refactor adds no new class of exposure. It is still a finding, recorded here and in Q5: anyone who can reach the server can create Jira issues through the BOM API. That is safe only while the server stays loopback-bound, or behind a gate when deployed. `index.js` already warns at startup when bound beyond loopback without auth. **User decision (Q5): no auth on BOM writes in this refactor.** INC-9 adds a "Security: BOM writes are ungated" note to `docs/v3/HANDOFF.md` stating that every BOM write endpoint (`POST /api/epics/onboard`, `POST /api/builds`, `POST /api/builds/:key/save`, `POST /api/builds/:key/cut-version`, `POST /api/builds/:key/archive`, `POST /api/builds/:key/parts`, `POST /api/builds/:key/parts/:partKey/recreate`, `POST /api/parts/:key/clone`, `PUT /api/stories/:key`) must go behind the existing Authentik gate **before** the server is ever reachable from other machines (any `HOST` other than loopback, or any deploy). The INC-9 removal of `POST /api/stories` and `POST /api/parts/upload` (Q6) shrinks this ungated write surface.
- **Injection:** user text never reaches JQL except key-shaped input (regex-validated, then `sanitizeJQL`) and OnShape ids (hex-validated). Search matching happens in JavaScript. `GET /api/builds/status` (6.10) is read-only, validates every key with `validateIssueKey`, caps the list at 10, and uses only `getIssue`, never JQL.
- **Secrets:** new logging prints only status and message, never error objects or request configs. No `.env` changes.

## 11. Testability summary

- **Unit (Jest, server):** `assemblySearch.js` (tokenize, match, rank, group, season parsing), the EpicService search, onboarding, `toAssembly`, BuildService `createBuild`, `saveBuildParts` (including the 400 key-list fallback and the two-direction `issuelinks` check) and `cloneBuildParts` partials, the section 6.9 guards (clone number floor, Re-create 409, Cut Version check, lock and resume), the PartService B1/B3/B6 and chain-read changes, `partChain.js` (`preferNewestRevision`), and the BOMService B4 and `fresh` changes.
- **Route (Jest and supertest):** every validation rule, route order (`/search` vs `/:key`), and the 200/400/409 shapes.
- **Client pure logic (Jest):** `buildNames`, `designerRows`, `designerSave`.
- **Visual and interaction (Playwright, mocked API):** section 13.
- **Not automated:** a live end-to-end run against Jira and OnShape. The user does that after merge, following the test pass in INC-9.

## 12. Implementation plan (independently shippable increments)

Every increment ends with `npm test` green, `npx vite build --config src/client/vite.config.js` clean, a commit (Conventional Commits; no push), and its screenshots saved under `.agents/tasks/ux-refactor/screenshots/INC-n/`. Server increments produce no screenshots.

| ID | Scope | Files | Server/Jest tests to add | Screenshots |
|---|---|---|---|---|
| **INC-1** | B1, B3, B4, the B6 "no Build fields on a Part" assertions for `createStory`, `clonePart` and `updateStory` (the save-create assertion waits for INC-4), and `_validatePayload` throwing `badRequest` (400 instead of 500). Precondition for B1: the createmeta probe (done for draft 2, section 1) shows `customfield_10500` on the Part create screen; re-run it if the screens may have changed. Also (Q10) append `.agents/` and `tests/visual/output/` to `.gitignore`, and confirm with `git status --short` that `.agents/` no longer shows as untracked. | `src/server/services/partService.js`, `src/server/services/bomService.js`, `.gitignore` | The B1, B3 and B4 rows of section 8, including the `partRoutes.test.js` 400 cases, and the `partService.test.js` half of the B6 row | none |
| **INC-2** | Search endpoint; widened `getEpicByKey`; `toAssembly`; `validateIssueKey`; `HttpError(status, message, details)`, `badRequest(message, details)`, `conflict()`, the errorHandler `details` spread and `source` marker; `describeUpstreamError` | `src/server/utils/assemblySearch.js` (new), `src/server/utils/upstreamError.js` (new), `src/server/utils/validators.js`, `src/server/services/epicService.js`, `src/server/routes/epicRoutes.js`, `src/server/middleware/httpError.js`, `src/server/middleware/errorHandler.js` | `__tests__/utils/assemblySearch.test.js` (new): "0000", "facility 2027", "VF27", "har-2030", "2030", multi-token AND, ranking order, the Other group, the loose season for `VF27-0200 Tooling`. Plus epicService search (key lookup 404 ignored, non-Epic key hit dropped, lower-case `har-2030` upper-cased before `getIssue`, `har-2030` gives `total: 1` because the direct hit and the list match are merged by key, a Closed Assembly found only by `getIssue` is still listed with `closed: true`; with `includeClosed: true` the JQL has no `status not in` clause and a Closed Assembly matches by name; with it false the clause is present; the route answers 400 for `includeClosed=yes` and for a repeated `includeClosed`), `groups[].keys` only list keys in `results` and `total` counts before the cap (60 synthetic Assemblies, `limit` 50), `getEpicByKey` for an unnumbered and a non-Epic key, route validation and ordering, and `validateIssueKey` honouring a `PROJECT_KEY` set after import. `middleware.test.js`: `details` are spread into the body but can't overwrite `error` or `status`; `conflict()` gives 409; a `JiraApiError` 503 body has `source: 'tracker'`; an `OnshapeApiError` body has `source: 'onshape'`; an `HttpError` body has no `source`; `conflict('x', { buildStatus: 'Active' })` gives `status: 409` and `buildStatus: 'Active'`; a `details` object with a reserved key (`error`, `status`, `source`) throws at construction (section 6 preamble). `__tests__/utils/upstreamError.test.js` (section 7.3). | none |
| **INC-3** | Onboarding preview and commit (B5), Build 1 creation; `createBuild` returns a Build object, derives the chain and rejects a foreign `cloneFromBuildKey`; `POST /api/builds` validation and the clone partial; `getEpic` switched to `summary ~ "\"…\""`. The response-shape change only affects the legacy `/designer` page, which is already non-functional (section 6.3). **Precondition:** re-run `/tmp/ux-refactor-check/createmeta-epic.mjs` (read-only) and confirm the Epic (10000) create screen still lists `customfield_10104`, `10300`, `10301`, `10302` and `10500`, as it did on 2026-10-30 (section 1); stop and ask if any is missing. | `epicService.js`, `epicRoutes.js`, `buildService.js`, `buildRoutes.js`, `src/server/index.js` (wiring order and the `buildService` dependency) | The B5 row in section 8. `buildService.test.js`: chain union, returned object, `cloneBuildParts` partial, foreign clone source 400, the B6 `createBuild`/`cutVersion` field assertions. `epicService.test.js`: the onboarding `assembly` built without a read (6.6). `buildRoutes.test.js`: the 6.3 validation and `cloneError`, including `description` (a 61-character value gives 400; a number gives 400; a control character gives 400; `"   "` is accepted as absent). `buildService.test.js`: summary `Test Assembly Build 2` with no description, `Test Assembly Build 2 - 1in bash bar` with `description: '1in bash bar'`, and `customfield_10501` equal to `2` in both. `epicService.test.js`: `getEpic` phrase JQL; onboarding's Build 1 summary has no ` - ` suffix. | none |
| **INC-4** | `POST /api/builds/:key/save` (B2 server): structural route validation, per-item field validation, chain membership for updates and links with the `getIssue` fallback and the 400 key-list fallback, stored summary on updates, one chain-wide `byNumber` map, reused creates updated when fields differ, the `issuelinks` check before every link, `describeUpstreamError` per-item text; `updateStory` clears Powdercoat/Thickness on "None" (also `partService.js`). Chain-scoped Part reads (section 6.8): `getStoriesByEpics`, `getStoriesForChain`, `preferNewestRevision`, `GET /api/stories?chain=1`, preview validation, chain comparison and `fresh`; the non-Assembly 400 in `getStoriesForChain`. Clone, Re-create and Cut Version changes (section 6.9): returned Part objects, the clone number floor and per-season lock, the Re-create 409, and the Cut Version by-key check, lock and resume. Draft-5 review additions: the clone floor raised in `createStory`; `partFromWritten`'s full `_parseStories` mapping; Re-create's lock, target-Build chain check, `recentlyRecreated` map, number guard and `revises-link` handling (with the `createRevision` wrap in `revisionService.js`); Cut Version reading the Assembly's OnShape ids, the Active resume, the by-key supersede stage and `cutStage`. Draft-6 review additions: `GET /api/builds/status` (6.10, `getBuildStatuses`); the either-side `Revises` guard with the later-letter rule; one `try/catch` tagging every `_supersedeActiveSiblings` failure, the search included, as `'supersede'`. | `buildService.js`, `buildRoutes.js`, `partService.js` (`updateStory` null-clearing, chain reads, `revisionService` dependency, `partFromWritten`, clone allocation), `partRoutes.js`, `bomService.js` (`fresh` option), `src/server/utils/partChain.js` (new), `index.js` (construct `revisionService` before `partService` and inject it; inject `partService` into BuildService; `revisionService` is already injected there), `src/server/services/revisionService.js` (`createRevision` link wrap), `src/server/routes/buildRoutes.js` (cut-version body is `{ assemblyKey }`, ids ignored) | The B2 row in section 8 (server), the INC-4 half of the B6 row (save create writes no Build fields), the section 6.8 tests, the section 6.9 tests and the section 6.10 tests | none |
| **INC-5** | Tokens and primitives: `index.css` tokens with old variables aliased and no existing name redefined; `Button`, `Badge` changes; the `Card` disclosure fix (section 5: toggle button wraps only icon, title and chevron, `headerRight` stays a sibling, `no-print` and `card-header-inner` kept, body wrapper always rendered); `InlineSelect` `extraOption`; the old-variable alias table (section 4.2); new `Dialog`, `GlossaryTerm` (toggletip), `EmptyState`, `StickySaveBar`, `DisclosureMenu`; `AppNav`/`AppLayout` restyle plus skip link and `<main>`, **with today's `NAV_ITEMS` unchanged**; `api/client.js` `ApiError` and the new client functions; `lib/friendlyError.js`. Also the Playwright harness and the fixture generator (section 13). Every current page stays routed and reachable from the nav. | `src/client/src/index.css`, `components/ui/*`, `layout/*`, `api/client.js`, `lib/friendlyError.js`, `tests/visual/*` (new, tracked), `package.json` and `package-lock.json` (pinned `playwright` and `@axe-core/playwright` devDependencies; `test:visual` and `test:visual:fixtures` scripts), `Dockerfile` (`ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` before `npm ci`) | `__tests__/utils/friendlyError.test.js` | `nav-laptop.png`, `notfound.png`, `purchasing-signin.png`, `receiving-signin.png` (signed-out: gated pages still render the sign-in prompt), `purchasing-vendor-group.png` and `receiving-group.png` (signed-in mocks: header controls of collapsible Cards, including the vendor Source select, render and work), `focus-ring.png` (a Tab-focused nav link and a focused Card toggle). Interaction check: change the Source select in a vendor group and assert the group did **not** collapse (its table is still visible); click the vendor title toggle and assert it collapses and `aria-expanded="false"`. |
| **INC-6** | The new Designer page at `/a/:key/design`: header and mode switch, BuildPicker (chain-loaded Builds), NewBuildForm, the empty state, the parts table with groups and editable Material, Update from CAD (disabled with no Build), chain-wide Part loading (`GET /api/stories?chain=1` plus by-keys for linked Parts), Update from CAD with `fresh: true`, StickySaveBar with the save endpoint in batches of 25, client-side hold-back and per-row results, the `linkedThisSession` overlay, Add existing Parts, CutVersionDialog, the two-Active warning built as the shared `builds/TwoActiveWarning` component that INC-7 reuses (by-key status check through `fetchBuildStatuses`, `repairCandidates`, and the repair confirm `Dialog` with focus on Cancel; 3.4), the NewBuildForm's optional "What's different?" description with the `buildSummaryPreview` line (Q2), `?cad=1` with the StrictMode guard, the state E banner driven by `location.state`, load step 1b (`mergeBuilds` with `location.state.onboard.build`), the path-only `useBlocker`, and the Designer error states of section 3.6. **`/designer` becomes `<Navigate to="/" replace>`**, and the legacy `DesignerPage` content is deleted rather than renamed (it is already broken, so nothing that works is lost). Until INC-8, `/` is still the old Dashboard, so the redirect lands somewhere working. | `pages/DesignerPage.jsx` (rewritten, mounted at `/a/:key/design`), `components/assembly-shared/*`, `components/builds/*`, `components/designer/*`, `lib/buildNames.js`, `lib/designerRows.js`, `lib/designerSave.js`, `lib/partValidation.js`, `routes.jsx`, `layout/AppNav.jsx` (drop the "Designer" nav item, since its route now redirects) | `__tests__/utils/buildNames.test.js` (incl. the `buildSummaryPreview` cases, the chain next-number case, the `mergeBuilds` cases, the `overlayBuildStatus` lag case, and the `activeConflict` by-key, `repairCandidates` and `supersedeTargets` cases), `designerRows.test.js` (incl. the `linkedThisSession`, chain, `mergeParts` and New-Build-with-copy cases), `designerSave.test.js` (incl. the held-back material case and `batchBody`), `partValidation.test.js` (client/server parity) | `designer-no-builds.png`, `designer-no-builds-cad-disabled.png` (Update from CAD disabled with "Create Build 1 first."), `designer-new-build-form.png` (with "1in bash bar" typed; the run asserts the preview line reads "Test Assembly Build 3 - 1in bash bar" and that the `POST /api/builds` body carries `description: '1in bash bar'`), `designer-with-builds.png`, `designer-after-cad.png` (New, Changed, Other, unidentified warning, a held-back "Steel" row), `designer-save-partial-failure.png`, `designer-cut-version-confirm.png`, `designer-glossary-open.png`, `designer-tablet-1024.png`, `designer-tablet-768.png`, and the section 3.6 states: `designer-load-404.png`, `designer-builds-load-error.png`, `designer-cad-error.png`, `designer-new-build-error.png`, `designer-new-build-clone-partial.png`, `designer-cut-version-error.png`, `designer-save-error.png`, `designer-cut-version-already-cut.png` (the cut fixture answers 409 with `buildStatus: 'Superseded'`; the run asserts the Build's badge reads "Superseded", never "409"), `designer-cut-version-stage-link.png` and `designer-cut-version-stage-supersede.png` (error fixtures with `cutStage` `link` and `supersede`; the run asserts the "Try again." and "Try again to finish" copy respectively), `designer-two-active-builds.png` (Builds fixture: Build 1 Active with a version link of this document, Build 2 Active with a link of another document; the status fixture agrees both are Active; the run asserts exactly one button, "Make Build 1 the Active one", and none for Build 2), `designer-two-active-confirm.png` (the run clicks that button, asserts the dialog is open, names Build 2, and has focus on Cancel; presses Cancel and asserts **zero** cut-version requests; opens it again, confirms, asserts the request body is `{ assemblyKey: 'HAR-2030' }`, and after the `resumed: true` fixture the warning is gone), `designer-two-active-stale.png` (Builds fixture says both Active, the by-key status fixture says Build 2 is Superseded; the run asserts the "both Active" Alert is absent and one `GET /api/builds/status` was made; variant: the status fixture answers 503 and the run asserts the "Couldn't check…" line with [Check again] and no repair button), `designer-two-active-finish-cut.png` (a cut of Build 2 answers 503 with `cutStage: 'supersede'` while Build 1 is Active with this document's link; the run asserts the only button is "Finish cutting Build 2"), `designer-two-active-repair-409.png` (the repair cut answers 409 with `buildStatus: 'Superseded'`; the run asserts "Build 1 is no longer Active; nothing to fix." and that "has already been cut" is absent). Interaction check: every cut-version request body has no OnShape ids. Interaction check: after a successful cut whose Builds re-fetch fixture still says Draft, the Cut Version button is disabled with "Already cut". Also `designer-onboard-lagging-build.png`: the URL is `/a/HAR-2030/design?build=HAR-2051&cad=1`, the Builds fixture returns `[]`, and the onboard Build HAR-2051 is handed over as route state. Because Home doesn't exist until INC-8, INC-6 injects that state with `history.replaceState({ usr: { onboard: { assemblySummary, build } }, key: 'pw', idx: 0 }, '')` in an init script (react-router keeps route state under `usr`); INC-8 re-takes the shot through the real Home flow with the onboard fixture returning `build: HAR-2051`. The run asserts Build 1 is selected, "No Builds yet" is absent, and exactly one `POST /api/parts/preview` was made. |
| **INC-7** | The new Assembly page at `/a/:key/assemble`: tabs, BOM with the other-Builds section and editable Material, Move and Re-create, edit and Save via the save endpoint, the Clone dialog, the ⋯ disclosure (Archive only, with the "can't be undone from ValorBOM" confirm; Archived is final, no un-archive), **no Cut Version button or `CutVersionDialog` (Q3)**, each Build's status chip, OnShape version link and the Draft "Open Designer" line (3.5), **the two-Active Build warning and its confirm-gated repair path through the shared `builds/TwoActiveWarning` from INC-6** (all four steps of 3.4: detect, by-key re-check through `fetchBuildStatuses`, safe-Build-only buttons via `repairCandidates` with `cutFailedKey` always `null`, and the repair confirm `Dialog` with focus on Cancel, including its 200, 409 and other-failure handling and the `role="status"` "Couldn't check…" line), `?view=compare` (no differences toggle), `?view=print`, the empty state. **`/assembly/:key` becomes a redirect to `/a/:key/assemble`** (keeps the search string), and `AssemblyHubPage` stops being routed. | `pages/AssemblyPage.jsx`, `components/assembly/*` (moved from `hub/`), `routes.jsx` (uses `components/builds/TwoActiveWarning` unchanged) | none beyond INC-6 libs (uses `buildNames` including `overlayBuildStatus`, `activeConflict`, `repairCandidates`, `supersedeTargets`, `dropAgreedStatus`; and `partValidation`) | `assembly-two-active-builds.png` (Builds fixture: Build 1 Active with a version link of this document, Build 2 Active with another document's link; status fixture agrees; the run asserts the "Build 1 and Build 2 are both Active" Alert, exactly one button "Make Build 1 the Active one", none for Build 2, and no "Finish cutting" button), `assembly-two-active-confirm.png` (the run clicks that button, asserts the dialog names Build 2 and focus is on Cancel; Cancel sends **zero** cut-version requests; confirming sends exactly one `POST /api/builds/HAR-2051/cut-version` with body `{ assemblyKey: 'HAR-2030' }`, and after the `resumed: true` fixture the warning is gone), `assembly-two-active-stale.png` (by-key status fixture says Build 2 is Superseded; the run asserts no Alert and one `GET /api/builds/status`; variant: status 503 shows the "Couldn't check…" line with [Check again] and no repair button), `assembly-two-active-repair-409.png` (the repair answers 409 with `buildStatus: 'Superseded'`; the run asserts "Build 1 is no longer Active; nothing to fix." and that "has already been cut" is absent). Interaction check: on every Assembly-page screen there is no element with the accessible name "Cut Version", and the ⋯ disclosure holds only "Archive Build". Plus `assembly-page.png`, `assembly-no-builds.png`, `assembly-clone-dialog.png`, `assembly-menu-open.png`, `assembly-archive-confirm.png`, `compare.png`, `print-preview.png`, `print-media.png` (`page.emulateMedia({media:'print'})`), `assembly-tablet-1024.png`, `redirect-assembly-key.png` (lands on `/a/HAR-2030/assemble`), `assembly-load-error.png` (5xx with Retry), `assembly-action-error.png` (a Move fixture answering 503; the Alert shows "the team tracker didn't respond (503)" and the row buttons are enabled again), `assembly-after-recreate.png` (after a Re-create, with the chain-Parts and by-keys fixtures unchanged, the run asserts the new revision row VF27P-0003B is visible in the Build and the source row's "Re-create here" is disabled), `assembly-after-clone.png` (after a Clone with unchanged fixtures, the new Part row is visible under Parts in other Builds), `assembly-recreate-link-failed.png` (the Re-create fixture answers 503 with `stage: 'revises-link'`, `key` and `part`; the run asserts the new row with "Move here" and the source row's Re-create disabled), `assembly-recreate-already-revised.png` (chain-Parts fixture holds VF27P-0003A and VF27P-0003B with no session state; the run asserts the 0003A row's "Re-create here" is disabled and its tooltip names the 0003B key). Interaction check: "Move here" sends `POST /api/builds/HAR-2052/save` with `{ links: [{ ref: 'HAR-2035', key: 'HAR-2035' }] }` and no request goes to `POST /api/builds/:k/parts`. |
| **INC-8** | Home at `/` (search, results, groups, states), ChooserDialog, `/a/:key` ChooserPage, OnboardBox and dialogs A to D and F, the onboarding navigation including the state E handoff. **`NAV_ITEMS` switch to the new set** (section 2). **`/assembly` becomes `<Navigate to="/" replace>`**, so the Build-less `PartsListTable` save path is no longer reachable. `DashboardPage` and `AssemblyBomPage` stop being routed. The "Include closed" toggle (3.1, Q8) mirrored to `?closed=1`, and the "Closed" chip. | `pages/HomePage.jsx`, `pages/ChooserPage.jsx`, `components/home/*`, `routes.jsx`, `layout/AppNav.jsx` | none (server done in INC-2/3) | `home-include-closed.png` (toggle on; the run asserts the search request has `includeClosed=1`, the URL has `closed=1`, and a closed result shows the "Closed" chip), `home-closed-by-key.png` (toggle off, query `HAR-1990` for a closed Assembly; the run asserts the request has no `includeClosed` and the result shows with the "Closed" chip), `home-empty.png` (grouped list; toggle off by default), `home-results-0000.png`, `home-results-facility-2027.png`, `home-no-results.png`, `home-no-assemblies.png`, `home-search-error.png` ("The team tracker didn't respond (503)"), `chooser-dialog.png`, `chooser-page.png`, `chooser-load-404.png`, `onboard-confirm.png`, `onboard-duplicate.png`, `onboard-properties-error.png`, `onboard-conflict.png`, `onboard-creating.png`, `designer-onboard-build-failed.png` (state E, reached by pasting a URL on Home and confirming, with the onboard fixture returning `build: null`; not by a direct URL), `designer-onboard-lagging-build.png` re-taken through Home (onboard fixture `build: HAR-2051`, Builds fixture `[]`; same assertions as INC-6), `designer-onboard-already-added.png` (the commit fixture answers `{ status: 'exists', assembly, build: HAR-2051 }`; the run asserts the URL has `?build=HAR-2051` and no `cad=1`, zero `POST /api/parts/preview` calls, and the "Already added; opened it." notice), `nav-final.png`, `redirect-assembly.png`, `home-tablet-768.png` |
| **INC-9** | Deletion and docs. Delete the dead components, pages and slices listed in section 5 after `grep -rn` shows no importers. Remove `/api/epics/from-url`, `GET /api/epics?seasonType`, `fetchEpics`, `createEpicFromURL`, `uploadSelectedParts` and their tests. **Remove the legacy create APIs (Q6):** the `POST /api/stories` route and the `POST /api/parts/upload` route in `partRoutes.js`, `PartService.uploadSelected`, and the client `createStory` and `uploadSelectedParts`, each only after `grep -rn` over `src/client/src` shows no reference (stop and ask if one remains). `PartService.createStory` stays (6.7). Update `docs/v3/HANDOFF.md`: status, gaps 3 and 5 closed, new routes, the removed endpoints, **"Security: BOM writes are ungated"** (section 10, Q5: every BOM write endpoint must go behind the Authentik gate before the server is reachable from other machines), and **"Archived Builds are final"** (Q9: ValorBOM has no un-archive action; a tracker admin can add a transition out of Archived later, and ValorBOM would then need a matching button and transition id). The only behaviour change is that the removed endpoints answer 404; no page route changes. | deleted files, `epicRoutes.js`, `epicService.js` (`getEpics`/`generateEpicFromURL` removed; `_parseEpics` kept only if still used), `partRoutes.js`, `partService.js` (`uploadSelected` removed), `api/client.js`, `__tests__/routes/epicRoutes.test.js`, `__tests__/services/epicService.test.js`, `__tests__/routes/partRoutes.test.js`, `__tests__/services/partService.test.js`, `docs/v3/HANDOFF.md` | Update or remove the tests for the deleted endpoints. Add route tests that `GET /api/epics?seasonType=R&year=26`, `POST /api/stories` and `POST /api/parts/upload` now answer 404 via `apiNotFound`, and that `GET /api/stories?key=…` and `PUT /api/stories/:key` still work. The INC-1 `partRoutes.test.js` B1 cases on `POST /api/stories` (revision `AA` and material "Steel" → 400) are replaced by the same two cases on `PUT /api/stories/:key` (still 400 through `_validatePayload`) and on `POST /api/builds/:key/save` (per-item `ok: false`), so B1's validation stays covered at the route level; the `partService.test.js` B1 cases on `createStory` are unchanged. `uploadSelected` tests are deleted with it. | the full re-run of every earlier screenshot as `final/` and the axe report `final/axe.json` |

The order puts the bug fixes and the server API first (INC-1 to INC-4), because the UI depends on them and they ship without UI risk. Each UI increment redirects the old route it replaces in the same increment: `/designer` in INC-6, `/assembly/:key` in INC-7, `/assembly` and the nav in INC-8. So after every increment each nav item leads to a working page, and no increment leaves a page routed that it calls broken. Reachability of the new pages before Home exists: after INC-6 the new Designer is reachable by direct URL only (it replaces a page that didn't work, so nothing is lost). After INC-7, the old `/assembly` page's existing "Open the Assembly hub" link (`AssemblyBomPage.jsx:33`) goes through the `/assembly/:key` redirect to the new Assembly page, whose mode switch opens the Designer. The Build-less `/assembly` save path stays live until INC-8; that is today's behaviour, and the earliest point it can go is when Home exists to replace it. Cleanup (INC-9) is last; its only behaviour change is that the removed legacy endpoints answer 404, and no page uses them by then.

## 13. Playwright visual verification

**Where Playwright lives: the repo's `devDependencies` (Q7),** run with `npm run test:visual`. INC-5 installs with `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i -D --save-exact playwright@<X> @axe-core/playwright`, where `<X>` is pinned to the exact release whose `node_modules/playwright-core/browsers.json` lists `"name": "chromium"` with `"revision": "1228"` (the revision cached at `~/Library/Caches/ms-playwright/chromium-1228`, alongside `chromium_headless_shell-1228`). The implementer finds `<X>` by installing a candidate with downloads skipped and reading that file; if it doesn't say 1228, uninstall and try the adjacent release. No browser download happens at any point during implementation; if no release matches, stop and ask instead of downloading. The chosen version and its revision are written in `tests/visual/README.md`, together with the one-time setup for a machine with no cached browser (`npx playwright install chromium`). `@axe-core/playwright` is pinned with `--save-exact` too.

- **`package.json`:** `"test:visual": "node tests/visual/shots.mjs"`, plus `"test:visual:fixtures": "node tests/visual/make-fixtures.mjs"` to regenerate fixtures. `npm test` (Jest) is unchanged: its `testRegex` is `/__tests__/.*\.test\.js$`, so nothing under `tests/visual/` is picked up.
- **Dockerfile:** the builder stage gets `ENV PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` before `RUN npm ci`, so an image build never fetches browsers whichever Playwright release is pinned. `npm prune --production` (Dockerfile line 19) already drops both packages from the runtime image.
- **Mocked API:** the runner never talks to a real server. It routes with the pathname predicate `url.pathname.startsWith('/api/')` (runner details below).

**Where the scripts live.** Because `.agents/` is now ignored (Q10), anything `npm run test:visual` needs must be tracked, so the harness moves out of `.agents/` into **`tests/visual/`** (tracked):

- `tests/visual/fixtures/*.json`: one per API response (tracked, regenerated by `test:visual:fixtures`).
- `tests/visual/make-fixtures.mjs`: builds those fixtures.
- `tests/visual/shots.mjs`: the screenshot runner. It takes `--inc INC-n` (or `--all`) to select scenarios, and writes PNGs and `axe.json` to `SHOTS_DIR`, default `tests/visual/output/`.
- `tests/visual/README.md`: how to run it.

`tests/visual/output/` is added to `.gitignore` with `.agents/` (INC-1, Q10). For this effort the implementer runs `SHOTS_DIR=.agents/tasks/ux-refactor/screenshots/INC-n npm run test:visual -- --inc INC-n`, so the review screenshots land under `.agents/` (ignored) as section 12 expects. Every increment's commit still stages files by explicit path, never `git add -A` or `git add .`, and checks `git status --short` before committing.

**Fixtures with real response shapes.** `make-fixtures.mjs` imports the real services (`EpicService`, `BuildService`, `PartService`, `BOMService`) and wires them to **fake clients** that return recorded or synthesized raw Jira/OnShape payloads. Fixtures are therefore produced by the same parse code the server runs, and can't drift from it. The services read `PROJECT_KEY` at module load (default `VAL`), so `make-fixtures.mjs` sets `process.env.PROJECT_KEY = 'HAR'` as its first statement and loads every service with dynamic `await import(...)` after that line; a static `import` would be hoisted above the assignment. The script asserts that a generated key starts with `HAR-` and exits non-zero otherwise.

Purchasing and receiving fixtures (`GET /api/purchasing/queue`, `GET /api/receiving`) for the two signed-in Card screenshots are produced the same way where the service can be built with fakes. Where it can't, they are copied from the response objects the existing route tests assert on, and their top-level keys are checked against what `PurchasingQueuePage` and `ReceivingPage` read. The signed-out screenshots return 401 `{ error, status: 401, loginUrl: '/auth/login' }` for those paths.

- Raw inputs: `/tmp/har2029-check/bom-app-call.json` (the real BOM, with a second row added that has `excludeFromBom: true`, a third with an empty Revision, a fourth new Part, and a fifth new Part whose OnShape material is "Steel"), plus raw Jira issue JSON for HAR-2030 and HAR-2031 reconstructed from the values in the reports. Extra synthetic Assemblies cover HAR-1972 to 1984, and synthetic Builds HAR-2051/2052/2053 cover Draft, Active and Superseded.
- Outputs:
  - `GET /api/epics/search` for `""`, `"0000"`, `"facility 2027"`, `"bash"` (empty), and an empty tracker; `""` with `includeClosed=1` (adds a synthetic Closed Assembly HAR-1990 "VF27A-0900A Old Intake"); and `"HAR-1990"` without it (found by the direct key lookup, `closed: true`);
  - `GET /api/epics/HAR-2030`;
  - `GET /api/revisions/chain/HAR-2030`;
  - `GET /api/builds?assemblyKey=HAR-2030&revisionChainKeys=HAR-2030` for 0 Builds and for 3 Builds (the route matcher ignores the order of `revisionChainKeys` values);
  - `GET /api/builds/:b/parts`;
  - `GET /api/stories?key=HAR-2030&chain=1` (generated through `getStoriesForChain` with a fake chain of one ticket);
  - `GET /api/parts/by-keys`;
  - `POST /api/parts/preview`;
  - `POST /api/builds/:k/save` in an all-ok and a partial-failure variant;
  - `POST /api/epics/onboard/preview` for new, exists, conflict and 400-problems;
  - `POST /api/epics/onboard` for created, and created with `buildError`;
  - `POST /api/parts/:key/clone` and `POST /api/builds/:k/parts/:p/recreate` success responses carrying `part` (generated through the real `clonePart` and `recreateForBuild` with fake clients), the Re-create 409 (with `recreatedAs`), `POST /api/builds/:k/cut-version` success, resumed success (`resumed: true`) and 409 (with `buildStatus`), a Move `POST /api/builds/:k/save` with one `links` result, and `POST /api/builds` with copy returning `linked`;
  - error fixtures for section 3.6, produced by making the fake client throw a real `JiraApiError` or `OnshapeApiError` and passing it through the real `errorHandler`, so the body (including `source`) matches what the server sends: `GET /api/epics/HAR-9` 404, `GET /api/epics/HAR-2030` 503, `GET /api/builds` 503, `POST /api/parts/preview` OnShape 502 and the "missing required columns" 500, `POST /api/builds` 503 and a copy with `failed[]`, a Move save (`POST /api/builds/:k/save` with one `links` item) 503, `POST /api/builds/:k/cut-version` OnShape 502 and tracker 503 with `cutStage` `link` and `supersede` (made by rejecting the fake's `updateIssue` or sibling transition inside the real `cutVersionFromOnshape`), `POST /api/builds/:k/parts/:p/recreate` 503 with `stage: 'revises-link'` (the fake rejects the `Revises` `createIssueLink`), and `POST /api/builds/:k/save` 503 for the whole request.
- No credentials are involved: the fakes never construct a real client.

**Runner (`shots.mjs`):**

- Start a **separate Vite** with `PORT=9 npx vite --config src/client/vite.config.js --host 127.0.0.1 --port 5191 --strictPort`. The process-env `PORT=9` makes the dev proxy target a dead port. Vite's `loadEnv` lets an existing `process.env` value win over `.env`, so even a missed mock can't reach a real local API server, and through it Jira. Binding `127.0.0.1` keeps it local. 5173 stays free for the user's own dev server.
- `context.route((url) => url.pathname.startsWith('/api/'), handler)` serves fixtures by method, path and query, with per-scenario overrides. It uses a **pathname predicate, not a glob**: Vite's `root` is `src/client`, so the API client module is served as `/src/api/client.js`, and Playwright's `**/api/**` glob would match and abort it, breaking every page. **A request whose pathname starts with `/api/` and has no fixture is aborted, and the run fails**, listing the URL. Before the first scenario, a smoke check runs `page.goto('http://127.0.0.1:5191/src/api/client.js')` (a page navigation, so it passes through `context.route`, unlike `page.request`) and asserts the response status is 200 and the route handler was not called for it.
- Viewports: 1366×768 (laptop), 1024×768 and 768×1024 (tablet). Screenshots are full-page PNGs. The clock is frozen with `page.clock.setFixedTime` so the print date is stable.
- Interaction checks happen during the run and fail it on error. The run types in search and checks the debounced result count, opens the chooser with Enter, checks that focus moved into the dialog and that Esc returns focus to the card, presses Tab to show focus rings, runs Update from CAD, ticks HAR-2031, clicks Save, and asserts the request body the save handler received deep-equals `{ creates: [], updates: [], links: [{ ref: 'HAR-2031', key: 'HAR-2031' }] }` in the links-only scenario. In that same scenario the post-save `GET /api/builds/HAR-2051/parts` fixture still returns `[]` (search lag), and the run asserts HAR-2031 is shown under "In Build 1", not "Not in any Build" (`linkedThisSession`). It also asserts the Update from CAD button's preview body has `fresh: true`. In the after-CAD scenario it asserts the held-back "Steel" row is **absent** from `creates` and the other new row is present. It also checks that `cad=1` triggers exactly one `POST /api/parts/preview` (the dev server runs StrictMode), that the handed-over onboard Build is selected when the Builds fixture is empty (`designer-onboard-lagging-build`), that no error screen contains the text "Request failed with status code", that a vendor group's Source select change doesn't collapse the group (INC-5), and that the state E banner appears after the Home onboarding flow with a `build: null` fixture (INC-8).
- **axe:** `@axe-core/playwright` runs on every screen. The run fails on `serious` or `critical` violations, and the report is saved as JSON.
- **Vocabulary check:** a DOM text scan on each screen fails the run if it finds `/\b(epic|epic link|issue|issue type|custom field|story|jira)\b/i` in visible text of the BOM screens (Home, chooser, Designer, Assembly, compare, print). Purchasing and receiving are excluded, since their copy is out of scope.
- **Console check:** the run fails on any `console.error` or `pageerror`. The one exception is Chromium's own "Failed to load resource: the server responded with a status of N" message, which is ignored only in scenarios whose fixture deliberately answers with that status N.
- Shut down Vite with `SIGTERM` in a `finally` block. Before finishing, confirm with `lsof -nP -iTCP:5191 -sTCP:LISTEN` that the listener was `127.0.0.1` and is now gone.

## 14. Out of scope

- OnShape metadata write-back (Phase 4).
- Instructions authoring (Phase 5); the print view keeps a placeholder line.
- The five-state Part lifecycle stepper (sheet 07). Only the glossary and the empty states are included, as requested.
- Activity log.
- Running `scripts/migrate-build-revision.mjs`.
- Jira admin and screen changes, including removing Build Number, OnShape Version Link and Instructions Data from the Part screen (B6, Q12; a manual follow-up, section 16).
- Fixing `getRevisionChain`'s backward-only walk (HANDOFF gap 4).
- Repairing HAR-2031's empty Revision field. B1 applies to new Parts only, and the app must not write HAR-2031's Revision (Q4; a manual follow-up, section 16).
- Auth on BOM write endpoints (Q5). HANDOFF.md records that they must be gated before the server is reachable from other machines (section 10, INC-9).
- An un-archive action for Builds (Q9). Archived is final in the UI.
- Flagging Part numbers that already belong to another Assembly (Q11; a follow-up, section 16).
- Any change to purchasing or receiving behaviour or gating.
- Writes to Jira or OnShape during implementation or verification.

## 15. User decisions (formerly open questions)

The user approved the design and answered every question on the approval round of draft 7. Each answer is folded into the sections named.

1. **Unnumbered Assemblies in search: listed**, tagged "(No number)" (3.1). No change from draft 7.
2. **Build names:** the default stays `<Assembly name> Build N`. The New Build form adds an optional short description, appended as ` - <description>` (e.g. "Test Assembly Build 2 - 1in bash bar"). Build Number stays numeric and is assigned by the app (3.4 "Build names", 6.3, 7.1 `buildSummaryPreview`, INC-3 and INC-6 tests).
3. **Cut Version: Designer only.** The Assembly page shows each Build's status and OnShape version link but has no Cut Version button; its ⋯ disclosure holds only Archive, where draft 7 put it (overview, 3.5, 3.6, section 5, INC-7).
4. **HAR-2031's Revision: the app must not write it.** It is a manual follow-up in `final-report.md`: the user sets it to `A` in the tracker, or asks the orchestrator to (section 14, section 16).
5. **No auth on BOM writes for now.** INC-9 documents in `docs/v3/HANDOFF.md` that every BOM write endpoint must go behind the Authentik gate before the server is ever reachable from other machines (section 10, INC-9).
6. **Legacy create APIs are removed in INC-9:** the `POST /api/stories` create route and `POST /api/parts/upload`, once nothing in the client references them, with the tests updated to match (section 1, 6.7, INC-9).
7. **Playwright becomes a devDependency** with `npm run test:visual`, using the mocked-API approach with the route predicate `url.pathname.startsWith('/api/')` (tech stack line, section 13, INC-5).
8. **"Include closed" toggle on Home search,** off by default; when off, closed Assemblies still come up on an exact key match (3.1, 3.1.1, 6.1, INC-2 and INC-8).
9. **Archived is final in the UI:** no un-archive action. HANDOFF.md notes that a tracker admin can add a transition later (3.4 step 4, 3.5, INC-9).
10. **`.agents/` is added to `.gitignore`** (INC-1), together with `tests/visual/output/`. The visual harness therefore lives in tracked `tests/visual/` (section 13).
11. **Flagging Part numbers that already belong to another Assembly is a follow-up,** not in scope. Listed in `final-report.md` (section 14, section 16).
12. **A tracker admin removes Build Number, OnShape Version Link and Instructions Data from the Part screen by hand.** Listed as a manual follow-up. The app's "In Build" labels are enough in the meantime; no new UI is added for it (B6, section 14, section 16).

No open questions remain.

## 16. Follow-ups to list in `final-report.md`

The final report of this effort (`.agents/tasks/ux-refactor/final-report.md`, written after INC-9) must carry these items under "Manual follow-ups" and "Future work". None is done by the app or by the implementer.

**Manual follow-ups (tracker, by hand):**

- **HAR-2031 Revision:** set the Revision field (`customfield_10500`) of HAR-2031 to `A` in the tracker. The user does it, or asks the orchestrator to; ValorBOM never writes it (Q4).
- **Part screen fields:** a tracker admin removes Build Number (`customfield_10501`), OnShape Version Link (`customfield_10502`) and Instructions Data (`customfield_10503`) from the Part screen. Until then they show, empty, on every Part, and the "In Build" labels in ValorBOM are the source of truth (Q12, B6).

**Future work (not in this refactor):**

- **Part numbers that already belong to another Assembly:** have Update from CAD flag BOM rows whose full number already belongs to a Part of a different Assembly ("VF27P-0001A already exists under HAR-1984"), since Save would otherwise create a second Part with that number (Q11).
- **Gate BOM writes behind Authentik** before the server is reachable from other machines (Q5; also in HANDOFF.md).
- **Un-archiving Builds:** only if a tracker admin adds a transition out of Archived; ValorBOM would then need a button and the transition id (Q9; also in HANDOFF.md).

## Revision log

- Draft 1: initial design, with no review yet.
- Draft 2: responses to design-review draft 1 (all findings addressed; none backlogged or ignored).
  - **H1** Save validation split: structural errors only at the route (400); material/machinery/powdercoat/thickness/quantity/revision become per-item `ok:false` results with `field` (6.4). Material is an editable `InlineSelect` on both pages, with unlisted CAD values shown and marked `aria-invalid` (3.4, section 5). `planSave` holds back invalid rows using `lib/partValidation.js`, with a client/server parity test (7.3). Tests added to the B2 row and INC-4/INC-6.
  - **H2** Card section corrected: four collapsible callers named; disclosure button wraps only icon, title and chevron, `headerRight` is a sibling, header `div` loses its `onClick` (section 5). INC-5 adds `purchasing-vendor-group.png`, `receiving-group.png` and a "Source select doesn't collapse the group" check.
  - **M1** `ApiError(message, status, body)` added to `api/client.js` in INC-5; `AuthRequiredError` unchanged; onboarding branches on `err.status`/`err.body` (3.3, section 5).
  - **M2** Save loads `getStoriesByKeys` once and rejects updates/links outside the chain per item; `createBuild` rejects a foreign `cloneFromBuildKey` with 400 (6.3, 6.4); tests added.
  - **M3** State E handoff specified: `location.state.onboard.buildError`, no `cad=1`, banner replaces the empty-state text, Update from CAD disabled until a Build exists, state cleared after Build 1 (3.3 E, 3.4). `designer-onboard-build-failed.png` moved to INC-8 and driven through the Home flow.
  - **M4** Read-only createmeta probe run (`/tmp/ux-refactor-check/createmeta.mjs`): `customfield_10500` is on the Part (10103) and Build (10301) create screens. Recorded in the facts table and the B1 row; no open question needed.
  - **M5** Increments resequenced: INC-5 keeps `NAV_ITEMS`; INC-6 redirects `/designer` and deletes the legacy page content; INC-7 redirects `/assembly/:key`; INC-8 switches the nav and redirects `/assembly`; INC-9 only deletes. INC-3 notes the legacy Designer is already broken.
  - **M6** Builds load with `revisionChainKeys`; the picker filters by `assemblyKey`; `nextBuildNumber` uses the unfiltered list; test case added (3.4, 7.1).
  - **M7** Archive copy changed to "This can't be undone from ValorBOM."; Q9 added.
  - **N1** 502 claims removed; status passes through, network failure is 500 (section 6 preamble, 6.1, wireframe).
  - **N2** `getEpic` moves to `summary ~ "\"…\""` in INC-3, with a test (6.5).
  - **N3** `findPartByNumber` dropped; one `getStoriesByEpic` map per save (6.4).
  - **N4** Revision vs summary letter checked per item on creates (6.4, 7.3).
  - **N5** Compare toggle dropped; today's shared-first sort kept (3.5).
  - **N6** `?rev` dropped; the Revision select navigates to `/a/<revisionKey>/<mode>` on both pages (section 2).
  - **N7** `MenuButton` replaced by `DisclosureMenu` (no `aria-haspopup`); GlossaryTerm is a toggletip with `role="status"` (3.5, 4.5).
  - **N8** Save assertion includes `ref`; Playwright pinned to the release using chromium 1228 with downloads skipped; `make-fixtures.mjs` sets `PROJECT_KEY=HAR` before dynamic imports (section 13).
  - **N9** "Jira" removed from UI copy ("the team tracker"), `lib/friendlyError.js` added, `jira` added to the vocabulary regex; wireframes use "AL 6061".
  - **N10** Radius scale renamed `--r-*` (only `--radius` and `--radius-lg` exist today); staging-by-path rule for `.agents/`, plus Q10.
  - **N11** Key-shaped queries are upper-cased before lookup; `validateIssueKey` reads the project at call time.
  - **N12** `cad=1` guarded by a `useRef` and stripped before the request; Playwright asserts one preview call.
  - **N13** "STEP auto-export" label not carried into `DesignerPartRow` (section 5).
  - **N14** `total` and `groups[].keys` semantics defined (6.1).
  - **N15** Build-number race noted in section 9; "+ New Build" disabled until the new Build is listed (3.4).
- Draft 3: responses to design-review draft 2 (all 17 findings addressed; none backlogged or ignored).
  - **M1** Update `summary` is ignored at the route and the server writes the stored summary from `known` (6.4 validation and step 4); the example body drops it; test added to the B2 row.
  - **M2** `updateStory` sends `null` for 10204/10207 on "None"; create still omits them; tests and a B2 note (section 8, INC-4 scope and files).
  - **M3** Keys missing from `getStoriesByKeys` fall back to `getIssue(key, {fields:[issuetype,summary,customfield_10110]})`; 404 gives "isn't a Part", other errors fail only that item (6.4 step 2); tests for the retry-after-create link and a 503 fallback.
  - **M4** Load step 1b `mergeBuilds(fetched, location.state.onboard.build)` runs before Build selection and gates the `cad=1` effect (section 2, 3.3 A, 3.4, 7.1, section 9); `mergeBuilds` unit tests; `designer-onboard-lagging-build.png` scenario asserting Build 1 selected and one preview call (INC-6, re-taken in INC-8).
  - **M5** `errorHandler` adds `source: 'tracker'|'onshape'`; new `src/server/utils/upstreamError.js` `describeUpstreamError` builds per-item, clone and `buildError` text; `friendlyError` branches on `body.source` and `status` only (4.5, section 6 preamble, 6.3, 6.4, 6.6, 7.3); tests in `middleware.test.js`, `upstreamError.test.js`, `friendlyError.test.js`; INC-2 scope.
  - **M6** New section 3.6 table of error states for Chooser, Designer and Assembly page loads and actions, with copy, placement, recovery and a screenshot each; error fixtures generated through the real `errorHandler` (section 13); screenshots added to INC-6, INC-7 and INC-8; the console check tolerates only the deliberate "Failed to load resource" message.
  - **N1** `InlineSelect` gains `extraOption {value,label}`; its inventory row is now "Reused, extended" (section 5, 3.4, INC-5).
  - **N2** Card keeps `no-print`, `card-header-inner`, `card-title-icon`, `card-collapse-icon`; body wrapper always rendered with `hidden` (section 5).
  - **N3** Explicit alias table; only `--color-text-muted` (#9ca3af → #a3acb9) and the page background (`--bg`) change on purpose (4.2).
  - **N4** `useBlocker` fires only on pathname change; the Build switch has its own confirm (3.4 step 6).
  - **N5** `HttpError(status, message, details)`, `badRequest(message, details)`, `conflict()`; `errorHandler` spreads `details` first (section 6 preamble, 6.5, 6.6).
  - **N6** Local state justified with the HANDOFF quote and the `AssemblyHubPage` precedent (3.4).
  - **N7** DuplicateWarning claim corrected: `_parseBOM` merges repeated numbers (section 9).
  - **N8** Edge-case note plus Q11 for numbers used by another Assembly (section 9, 15).
  - **N9** Recently-created hit uses `getIssue` + `toAssembly`; the in-flight waiter compares its own `expectedSummary` and returns `exists` (with the first call's `build`) or 409 drift, and re-runs if the first call failed (6.5 step 3, 6.6 step 1).
  - **N10** `createBuild({ assemblyKey, revisionChainKeys, name, cloneFromBuildKey })` validates only; the route clones in try/catch (6.3, with code).
  - **N11** `_validatePayload` throws `badRequest`; `partRoutes.test.js` asserts 400 for `revision: 'AA'` (section 8 B1, INC-1).
- Draft 4 (2026-10-30): responses to design-review draft 3 (all 14 findings addressed; none backlogged or ignored).
  - **M1** A 400 from `getStoriesByKeys` (`key in (...)` naming a missing key) switches every update and link key to the per-key `getIssue` fallback; other errors stay fatal (6.4 step 2, facts table, section 9). Test with `JiraApiError` 400 added to the B2 row.
  - **M2** Part reads are scoped to the Revision chain: new section 6.8 (`getStoriesByEpics`, `getStoriesForChain`, `preferNewestRevision`, `GET /api/stories?chain=1`, chain-wide preview); Save's `byNumber` is chain-wide (6.4 step 2); the Designer loads chain Parts plus by-keys for linked Parts (3.4 step 1, 7.2). The chain is server-derived, not client-sent. Section 9's Revision-chain entry corrected; tests in 6.8, section 8 and `designerRows.test.js`; INC-4 scope and `index.js` wiring.
  - **M3** Playwright routes with `url.pathname.startsWith('/api/')` instead of `**/api/**`; smoke check that `/src/api/client.js` loads with 200 (section 13).
  - **M4** B6 row in section 8: Build Number, OnShape Version Link and Instructions Data are Build fields, never written on a Part, filled on the Build at create and Cut Version; tests for both services; facts table records 10501-10503 on the Part screen; section 1, section 14 and Q12 added.
  - **M5** Client `linkedThisSession` overlay merged into `linkedByPart` (7.2, 7.3, 3.4 step 5, 3.5 Move/Re-create); server checks the Part's `issuelinks` before every `linkPartToBuild` (6.4 step 5); tests in section 8 and `designerRows.test.js`; Playwright lag assertion (section 13).
  - **N1** Onboarding builds `assembly` with `toAssembly` from the created key and resolved properties, no read; test (6.6).
  - **N2** The key-shaped direct hit merges with the list by `key`; `har-2030` gives `total: 1` (6.1 step 3, INC-2 tests).
  - **N3** Both pages send at most 25 items per save request (`batchBody`); the server cap stays 200 (3.4 step 5, 6.4, 7.3, section 9).
  - **N4** Preview accepts `fresh: true`, sent by the Update from CAD button, which bypasses the 60-second BOM cache (3.4 step 4, 6.8).
  - **N5** Result card wireframe says "Revision A" (3.1).
  - **N6** Outcome B is a `Dialog` with focus on "Open in Designer" (3.3).
  - **N7** A reused create runs the update path when its fields differ from the stored Part and reports `updated: true` (6.4 step 3, 7.3); tests in the B2 row.
  - **N8** An `exists` response from the commit call navigates with `?build` and `state.onboard.build`, no `cad=1`, plus the "Already added; opened it." notice (3.3, 6.6); `designer-onboard-already-added.png` in INC-8.
  - **N9** The Assembly page with no Builds doesn't edit Parts; stated as intended, with the reason (3.5).
- Draft 5 (2026-10-30): responses to design-review draft 4 (all 8 findings addressed; none backlogged or ignored).
  - **M1** New section 6.9: Clone and Re-create return the new Part object built from the written fields (`partFromWritten`, no read); `clonePart` allocates numbers above a process-local per-season floor under a per-season lock, so a second Clone inside the lag window can't reuse a number; `recreateForBuild` reads the old Part's `Revises` link by key and answers 409 if it was already re-created. Client: `createdParts` overlay with `mergeParts`, `recreatedThisSession` disabling "Re-create here", and the `linked` keys of "+ New Build" with copy added to `linkedThisSession` (3.4 step 1b, 3.5, 3.6, 7.2, section 9). Tests in 6.9 and `designerRows.test.js`; Playwright `assembly-after-recreate.png` and `assembly-after-clone.png` (INC-7); fixtures (section 13); server work in INC-4.
  - **M2** `cutVersionFromOnshape` reads the Build by key before `createVersion`: non-Build or foreign Assembly gives 400, non-Draft gives 409; an in-flight lock per Build; a Draft Build with a stored version link resumes without a second OnShape version; a tracker failure after the OnShape write carries `onshapeVersionLink` in the error body (6.9). Client `statusThisSession` overlay via `overlayBuildStatus` keeps Cut Version disabled after a cut (3.4, 7.1). Section 9 corrected; new 3.6 rows for 409 and the half-done cut; tests in 6.9 and `buildNames.test.js`; `designer-cut-version-already-cut.png` and a disabled-after-cut check in INC-6.
  - **N1** The `issuelinks` duplicate check matches `Used In` with either `outwardIssue` or `inwardIssue` equal to the Build; one test per direction (6.4 step 5, B2 row).
  - **N2** Facts-table row reworded: `key in (...)` 400 is inferred from the `key =` probe, and the fallback handles either behaviour (section 1).
  - **N3** Ran the read-only Epic (10000) createmeta probe (`/tmp/ux-refactor-check/createmeta-epic.mjs`): 10104, 10300, 10301, 10302 and 10500 are present. Recorded in the facts table; INC-3 re-runs it as a precondition (section 1, 12).
  - **N4** The `saveBuildParts` B6 assertion moved to INC-4; INC-1 covers `createStory`, `clonePart` and `updateStory` (section 8 B6, INC-1, INC-4).
  - **N5** 6.6 step 3 now points to "the recently-created map of section 6.5 step 3"; the 6.7 parenthetical moved below the list, which also now sends the three changed endpoints to 6.9.
  - **N6** `getStoriesForChain` reads the starting key's `issuetype` first: 404 passes through, a non-Assembly gives 400 before any JQL; route tests added (6.8, section 9).
- Draft 6 (2026-10-30): responses to design-review draft 5 (all 8 findings addressed; none backlogged or ignored).
  - **M1** The Cut Version 409 detail is renamed `buildStatus` (`conflict('Build 1 has already been cut.', { buildStatus })`). The client reads `err.body.buildStatus` and writes no overlay entry when it is absent (3.4, 3.6, 7.1). The section 6 preamble reserves `error`, `status` and `source` as detail keys, and `HttpError` throws if one is used. Tests: `middleware.test.js` (409 body, reserved key), `buildRoutes.test.js` (cut-version 409 body), `buildNames.test.js` (overlay from `buildStatus`, none without it); the Playwright 409 shot asserts the badge never reads "409".
  - **M2** A repeat cut of an Active Build whose stored link is this document's resumes only the supersede stage and answers 200 `{ resumed: true }`; 409 is for Superseded, Archived, or Active without this document's link (6.9 step 2). The supersede stage reads each sibling's status by key before transition 21. `cutVersion` tags `err.details.cutStage` (`link`, `transition`, `supersede`), and 3.6 picks the copy by stage, so "it will reuse that version" is no longer shown after a `link` failure. A two-Active warning with a "Make Build N the Active one" button (which takes the resume path) gives a repair path on both pages (3.4, 7.1 `activeConflict`). Section 9 corrected. Tests for each stage, the resume, the by-key sibling read and the concurrent second call (6.9); Playwright shots for the `link` and `supersede` copy and the two-Active repair (INC-6).
  - **M3** `createRevision` wraps the `Revises` link and rethrows with `details = { key, revision, stage: 'revises-link' }`. `recreateForBuild` adds `part`, records the source in a 10-minute process-local `recentlyRecreated` map, and skips the `Used In` link. The 409 guard checks the `Revises` link, `recentlyRecreated`, and (for after a restart) a chain Part with the new number; a per-Part in-flight lock covers concurrent clicks (6.9 Re-create steps 1-4). Client: the error adds the Part to `createdParts` and the source to `recreatedThisSession`, with its own message and "Move here" (3.5, 3.6). Section 9 edge case added. Tests in `buildService.test.js` and `revisionService.test.js`; `assembly-recreate-link-failed.png` (INC-7).
  - **N1** `partFromWritten` maps each field as `_parseStories` does, with Machinery from `[0].value`, the `*.NONE` and `0` fallbacks, and `project`; `revision` is stated as an intentional extra key. Parity test against `_parseStories` (6.9).
  - **N2** The clone number floor is raised inside `createStory` from `applyPartMask(summary)` for every Part create, so a Save-created CAD number counts. Test: a save create of `VF27P-0008A` then a Clone with search max 7 gives `0009` (6.9, INC-4). The remaining Save-vs-Clone same-instant collision is stated as accepted.
  - **N3** The Assembly page's Move sends `POST /api/builds/:key/save` with `links`, so it gets the Build, chain and `issuelinks` checks; `POST /api/builds/:key/parts` stays on the server, unused (3.5, 3.6, 6.7, section 9). `recreateForBuild` reads the target by key and gives 400 unless it is a Build whose chain contains the old Part's Epic Link. I took the chain from the target Build's Assembly, not from the old Part's, because `getRevisionChain` walks backward only, and the Part's own chain would wrongly refuse a Revision A Part going into a Revision B Build. Tests in 6.9; Playwright Move-body check (INC-7).
  - **N4** The Re-create 409 copy ends "Re-create HAR-2041 instead." A new `hasNewerRevision(part, mergeParts(parts, createdParts))` disables "Re-create here" on any Part with a later letter of the same number, independent of session state (3.5, 3.6, 7.2). Tests in `designerRows.test.js`; `assembly-recreate-already-revised.png` (INC-7).
  - **N5** Cut Version reads the Assembly's `customfield_10300`-`10302` by key in step 2 and uses them; body ids are accepted but ignored, and the resume check compares against the stored `documentId`. I chose "ignore" over "400 on mismatch" because a mismatch can only be a stale page and has no student fix. A missing stored id gives 400 "This Assembly has no OnShape link." (6.9; `api/client.js` JSDoc in section 5; tests in 6.9; the Playwright run asserts cut bodies carry no ids).
- Draft 7 (2026-10-30): responses to design-review draft 6 (all 3 findings addressed; none backlogged or ignored).
  - **M1** The two-Active repair is rewritten as four steps (3.4). The warning shows only after a new read-only `GET /api/builds/status?keys=…` (6.10: `getIssue` per key, 1 to 10 keys, `validateIssueKey`, 404 or non-Build into `missing`, other errors fatal) confirms two Active Builds, so a lagging search can't raise a false positive; a failed check shows only a "Couldn't check…" line with [Check again]. `repairCandidates` (7.1) offers only "Finish cutting Build N" when the session holds `cutFailedKey`, otherwise only Builds whose link contains `/documents/<assembly.documentId>/v/`, and no button when none qualify. Every button opens a confirm `Dialog` ("Build 2 will be marked Superseded. This can't be undone from ValorBOM.") with focus on Cancel. A repair 409 has its own copy, "Build 1 is no longer Active; nothing to fix." (3.4, 3.6). Section 9, section 10 and the `api/client.js` row updated. Tests: 6.10 route and service tests, `buildNames.test.js` (`activeConflict` with by-key and `missing` entries, `repairCandidates`, `supersedeTargets`); Playwright `designer-two-active-builds.png`, `-confirm.png` (focus on Cancel, Cancel sends nothing), `-stale.png` (by-key fixture hides the warning; 503 variant), `-finish-cut.png` and `-repair-409.png` (INC-6). Server work in INC-4.
  - **N1** The Re-create `Revises` guard accepts an entry on either side and counts it as "already revised" only when the linked issue's `fields.summary` parses to the same season, year and number with a later letter; earlier letters, other numbers and missing summaries are ignored (6.9 step 3). Tests for both sides, the earlier-letter case (B re-created to C) and a different number.
  - **N2** `_supersedeActiveSiblings` tags every failure in its body as `cutStage: 'supersede'` with one `try/catch`, the sibling-key search included; the resume path carries the stored link (6.9). Tests: the search rejecting after transition 11, and on the resume path, give `'supersede'` with `details.onshapeVersionLink`.
- Draft 8 (2026-10-30): **user approval round.** The user approved draft 7 and accepted the suggested answer to every open question; the orchestrator added two corrections. No design-review findings were open other than C-B below.
  - **Q1 to Q12** folded in as recorded in section 15: Build description suffix (3.4, 6.3, 7.1, INC-3, INC-6); Cut Version Designer-only (overview, 3.5, 3.6, section 5, INC-7); HAR-2031 Revision and Part-screen fields as manual follow-ups (sections 14 and 16); no BOM-write auth now, with the HANDOFF.md warning (section 10, INC-9); legacy create APIs `POST /api/stories` and `POST /api/parts/upload` removed in INC-9, `PartService.createStory` kept, B1 route tests moved to `PUT /api/stories/:key` and the save endpoint (6.7, INC-9); Playwright as pinned devDependencies with `npm run test:visual`, the harness moved to tracked `tests/visual/`, Dockerfile `PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1` (tech stack, section 13, INC-5); "Include closed" toggle with `includeClosed=1` and the `closed` flag (3.1, 3.1.1, 6.1, INC-2, INC-8, fixtures); Archived final with the HANDOFF.md note (3.4, 3.5, INC-9); `.agents/` and `tests/visual/output/` in `.gitignore` (INC-1); Q11 listed as future work (section 16). Section 15 now records decisions; no open questions remain. New section 16 lists what `final-report.md` must carry.
  - **C-A (bug labels):** section 1 now states the agreed B1 to B5 list verbatim, and the section 8 row titles match it. Checked each fix against its label: B1 `_buildJiraFields` writes `customfield_10500`; B2 server per-item results with the created key, client `createdKeys` and per-row Retry that sends only a `link` (the swallow site is `DesignerPartsTable.jsx:201`); B3 `_getAssemblySeason` try/catch returning `null`; B4 `excludeFromBom === true` skip in `_parseBOM`; B5 the onboard preview and commit duplicate checks. The Build-less save path (legacy `/assembly`) is stated as separately in scope and closed by the INC-8 redirect plus the INC-9 removal of the legacy create APIs, not by B2.
  - **C-B (reviewer's open MEDIUM):** INC-7 now explicitly includes the two-Active Build warning and its confirm-gated repair on the Assembly page, through the shared `builds/TwoActiveWarning` built in INC-6 (3.4 states both pages implement all four steps; section 5 lists the component; 3.6 rows cover both pages). With no Cut Version on the Assembly page, its `cutFailedKey` is always `null`, so it offers only "Make Build N the Active one". INC-7 adds `assembly-two-active-builds.png`, `-confirm.png`, `-stale.png` (with the 503 variant) and `-repair-409.png`, plus an interaction check that no Assembly-page element is named "Cut Version".
