# Implementation Plan: ValorBOM Modernization

## Overview

Modernize ValorBOM from a monolithic callback-based Node.js app into a modular async/await architecture with ES modules, replacing deprecated dependencies (`request` → `jira.js` + `axios`), introducing a Vite + React frontend, and adding new features (epic from URL, selective upload, duplicate detection, auto STEP export, pagination fix). Tasks follow a bottom-up build order: infrastructure → utilities → clients → services → routes → frontend.

## Tasks

- [x] 1. Infrastructure modernization and project scaffolding
  - [x] 1.1 Update package.json to ES modules with new dependencies
    - Set `"type": "module"` in package.json
    - Replace `request`, `body-parser`, `browserify` with `jira.js`, `axios` (pinned to exact `1.7.9`), `react`, `react-dom`, `@tanstack/react-query`, `tailwindcss`
    - Add dev dependencies: `vite`, `@vitejs/plugin-react`, `fast-check`, `supertest`
    - Remove `cross-env` and `browserify` from devDependencies
    - Update Node.js engine field to `>=20`
    - Update scripts: remove `pack`, add `dev`, `build`, `preview` for Vite
    - _Requirements: 16.1, 16.3, 16.4, 16.5_

  - [x] 1.2 Update Dockerfile for Node.js 20+ LTS
    - Change base image from `node:18.19.1-bullseye-slim` to `node:20-slim` (or `node:22-slim`)
    - Maintain `USER node` directive for non-root execution
    - Add Vite build step (`npm run build`) before `CMD`
    - _Requirements: 16.2, 16.7, 18.4_

  - [x] 1.3 Create project directory structure
    - Create `src/server/` with subdirectories: `routes/`, `services/`, `clients/`, `utils/`
    - Create `src/client/` with subdirectories: `src/components/`, `src/hooks/`, `src/api/`
    - Create `__tests__/services/`, `__tests__/clients/`, `__tests__/utils/`, `__tests__/routes/`
    - _Requirements: 16.1_

  - [x] 1.4 Remove deprecated files and dependencies
    - Delete `sys/bom.service` and `sys/runner.sh` (entire `sys/` directory)
    - Remove the browserify `dist/` output directory if present
    - _Requirements: 16.6_

- [x] 2. Checkpoint - Verify infrastructure setup
  - Ensure project scaffolding is complete, `npm install` succeeds, and directory structure is in place. Ask the user if questions arise.

- [x] 3. Implement utility modules
  - [x] 3.1 Create BOM Constants module (`src/server/utils/bomConstants.js`)
    - Export `MATERIALS`, `MACHINERY`, `POWDERCOAT`, `THICKNESS` arrays with all valid values
    - Export `MATERIAL_MACHINERY_MAP` object mapping raw material substrings to `{ material, machinery }` pairs
    - Use ES module `export` syntax
    - _Requirements: 12.1, 12.2, 12.3_

  - [ ]* 3.2 Write property test for BOM Constants integrity
    - **Property 1: MATERIAL_MACHINERY_MAP consistency**
    - Verify all mapped `material` values exist in `MATERIALS` array and all mapped `machinery` values exist in `MACHINERY` array
    - **Validates: Requirements 12.3**

  - [x] 3.3 Create Part Mask Parser (`src/server/utils/partMask.js`)
    - Implement `applyTitleMask(text)` returning `TitleMaskResult | null` for epic pattern `V[RF]\d{2}A-\d{4}`
    - Implement `applyPartMask(text)` returning `PartMaskResult | null` for part pattern `V[RF]\d{2}P-\d{4}[A-Z]`
    - Implement `isValidPartNumber(text)` returning boolean
    - Implement `formatPartNumber(parsed)` for pretty-print round-trip
    - Port logic from `ValorBOM.applyTitleMask` and `ValorBOM.applyPartMask` static methods
    - _Requirements: 6.1, 6.2, 6.3, 6.4_

  - [ ]* 3.4 Write property test for Part Mask Parser round-trip
    - **Property 2: Parse-format-parse round-trip consistency**
    - For all valid part number strings, `applyPartMask(formatPartNumber(applyPartMask(s)))` produces an equivalent result to `applyPartMask(s)`
    - **Validates: Requirements 6.5**

  - [x] 3.5 Create Validators module (`src/server/utils/validators.js`)
    - Implement `validateMaterial(value)`, `validateMachinery(value)`, `validatePowdercoat(value)`, `validateThickness(value)` checking against BOM_Constants arrays
    - Implement `validateQuantity(value)` ensuring positive integer
    - Implement `validatePartPayload(payload)` aggregating all field validations
    - Implement `sanitizeJQL(input)` to prevent JQL injection in Jira search queries
    - Each validator returns a descriptive error message on failure
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 18.3_

  - [ ]* 3.6 Write unit tests for Validators
    - Test each validator with valid values, invalid values, and edge cases (empty string, null, undefined)
    - Test `sanitizeJQL` with injection payloads
    - _Requirements: 13.1, 13.2, 13.3, 13.4, 13.5, 18.3_

- [x] 4. Implement API clients
  - [x] 4.1 Create Jira Client (`src/server/clients/jiraClient.js`)
    - Initialize `jira.js` `Version2Client` with Bearer token from `JIRA_KEY` env var
    - Implement `searchIssues(jql, options)` using `jira.js` built-in pagination to return all matching issues
    - Implement `createIssue(fields)` returning `{ key }`
    - Implement `updateIssue(key, fields)` returning void
    - Implement `getIssue(key)` returning full issue
    - Wrap errors in typed ValorBOM errors with status code, message, and failing endpoint
    - Retry transient errors (5xx, network timeout) with exponential backoff; surface 4xx without retry
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5_

  - [ ]* 4.2 Write unit tests for Jira Client
    - Mock `jira.js` client methods
    - Test pagination assembly across multiple pages
    - Test error wrapping for 4xx and 5xx responses
    - Test retry behavior for transient errors
    - _Requirements: 1.2, 1.3, 1.4, 1.5_

  - [x] 4.3 Create Onshape Client (`src/server/clients/onshapeClient.js`)
    - Implement HMAC-SHA256 request signing with nonce, UTC date, method, content type, URL path, query string
    - Port `createSignature` and `genNonce` logic from `ValorBOM` class
    - Load API key and secret from env vars; never include secrets in logs or errors
    - Implement `getAssemblyBOM(documentId, workspaceId, elementId, options)` returning BOM table
    - Implement `getDocuments(query, options)` returning document list
    - Implement `getWorkspaces(documentId)` returning workspace list
    - Implement `getElements(documentId, workspaceId, elementType)` returning element list
    - Implement `exportSTL(documentId, workspaceId, elementId, partId)` returning Buffer
    - Implement `exportSTEP(documentId, workspaceId, elementId, partId)` returning Buffer
    - Use axios (pinned 1.7.9) with interceptors for signing
    - Return 401/403 as descriptive "Onshape authentication failed" error
    - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5, 18.1_

  - [ ]* 4.4 Write unit tests for Onshape Client
    - Mock axios requests
    - Test HMAC signature generation matches expected output for known inputs
    - Test binary export returns Buffer
    - Test 401/403 error handling
    - Test that secret key is never in error output
    - _Requirements: 2.1, 2.3, 2.4, 18.1_

- [x] 5. Checkpoint - Verify utilities and clients
  - Ensure all tests pass, ask the user if questions arise.

- [x] 6. Implement BOM Service
  - [x] 6.1 Create BOM Service (`src/server/services/bomService.js`)
    - Implement `getBOM(epicKey, documentId, workspaceId, elementId)` that fetches assembly BOM from Onshape via OnshapeClient
    - Parse BOM table rows into `ParsedBOMItem` objects with fullPartNumber, name, quantity, material, machinery, thickness, powdercoat, epic
    - Auto-map materials to machinery using `MATERIAL_MACHINERY_MAP` from bomConstants; set unmatched materials to raw displayName with machinery "None"
    - Aggregate quantities for duplicate fullPartNumbers
    - Skip nested sub-assembly items (item path contains ".")
    - Return descriptive error listing missing columns if BOM table lacks required columns (quantity, partNumber, material, name)
    - Implement `compareBOMWithJira(bomItems, existingStories)` returning BOM comparison with change logs
    - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6_

  - [ ]* 6.2 Write property test for BOM quantity aggregation
    - **Property 3: Quantity aggregation never loses items**
    - For any set of BOM rows with duplicate part numbers, the output quantity is always ≥ each individual input quantity
    - **Validates: Requirements 3.4**

  - [ ]* 6.3 Write unit tests for BOM Service
    - Test material-to-machinery mapping for each entry in MATERIAL_MACHINERY_MAP
    - Test unmatched material defaults to raw displayName with "None" machinery
    - Test nested sub-assembly filtering
    - Test missing column error reporting
    - _Requirements: 3.1, 3.2, 3.3, 3.5, 3.6_

- [x] 7. Implement Epic Service
  - [x] 7.1 Create Epic Service (`src/server/services/epicService.js`)
    - Implement `getEpics(seasonType, year)` using JiraClient.searchIssues with paginated retrieval (fixes current pagination bug)
    - Implement `getEpic(fullPartNumber)` returning single epic or null
    - Implement `createEpic(payload)` populating summary, epic name (customfield_10104), and Onshape IDs (customfield_10300, 10301, 10302)
    - Implement `generateEpicFromURL(onshapeURL)` that parses Onshape document URL to extract documentId, workspaceId, elementId, fetches assembly name, and creates Jira epic
    - Return descriptive error for invalid/unparseable Onshape URLs
    - Parse epic issues extracting fullPartNumber, name, seasonType, year, and Onshape IDs from fields
    - _Requirements: 4.1, 4.2, 4.3, 5.1, 5.2, 5.3_

  - [ ]* 7.2 Write unit tests for Epic Service
    - Mock JiraClient and OnshapeClient
    - Test paginated epic retrieval returns all pages
    - Test Onshape URL parsing for valid and invalid URLs
    - Test epic creation payload includes correct custom fields
    - _Requirements: 4.1, 4.3, 5.1, 5.2, 5.3_

- [x] 8. Implement Part Service
  - [x] 8.1 Create Part Service (`src/server/services/partService.js`)
    - Implement `getStoriesByEpic(epicKey)` and `getStoriesByPartNumber(partNumber)` using JiraClient with pagination
    - Implement `previewParts(params)` returning `PartPreview` with newParts, existingParts (with change logs for quantity, material, machinery, powdercoat, thickness), and duplicates
    - Implement `uploadSelected(parts)` creating Jira stories only for user-selected parts; return partial results with created parts and individual error details for failures
    - Implement `createStory(payload)` formatting Jira fields: machinery as array of `{value}`, material/powdercoat/thickness as `{value}`, quantity as number; omit powdercoat/thickness when "None"
    - Implement `updateStory(key, payload)` with same field formatting
    - Implement `detectDuplicates(parts)` returning items with same fullPartNumber grouped with all occurrences
    - Block upload of duplicates unless user explicitly confirms
    - Validate all field values against BOM_Constants before creating/updating
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 8.2, 9.2, 9.3, 13.1, 13.2, 13.3, 13.4, 13.5, 17.2, 17.3_

  - [ ]* 8.2 Write property test for duplicate detection
    - **Property 4: Reported duplicates always have count > 1**
    - For any list of ParsedBOMItems, every entry in the duplicates array has at least 2 occurrences
    - **Validates: Requirements 8.1**

  - [ ]* 8.3 Write unit tests for Part Service
    - Test preview returns correct categorization of new, existing, and duplicate parts
    - Test selective upload only creates stories for selected parts
    - Test partial failure returns created and errored parts
    - Test field formatting (machinery array, omit "None" powdercoat/thickness)
    - Test validation rejects invalid field values
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 8.1, 17.2, 17.3_

- [x] 9. Implement Sync Service
  - [x] 9.1 Create Sync Service (`src/server/services/syncService.js`)
    - Implement `syncEpics(seasonType, year)` replacing the deeply nested callback chain
    - Fetch Onshape documents matching `V{seasonType}{year}A` pattern
    - For each document, resolve workspace and assemblies using `Promise.all` for independent calls
    - Check each assembly against existing Jira epics; create missing epics, skip existing ones
    - Log and continue on per-assembly errors without blocking remaining assemblies
    - Return `SyncResult` with created, skipped, and errored arrays
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

  - [ ]* 9.2 Write unit tests for Sync Service
    - Mock OnshapeClient and JiraClient
    - Test creates epics for untracked assemblies
    - Test skips assemblies with existing epics
    - Test continues processing after per-assembly error
    - Test SyncResult contains correct created/skipped/errored arrays
    - _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5_

- [x] 10. Implement Export Service
  - [x] 10.1 Create Export Service (`src/server/services/exportService.js`)
    - Implement `exportSTL(documentId, workspaceId, elementId, partId)` delegating to OnshapeClient, returning Buffer
    - Implement `exportSTEP(documentId, workspaceId, elementId, partId)` delegating to OnshapeClient, returning Buffer
    - Implement `autoExportForPrint(part)` that triggers STEP export when part machinery is "3D Printer"
    - Return per-part error on STEP export failure without blocking other parts in batch
    - _Requirements: 10.1, 10.2, 10.3_

  - [ ]* 10.2 Write unit tests for Export Service
    - Mock OnshapeClient export methods
    - Test auto-export triggers only for "3D Printer" machinery
    - Test per-part error isolation
    - _Requirements: 10.1, 10.2, 10.3_

- [x] 11. Checkpoint - Verify all services
  - Ensure all tests pass, ask the user if questions arise.

- [x] 12. Implement Express Router Layer
  - [x] 12.1 Create route modules and Express app entry point (`src/server/index.js`)
    - Create `src/server/routes/epicRoutes.js`: GET /api/epics, GET /api/epics/sync, POST /api/epics/from-url
    - Create `src/server/routes/partRoutes.js`: GET /api/stories, POST /api/stories, PUT /api/stories/:key, POST /api/parts/preview, POST /api/parts/upload
    - Create `src/server/routes/bomRoutes.js`: GET /api/bom
    - Create `src/server/routes/exportRoutes.js`: POST /api/export/step, POST /api/export/stl
    - Wire routes to service methods with request validation and parameter extraction
    - Return 400 with descriptive error for missing/invalid query/body parameters
    - Return appropriate HTTP status codes with structured JSON error responses for service errors
    - Sanitize all user-provided values used in JQL queries via validators.sanitizeJQL
    - Use `express.json()` instead of `body-parser`
    - Serve React SPA `index.html` for non-API paths (production build)
    - Configure dotenv and instantiate all clients/services with dependency injection
    - _Requirements: 14.1, 14.2, 14.3, 14.4, 14.5, 16.4, 18.2, 18.3_

  - [ ]* 12.2 Write integration tests for routes
    - Use supertest to test each route with mocked service layer
    - Test 400 responses for missing parameters
    - Test structured JSON error responses
    - Test JQL sanitization prevents injection
    - _Requirements: 14.1, 14.2, 14.3, 14.4_

- [x] 13. Checkpoint - Verify backend is complete
  - Ensure all tests pass, ask the user if questions arise.

- [x] 14. Implement React Frontend
  - [x] 14.1 Set up Vite + React project scaffolding
    - Create `src/client/index.html` as Vite entry point
    - Create `vite.config.js` with React plugin and API proxy to Express backend
    - Create `tailwind.config.js` with custom gold color theme
    - Create `src/client/src/main.jsx` with React root and QueryClientProvider
    - Create `src/client/src/App.jsx` with main application shell
    - _Requirements: 16.5_

  - [x] 14.2 Create API client and shared constants
    - Create `src/client/src/api/client.js` with fetch-based API functions for all endpoints
    - Import and re-export BOM_Constants (MATERIALS, MACHINERY, POWDERCOAT, THICKNESS) for dropdown options
    - _Requirements: 12.5, 15.5_

  - [x] 14.3 Implement Assembly Selection view
    - Create component with dropdowns for season type (Robot/Facility), year, and assembly (epic)
    - Fetch epics on season/year change; populate assembly dropdown
    - Trigger sync on season/year change
    - Port collapsible section and print-friendly assembly info from current index.html
    - _Requirements: 15.1_

  - [x] 14.4 Implement Parts List Table view
    - Create table component displaying key, epic, quantity, summary, material, machinery, powdercoat, thickness, status columns
    - Render editable dropdowns for machinery, powdercoat, thickness sourced from BOM_Constants
    - Render editable quantity input
    - Show status badges (New, Changes, Exists, Updated)
    - Implement "Update from CAD" button triggering BOM fetch and comparison
    - Implement "Save Changes" button creating/updating stories
    - _Requirements: 15.2, 15.5_

  - [x] 14.5 Implement Part Upload Preview with duplicate warnings
    - Create preview modal/panel showing new parts, existing parts with change highlights, and duplicate warnings
    - Allow user to select/deselect individual parts before uploading via checkboxes
    - Highlight duplicate part numbers with visual warning styling
    - Display parts in preview state without creating Jira issues until explicit save
    - Wire "Upload Selected" action to POST /api/parts/upload with only selected parts
    - _Requirements: 8.3, 9.1, 15.3, 15.4_

  - [x] 14.6 Implement print-friendly layout
    - Add print CSS that hides navigation, buttons, and non-essential UI
    - Show compact assembly info header in print mode
    - Hide Epic and Status columns in print
    - Port print styles from current index.html
    - _Requirements: 15.6_

- [x] 15. Checkpoint - Verify frontend builds and renders
  - Ensure `npm run build` succeeds, ask the user if questions arise.

- [x] 16. Wire everything together and clean up
  - [x] 16.1 Remove legacy files
    - Delete `src/ValorBOM.js` (monolithic class replaced by modular services)
    - Delete `app.js` (replaced by `src/server/index.js`)
    - Delete old `index.html` at project root (replaced by React SPA)
    - Remove old `__tests__/` files that tested the monolithic class
    - Update package.json `main` field to `src/server/index.js`
    - _Requirements: 16.1, 16.3_

  - [x] 16.2 Verify Jira custom field mapping consistency
    - Audit all service files to ensure customfield IDs match the mapping table: 10104 (Epic Name), 10110 (Epic Link), 10201 (Machinery), 10202 (Material), 10204 (Powdercoat), 10206 (Quantity), 10207 (Thickness), 10300 (Document ID), 10301 (Workspace ID), 10302 (Element ID)
    - Ensure machinery is formatted as array of `{value}`, material/powdercoat/thickness as `{value}`, quantity as number
    - Ensure "None" values for powdercoat and thickness are omitted from Jira payloads
    - _Requirements: 17.1, 17.2, 17.3_

  - [x] 16.3 Verify environment variable handling and security
    - Ensure `.env` remains in `.gitignore`
    - Ensure Jira Bearer token is never exposed to frontend
    - Ensure Onshape secret key is never in log or error output
    - Ensure axios is pinned to exact version `1.7.9` without caret or tilde
    - _Requirements: 18.1, 18.2, 18.5, 16.8_

- [x] 17. Final checkpoint - Ensure all tests pass
  - Ensure all tests pass, ask the user if questions arise.

## Notes

- Tasks marked with `*` are optional and can be skipped for faster MVP
- Each task references specific requirements for traceability
- Checkpoints ensure incremental validation
- Property tests validate universal correctness properties from the design document
- The implementation language is JavaScript (ES modules) matching the existing codebase and design document
- All dropdown options (material, machinery, powdercoat, thickness) are sourced from the centralized BOM_Constants module
