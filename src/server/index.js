/**
 * Express app entry point — wires clients, services, and routes together.
 */

import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Clients
import { JiraClient } from './clients/jiraClient.js';
import { OnshapeClient } from './clients/onshapeClient.js';
import { SheetsClient } from './clients/sheetsClient.js';

// Services
import { BOMService } from './services/bomService.js';
import { EpicService } from './services/epicService.js';
import { PartService } from './services/partService.js';
import { ExportService } from './services/exportService.js';
import { BuildService } from './services/buildService.js';
import { RevisionService } from './services/revisionService.js';
import { OrderSheetService } from './services/orderSheetService.js';
import { PurchasingService } from './services/purchasingService.js';
import { ReceivingService } from './services/receivingService.js';

// Routes
import epicRoutes from './routes/epicRoutes.js';
import partRoutes from './routes/partRoutes.js';
import buildRoutes from './routes/buildRoutes.js';
import revisionRoutes from './routes/revisionRoutes.js';
import bomRoutes from './routes/bomRoutes.js';
import exportRoutes from './routes/exportRoutes.js';
import purchasingRoutes from './routes/purchasingRoutes.js';
import receivingRoutes from './routes/receivingRoutes.js';

// Background jobs
import { SheetSyncScheduler } from './sheetSyncScheduler.js';

// Auth
import { readAuthConfig, OidcProvider } from './auth/oidcConfig.js';
import { requireAuth, isLoopbackHost } from './auth/requireAuth.js';
import authRoutes from './routes/authRoutes.js';

// Middleware
import { cors } from './middleware/cors.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiNotFound, errorHandler } from './middleware/errorHandler.js';

// ---------------------------------------------------------------------------
// Resolve __dirname for ES modules
// ---------------------------------------------------------------------------
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ---------------------------------------------------------------------------
// Instantiate clients
// ---------------------------------------------------------------------------
const jiraClient = new JiraClient();
const onshapeClient = new OnshapeClient();

// The purchasing flow needs Google Sheets credentials. Keep it optional so the
// existing BOM features still start without them; the purchasing routes then
// report the misconfiguration instead of the whole server failing to boot.
let sheetsClient = null;
let sheetsInitError = null;
try {
  sheetsClient = new SheetsClient();
} catch (err) {
  sheetsInitError = err;
  console.warn(`Purchasing features disabled: ${err.message}`);
}

// ---------------------------------------------------------------------------
// Instantiate services (dependency injection)
// ---------------------------------------------------------------------------
const bomService = new BOMService({ onshapeClient });
// Built before PartService, which scopes Part reads to the Revision chain.
const revisionService = new RevisionService({ jiraClient });
const partService = new PartService({ jiraClient, bomService, revisionService });
const exportService = new ExportService({ onshapeClient });
// Built before EpicService, which creates Build 1 when onboarding an Assembly.
const buildService = new BuildService({ jiraClient, onshapeClient, revisionService, partService });
const epicService = new EpicService({ jiraClient, onshapeClient, buildService, bomService });

const orderSheetService = sheetsClient ? new OrderSheetService({ sheetsClient }) : null;
const purchasingService = orderSheetService
  ? new PurchasingService({ jiraClient, orderSheetService })
  : null;
const receivingService = orderSheetService
  ? new ReceivingService({ jiraClient, orderSheetService })
  : null;

// Pulls the purchaser's spreadsheet edits into Jira on a timer.
const sheetSync = receivingService
  ? new SheetSyncScheduler({ receivingService })
  : null;

// ---------------------------------------------------------------------------
// Network binding
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

/**
 * Bind to loopback by default so the server is not reachable from the network.
 * This app holds a Jira token and a Google service-account key and can move
 * tickets and write the team budget sheet.
 *
 * Set HOST to widen the bind deliberately. In a container, leave HOST as
 * 0.0.0.0 and publish the port to loopback only (-p 127.0.0.1:3000:3000) so
 * the published port, not the in-container bind, is the boundary.
 */
const HOST = process.env.HOST || '127.0.0.1';

// ---------------------------------------------------------------------------
// Authentication (Authentik, OIDC authorization-code flow with PKCE)
// ---------------------------------------------------------------------------
const authConfig = readAuthConfig();
const oidcProvider = new OidcProvider(authConfig);

// ---------------------------------------------------------------------------
// Create Express app
// ---------------------------------------------------------------------------
const app = express();

// ---------------------------------------------------------------------------
// Global middleware
// ---------------------------------------------------------------------------
app.use(cors);
app.use(requestLogger);
app.use(express.json());

// ---------------------------------------------------------------------------
// Auth handshake — must sit outside the gate, since it is how you get in.
// ---------------------------------------------------------------------------
app.use('/auth', authRoutes({ provider: oidcProvider, authConfig }));

// Liveness check, deliberately public: it reveals nothing but whether the
// process is up, and a gated health check is useless to a load balancer.
app.get('/healthz', (req, res) => res.json({ ok: true }));

/**
 * The gate. Applied per-route rather than globally: the purchasing and
 * receiving surfaces are mentor-only because they move money and close
 * tickets, while the Onshape/Jira BOM tooling stays open to the whole team as
 * it always was.
 */
const gate = requireAuth({ authConfig, host: HOST });

// ---------------------------------------------------------------------------
// Public API — the BOM features
// ---------------------------------------------------------------------------
app.use('/api/epics', epicRoutes({ epicService }));
app.use('/api/builds', buildRoutes({ buildService }));
app.use('/api/revisions', revisionRoutes({ revisionService }));
app.use('/api', partRoutes({ partService, exportService }));
app.use('/api/bom', bomRoutes({ bomService }));
app.use('/api/export', exportRoutes({ exportService }));

// ---------------------------------------------------------------------------
// Mentor-only API — parts ordering and check-in
// ---------------------------------------------------------------------------
if (purchasingService && receivingService) {
  app.use('/api/purchasing', gate, purchasingRoutes({ purchasingService }));
  app.use('/api/receiving', gate, receivingRoutes({ receivingService }));
  app.get('/api/sheet-sync', gate, (req, res) => res.json(sheetSync.status()));
} else {
  const unavailable = (req, res) => {
    res.status(503).json({
      error: 'Purchasing features are not configured. '
        + `Set ORDER_SHEET_ID and GOOGLE_CREDENTIALS_PATH. (${sheetsInitError?.message})`,
      status: 503,
    });
  };
  app.use('/api/purchasing', gate, unavailable);
  app.use('/api/receiving', gate, unavailable);
}

// Unknown API routes → JSON 404 (before the SPA fallback below).
app.use('/api', apiNotFound);

// ---------------------------------------------------------------------------
// Serve React SPA (production build from dist/)
// ---------------------------------------------------------------------------
const distPath = path.resolve(__dirname, '../../dist');
app.use(express.static(distPath));

/**
 * Client-side routes that are mentor-only. Gating the document means a direct
 * link or bookmark bounces to Authentik before the app even loads; the API
 * gate above is what actually protects the data, since a client-side
 * navigation never asks the server for a document at all.
 */
const GATED_PAGES = ['/purchasing', '/receiving'];

const sendApp = (req, res) => res.sendFile(path.join(distPath, 'index.html'));

app.get(GATED_PAGES, gate, sendApp);

// Fallback: serve index.html for every other non-API path.
app.get('*', sendApp);

// ---------------------------------------------------------------------------
// Error handler (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
app.listen(PORT, HOST, () => {
  console.log(`ValorBOM server listening on http://${HOST}:${PORT}`);
  sheetSync?.start();

  if (authConfig.configured) {
    console.log(`Auth: Authentik OIDC via ${authConfig.issuer}`);
    if (authConfig.requireGroup) {
      console.log(`Auth: additionally requiring group "${authConfig.requireGroup}"`);
    } else {
      console.log('Auth: group membership enforced by Authentik\'s application binding');
    }
  }

  // Only a worry when the gate is not actually standing: a configured OIDC
  // gate is a real credential check, so a wider bind is a deliberate choice
  // rather than an exposure.
  if (!isLoopbackHost(HOST) && !authConfig.configured) {
    console.warn(
      `WARNING: bound to ${HOST} with authentication unconfigured. The parts-ordering `
      + 'routes are refusing every request with 503, but the BOM API and pages are '
      + 'deliberately public and ARE being served to the network from this bind. '
      + 'Configure Authentik, or bind HOST=127.0.0.1 if nothing should be reachable.',
    );
  }
});

export default app;
