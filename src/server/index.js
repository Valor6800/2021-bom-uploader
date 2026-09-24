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

// Services
import { BOMService } from './services/bomService.js';
import { EpicService } from './services/epicService.js';
import { PartService } from './services/partService.js';
import { ExportService } from './services/exportService.js';

// Routes
import epicRoutes from './routes/epicRoutes.js';
import partRoutes from './routes/partRoutes.js';
import bomRoutes from './routes/bomRoutes.js';
import exportRoutes from './routes/exportRoutes.js';

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

// ---------------------------------------------------------------------------
// Instantiate services (dependency injection)
// ---------------------------------------------------------------------------
const bomService = new BOMService({ onshapeClient });
const epicService = new EpicService({ jiraClient, onshapeClient });
const partService = new PartService({ jiraClient, bomService });
const exportService = new ExportService({ onshapeClient });

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
// Mount API routes
// ---------------------------------------------------------------------------
app.use('/api/epics', epicRoutes({ epicService }));
app.use('/api', partRoutes({ partService, exportService }));
app.use('/api/bom', bomRoutes({ bomService }));
app.use('/api/export', exportRoutes({ exportService }));

// Unknown API routes → JSON 404 (before the SPA fallback below).
app.use('/api', apiNotFound);

// ---------------------------------------------------------------------------
// Serve React SPA (production build from dist/)
// ---------------------------------------------------------------------------
const distPath = path.resolve(__dirname, '../../dist');
app.use(express.static(distPath));

// Fallback: serve index.html for non-API paths (client-side routing)
app.get('*', (req, res) => {
  res.sendFile(path.join(distPath, 'index.html'));
});

// ---------------------------------------------------------------------------
// Error handler (must be last)
// ---------------------------------------------------------------------------
app.use(errorHandler);

// ---------------------------------------------------------------------------
// Start server
// ---------------------------------------------------------------------------
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`ValorBOM server listening on http://localhost:${PORT}`);
});

export default app;
