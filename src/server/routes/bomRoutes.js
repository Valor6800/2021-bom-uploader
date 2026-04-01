/**
 * BOM Routes — GET /api/bom
 */

import { Router } from 'express';

/**
 * @param {object} deps
 * @param {import('../services/bomService.js').BOMService} deps.bomService
 * @returns {Router}
 */
export default function bomRoutes({ bomService }) {
  const router = Router();

  /**
   * GET /api/bom?epicKey&documentId&workspaceId&elementId
   */
  router.get('/', async (req, res) => {
    try {
      const { epicKey, documentId, workspaceId, elementId } = req.query;

      if (!epicKey || !documentId || !workspaceId || !elementId) {
        return res.status(400).json({
          error: 'Missing required query parameters: epicKey, documentId, workspaceId, elementId',
          status: 400,
        });
      }

      const bom = await bomService.getBOM(epicKey, documentId, workspaceId, elementId);
      res.json(bom);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, status });
    }
  });

  return router;
}
