/**
 * Export Routes — POST /api/export/step, POST /api/export/stl
 */

import { Router } from 'express';

/**
 * @param {object} deps
 * @param {import('../services/exportService.js').ExportService} deps.exportService
 * @returns {Router}
 */
export default function exportRoutes({ exportService }) {
  const router = Router();

  /**
   * POST /api/export/step  { documentId, workspaceId, elementId, partId }
   */
  router.post('/step', async (req, res) => {
    try {
      const { documentId, workspaceId, elementId, partId } = req.body;

      if (!documentId || !workspaceId || !elementId || !partId) {
        return res.status(400).json({
          error: 'Missing required body parameters: documentId, workspaceId, elementId, partId',
          status: 400,
        });
      }

      const buffer = await exportService.exportSTEP(documentId, workspaceId, elementId, partId);
      res.set('Content-Type', 'application/step');
      res.set('Content-Disposition', `attachment; filename="${partId}.step"`);
      res.send(buffer);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, status });
    }
  });

  /**
   * POST /api/export/stl  { documentId, workspaceId, elementId, partId }
   */
  router.post('/stl', async (req, res) => {
    try {
      const { documentId, workspaceId, elementId, partId } = req.body;

      if (!documentId || !workspaceId || !elementId || !partId) {
        return res.status(400).json({
          error: 'Missing required body parameters: documentId, workspaceId, elementId, partId',
          status: 400,
        });
      }

      const buffer = await exportService.exportSTL(documentId, workspaceId, elementId, partId);
      res.set('Content-Type', 'application/sla');
      res.set('Content-Disposition', `attachment; filename="${partId}.stl"`);
      res.send(buffer);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, status });
    }
  });

  return router;
}
