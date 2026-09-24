/**
 * BOM Routes — GET /api/bom
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';

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
  router.get('/', asyncHandler(async (req, res) => {
    const { epicKey, documentId, workspaceId, elementId } = req.query;

    if (!epicKey || !documentId || !workspaceId || !elementId) {
      throw badRequest('Missing required query parameters: epicKey, documentId, workspaceId, elementId');
    }

    const bom = await bomService.getBOM(epicKey, documentId, workspaceId, elementId);
    res.json(bom);
  }));

  return router;
}
