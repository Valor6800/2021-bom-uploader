/**
 * Export Routes — POST /api/export/step, POST /api/export/stl
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';

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
  router.post('/step', asyncHandler(async (req, res) => {
    const { documentId, workspaceId, elementId, partId } = req.body;

    if (!documentId || !workspaceId || !elementId || !partId) {
      throw badRequest('Missing required body parameters: documentId, workspaceId, elementId, partId');
    }

    const buffer = await exportService.exportSTEP(documentId, workspaceId, elementId, partId);
    res.set('Content-Type', 'application/step');
    res.set('Content-Disposition', `attachment; filename="${partId}.step"`);
    res.send(buffer);
  }));

  /**
   * POST /api/export/stl  { documentId, workspaceId, elementId, partId }
   */
  router.post('/stl', asyncHandler(async (req, res) => {
    const { documentId, workspaceId, elementId, partId } = req.body;

    if (!documentId || !workspaceId || !elementId || !partId) {
      throw badRequest('Missing required body parameters: documentId, workspaceId, elementId, partId');
    }

    const buffer = await exportService.exportSTL(documentId, workspaceId, elementId, partId);
    res.set('Content-Type', 'application/sla');
    res.set('Content-Disposition', `attachment; filename="${partId}.stl"`);
    res.send(buffer);
  }));

  return router;
}
