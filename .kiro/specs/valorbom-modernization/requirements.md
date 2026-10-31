# Requirements Document

## Introduction

ValorBOM is a Bill of Materials management tool that bridges Onshape CAD assemblies with Jira project tracking for a robotics team. This requirements document captures the functional and non-functional requirements for modernizing ValorBOM from a monolithic, callback-based Node.js application into a modular architecture with modern patterns (async/await, ES modules), replacing deprecated dependencies, introducing a Vite + React frontend, and adding new features including epic generation from URLs, selective part upload with preview, duplicate part detection, automatic STEP export for 3D prints, and a fix for Jira pagination.

## Glossary

- **ValorBOM_System**: The full-stack application comprising an Express backend and React frontend that manages Bills of Materials between Onshape and Jira
- **Jira_Client**: The backend module wrapping the `jira.js` SDK to communicate with the Jira REST API using Bearer token authentication
- **Onshape_Client**: The backend module using axios with HMAC-SHA256 signing to communicate with the Onshape REST API
- **BOM_Service**: The backend service that retrieves and parses assembly BOMs from Onshape and cross-references them with Jira stories
- **Epic_Service**: The backend service that manages Jira epic (Assembly) operations including paginated retrieval and creation from Onshape URLs
- **Part_Service**: The backend service that manages Jira story (Part) CRUD operations with selective upload and duplicate detection
- **Sync_Service**: The backend service that orchestrates synchronization between Onshape documents and Jira epics
- **Export_Service**: The backend service that handles STL and STEP file exports from Onshape
- **Part_Mask_Parser**: The utility module that extracts structured data from ValorBOM part number naming conventions
- **BOM_Constants**: The centralized module containing all configurable field options (materials, machinery, powdercoat, thickness) and material-to-machinery mapping rules
- **Router_Layer**: The Express routing layer that maps HTTP endpoints to service methods
- **React_Frontend**: The Vite + React single-page application providing the BOM management UI
- **Epic**: A Jira issue of type Assembly representing a top-level CAD assembly, identified by pattern `V[RF]\d{2}A-\d{4}`
- **Story**: A Jira issue of type Part representing an individual component, identified by pattern `V[RF]\d{2}P-\d{4}[A-Z]`
- **ParsedBOMItem**: A structured representation of a single part extracted from an Onshape BOM table
- **PartPreview**: A response object containing new parts, existing parts, and duplicate parts detected during upload preview
- **MATERIAL_MACHINERY_MAP**: A lookup table mapping raw Onshape material substrings to normalized material names and default machinery assignments

## Requirements

### Requirement 1: Jira Client Communication

**User Story:** As a developer, I want a Jira client that uses the `jira.js` SDK with async/await, so that Jira API calls are reliable, typed, and use built-in pagination.

#### Acceptance Criteria

1. THE Jira_Client SHALL authenticate with the Jira REST API using a Bearer token loaded from the `JIRA_KEY` environment variable
2. WHEN the Jira_Client searches for issues, THE Jira_Client SHALL delegate pagination to the `jira.js` built-in pagination support and return all matching issues across all pages
3. WHEN the Jira_Client receives a non-2xx response or network error from Jira, THE Jira_Client SHALL wrap the error in a typed ValorBOM error containing the status code, message, and failing endpoint
4. WHEN the Jira_Client encounters a transient error (5xx or network timeout), THE Jira_Client SHALL retry the request with exponential backoff
5. WHEN the Jira_Client encounters a 4xx error, THE Jira_Client SHALL surface the error to the caller with an actionable message without retrying

### Requirement 2: Onshape Client Communication

**User Story:** As a developer, I want a custom Onshape API client using axios with HMAC-SHA256 signing, so that Onshape calls are authenticated and use modern async patterns.

#### Acceptance Criteria

1. THE Onshape_Client SHALL sign every request using HMAC-SHA256 with a nonce, UTC date, HTTP method, content type, URL path, and query string
2. THE Onshape_Client SHALL load the API key and secret key from environment variables and never include secret values in log output or error messages
3. WHEN the Onshape_Client receives a 401 or 403 response, THE Onshape_Client SHALL return a descriptive "Onshape authentication failed" error
4. WHEN the Onshape_Client exports a binary file (STL or STEP), THE Onshape_Client SHALL return the file content as a Buffer
5. THE Onshape_Client SHALL pin the axios dependency to a known-safe version (1.7.9 or earlier) to mitigate supply chain risk

### Requirement 3: BOM Parsing and Material Mapping

**User Story:** As a user, I want the system to parse Onshape BOM tables and auto-map materials to machinery, so that parts are pre-populated with correct manufacturing defaults.

#### Acceptance Criteria

1. WHEN the BOM_Service receives a BOM table from Onshape, THE BOM_Service SHALL parse each row into a ParsedBOMItem containing fullPartNumber, name, quantity, material, machinery, thickness, powdercoat, and epic key
2. WHEN a BOM table row contains a material displayName matching a key in MATERIAL_MACHINERY_MAP, THE BOM_Service SHALL set the material and machinery fields to the corresponding mapped values
3. WHEN a BOM table row contains a material displayName that does not match any key in MATERIAL_MACHINERY_MAP, THE BOM_Service SHALL set material to the raw displayName and machinery to "None"
4. WHEN multiple BOM rows share the same fullPartNumber, THE BOM_Service SHALL aggregate their quantities into a single ParsedBOMItem
5. WHEN a BOM row represents a nested sub-assembly item (item path contains "."), THE BOM_Service SHALL exclude that row from the parsed output
6. WHEN a BOM table is missing any of the required columns (quantity, partNumber, material, name), THE BOM_Service SHALL return a descriptive error listing the missing columns

### Requirement 4: Epic Management with Pagination Fix

**User Story:** As a user, I want to retrieve all epics for a season/year without missing any due to pagination limits, so that the assembly dropdown is complete.

#### Acceptance Criteria

1. WHEN the Epic_Service retrieves epics for a given seasonType and year, THE Epic_Service SHALL return all matching epics across all paginated Jira result pages
2. WHEN the Epic_Service parses an epic from Jira, THE Epic_Service SHALL extract the fullPartNumber, name, seasonType, year, and Onshape document/workspace/element IDs from the issue fields
3. WHEN the Epic_Service creates an epic, THE Epic_Service SHALL populate the Jira issue with the summary, epic name (customfield_10104), and Onshape IDs (customfield_10300, customfield_10301, customfield_10302)

### Requirement 5: Epic Generation from Onshape URL

**User Story:** As a user, I want to generate a Jira epic by pasting an Onshape document URL, so that I can quickly create assembly tracking without manual data entry.

#### Acceptance Criteria

1. WHEN the Epic_Service receives a valid Onshape document URL, THE Epic_Service SHALL parse the URL to extract the document ID, workspace ID, and element ID
2. WHEN the Epic_Service successfully extracts IDs from an Onshape URL, THE Epic_Service SHALL create a Jira epic with the extracted Onshape IDs and the assembly name from the document
3. WHEN the Epic_Service receives an invalid or unparseable Onshape URL, THE Epic_Service SHALL return a descriptive error indicating the URL format is invalid

### Requirement 6: Part Mask Parsing

**User Story:** As a developer, I want a reliable parser for ValorBOM part number naming conventions, so that structured data can be extracted from part strings consistently.

#### Acceptance Criteria

1. WHEN the Part_Mask_Parser receives a string matching the epic pattern `V[RF]\d{2}A-\d{4}`, THE Part_Mask_Parser SHALL return a TitleMaskResult with seasonType, year, partNumber, fullPartNumber, name, and isEpic set to true
2. WHEN the Part_Mask_Parser receives a string matching the part pattern `V[RF]\d{2}P-\d{4}[A-Z]`, THE Part_Mask_Parser SHALL return a PartMaskResult with seasonType, year, partNumber, version, fullPartNumber, name, and isEpic set to false
3. WHEN the Part_Mask_Parser receives a string that does not match any valid part number pattern, THE Part_Mask_Parser SHALL return null
4. THE Part_Mask_Parser SHALL format a parsed result back into a valid part number string (pretty-print)
5. FOR ALL valid part number strings, parsing then printing then parsing SHALL produce an equivalent result (round-trip property)

### Requirement 7: Selective Part Upload with Preview

**User Story:** As a user, I want to preview which parts will be created or updated before uploading, so that I can selectively choose which parts to push to Jira.

#### Acceptance Criteria

1. WHEN the Part_Service receives a preview request with epic key and Onshape document parameters, THE Part_Service SHALL return a PartPreview containing newParts, existingParts with change logs, and duplicates
2. WHEN the Part_Service receives an upload request with selected parts, THE Part_Service SHALL create Jira stories only for the user-selected parts
3. WHEN some parts fail to create during a batch upload, THE Part_Service SHALL return a partial result listing successfully created parts and individual error details for failures
4. WHEN the Part_Service detects existing Jira stories for BOM items, THE Part_Service SHALL include a ChangeLog comparing current Jira field values against the BOM values for quantity, material, machinery, powdercoat, and thickness

### Requirement 8: Duplicate Part Number Detection

**User Story:** As a user, I want the system to detect duplicate part numbers before uploading, so that I can resolve conflicts in Onshape before creating incorrect Jira tickets.

#### Acceptance Criteria

1. WHEN the Part_Service detects multiple BOM items with the same fullPartNumber during preview, THE Part_Service SHALL include those items in the duplicates array of the PartPreview response with all occurrences listed
2. WHEN the Part_Service receives an upload request containing duplicate part numbers, THE Part_Service SHALL block the upload for those duplicates unless the user explicitly confirms
3. WHEN the React_Frontend displays a PartPreview containing duplicates, THE React_Frontend SHALL highlight the duplicate part numbers with a visual warning

### Requirement 9: Prevent Premature Ticket Creation

**User Story:** As a user, I want the system to prevent Jira tickets from being created before I explicitly save, so that incomplete or accidental entries are avoided.

#### Acceptance Criteria

1. WHEN the React_Frontend loads BOM data from Onshape, THE React_Frontend SHALL display the parts in a preview state without creating any Jira issues
2. WHEN the user clicks the save/upload action, THE Part_Service SHALL create Jira stories only for parts the user has selected and confirmed
3. WHILE no explicit save action has been triggered, THE Part_Service SHALL reject any story creation requests originating from the BOM preview flow

### Requirement 10: Automatic STEP Export for 3D Prints

**User Story:** As a user, I want STEP files to be automatically exported for parts assigned to 3D printing machinery, so that print-ready files are available without manual export.

#### Acceptance Criteria

1. WHEN a ParsedBOMItem has machinery set to "3D Printer", THE Export_Service SHALL automatically trigger a STEP file export from Onshape for that part
2. WHEN the Export_Service successfully exports a STEP file, THE Export_Service SHALL return the file content as a Buffer with the export result metadata
3. IF the STEP export fails for a 3D print part, THEN THE Export_Service SHALL return an error for that specific part without blocking other parts in the batch

### Requirement 11: Onshape-Jira Sync

**User Story:** As a user, I want the system to automatically discover Onshape assemblies and create matching Jira epics, so that new assemblies are tracked without manual setup.

#### Acceptance Criteria

1. WHEN the Sync_Service runs for a given seasonType and year, THE Sync_Service SHALL fetch all Onshape documents matching the naming pattern `V{seasonType}{year}A`
2. WHEN the Sync_Service finds an Onshape assembly that has no corresponding Jira epic, THE Sync_Service SHALL create a new Jira epic with the assembly name and Onshape document/workspace/element IDs
3. WHEN the Sync_Service finds an Onshape assembly that already has a corresponding Jira epic, THE Sync_Service SHALL skip that assembly and include it in the skipped results
4. WHEN the Sync_Service encounters an error creating an epic for a specific assembly, THE Sync_Service SHALL log the error for that assembly and continue processing remaining assemblies
5. WHEN the Sync_Service completes, THE Sync_Service SHALL return a SyncResult containing arrays of created, skipped, and errored assemblies

### Requirement 12: Centralized BOM Constants

**User Story:** As a developer, I want all configurable field options centralized in a single module, so that adding or modifying materials, machinery, powdercoat, or thickness values requires changing only one file.

#### Acceptance Criteria

1. THE BOM_Constants module SHALL export arrays for MATERIALS, MACHINERY, POWDERCOAT, and THICKNESS containing all valid field values
2. THE BOM_Constants module SHALL export a MATERIAL_MACHINERY_MAP object mapping raw material substrings to normalized material and default machinery values
3. FOR ALL entries in MATERIAL_MACHINERY_MAP, the mapped material value SHALL exist in the MATERIALS array and the mapped machinery value SHALL exist in the MACHINERY array
4. WHEN the BOM_Service, Part_Service, or Validators validate a field value, THE validation logic SHALL check the value against the corresponding BOM_Constants array
5. WHEN the React_Frontend renders dropdown options for material, machinery, powdercoat, or thickness fields, THE React_Frontend SHALL source the options from BOM_Constants

### Requirement 13: Field Validation

**User Story:** As a user, I want all part field values validated against allowed options, so that invalid data cannot be submitted to Jira.

#### Acceptance Criteria

1. WHEN a story creation or update request contains a material value not in the MATERIALS constant, THE Part_Service SHALL reject the request with a descriptive validation error
2. WHEN a story creation or update request contains a machinery value not in the MACHINERY constant, THE Part_Service SHALL reject the request with a descriptive validation error
3. WHEN a story creation or update request contains a powdercoat value not in the POWDERCOAT constant, THE Part_Service SHALL reject the request with a descriptive validation error
4. WHEN a story creation or update request contains a thickness value not in the THICKNESS constant, THE Part_Service SHALL reject the request with a descriptive validation error
5. WHEN a story creation or update request contains a quantity that is not a positive integer, THE Part_Service SHALL reject the request with a descriptive validation error

### Requirement 14: Express Router and API Layer

**User Story:** As a developer, I want a thin routing layer that validates requests and delegates to services, so that HTTP concerns are separated from business logic.

#### Acceptance Criteria

1. THE Router_Layer SHALL expose endpoints for epic retrieval (GET /api/epics), sync (GET /api/epics/sync), epic creation from URL (POST /api/epics/from-url), story CRUD (GET/POST/PUT /api/stories), BOM retrieval (GET /api/bom), part preview (POST /api/parts/preview), part upload (POST /api/parts/upload), and file export (POST /api/export/step, POST /api/export/stl)
2. WHEN the Router_Layer receives a request with missing or invalid query/body parameters, THE Router_Layer SHALL return a 400 status with a descriptive error message
3. WHEN a service method throws an error, THE Router_Layer SHALL return an appropriate HTTP status code and a structured JSON error response
4. THE Router_Layer SHALL sanitize all user-provided values used in JQL queries to prevent JQL injection
5. WHEN the Router_Layer receives a request for a non-API path, THE Router_Layer SHALL serve the React SPA index.html for client-side routing

### Requirement 15: React Frontend

**User Story:** As a user, I want a modern React-based UI replacing the plain HTML page, so that I get a responsive interface with enhanced features for part selection and duplicate warnings.

#### Acceptance Criteria

1. THE React_Frontend SHALL provide an assembly selection view with dropdowns for season type, year, and assembly (epic)
2. THE React_Frontend SHALL provide a parts list table displaying key, epic, quantity, summary, material, machinery, powdercoat, thickness, and status for each part
3. WHEN the user triggers "Update from CAD", THE React_Frontend SHALL display a part upload preview showing new parts, existing parts with changes, and duplicate warnings
4. WHEN the React_Frontend displays a part upload preview, THE React_Frontend SHALL allow the user to select or deselect individual parts before uploading
5. THE React_Frontend SHALL source all dropdown options (material, machinery, powdercoat, thickness) from the centralized BOM_Constants
6. THE React_Frontend SHALL provide a print-friendly layout that hides navigation and non-essential UI elements

### Requirement 16: Infrastructure Modernization

**User Story:** As a developer, I want the application to run on modern Node.js with current dependencies and a clean Docker image, so that the codebase is maintainable and secure.

#### Acceptance Criteria

1. THE ValorBOM_System SHALL use ES module syntax (import/export) and async/await patterns throughout the backend codebase
2. THE ValorBOM_System SHALL use Node.js 20 LTS (or 22 LTS) as the runtime, specified in the Dockerfile base image
3. THE ValorBOM_System SHALL remove the deprecated `request` library and replace Jira calls with `jira.js` and Onshape calls with axios
4. THE ValorBOM_System SHALL remove the `body-parser` dependency and use the built-in `express.json()` middleware
5. THE ValorBOM_System SHALL remove the `browserify` dependency and build pipeline, replacing it with Vite for the frontend
6. THE ValorBOM_System SHALL remove the `sys/` directory (bom.service, runner.sh) from the project
7. THE Dockerfile SHALL continue running the application as a non-root user via the `USER node` directive
8. THE ValorBOM_System SHALL keep environment variables in a `.env` file that remains in `.gitignore`

### Requirement 17: Jira Custom Field Mapping

**User Story:** As a developer, I want Jira custom field IDs mapped consistently across all services, so that field references are correct and maintainable.

#### Acceptance Criteria

1. THE ValorBOM_System SHALL use customfield_10104 for Epic Name, customfield_10110 for Epic Link, customfield_10201 for Machinery (array of {value}), customfield_10202 for Material ({value}), customfield_10204 for Powdercoat ({value}), customfield_10206 for Quantity (number), customfield_10207 for Thickness ({value}), customfield_10300 for Document ID, customfield_10301 for Workspace ID, and customfield_10302 for Element ID
2. WHEN the Part_Service creates or updates a Jira story, THE Part_Service SHALL format the machinery field as an array of objects with a `value` property and the material, powdercoat, and thickness fields as objects with a `value` property
3. WHEN a field value is "None", THE Part_Service SHALL omit the powdercoat and thickness custom fields from the Jira payload rather than sending "None" as a value

### Requirement 18: Security

**User Story:** As a developer, I want the application to follow security best practices, so that credentials are protected and injection attacks are prevented.

#### Acceptance Criteria

1. THE Onshape_Client SHALL sanitize all debug and error output to exclude the API secret key
2. THE ValorBOM_System SHALL store the Jira Bearer token only in environment variables and never expose the token to the frontend
3. THE Router_Layer SHALL validate and sanitize all query and body parameters used in JQL search queries to prevent injection
4. THE Dockerfile SHALL run the application as a non-root user
5. THE ValorBOM_System SHALL pin the axios dependency to an exact version (1.7.9 or earlier) without a caret or tilde prefix
