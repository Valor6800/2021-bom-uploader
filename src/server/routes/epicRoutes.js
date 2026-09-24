/**
 * Epic Routes — GET /api/epics, POST /api/epics/from-url
 */

import { Router } from 'express';
import { sanitizeJQL } from '../utils/validators.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';

/**
 * @param {object} deps
 * @param {import('../services/epicService.js').EpicService} deps.epicService
 * @returns {Router}
 */
export default function epicRoutes({ epicService }) {
  const router = Router();

  /**
   * GET /api/epics?seasonType&year
   */
  router.get('/', asyncHandler(async (req, res) => {
    const { seasonType, year } = req.query;

    if (!seasonType || !year) {
      throw badRequest('Missing required query parameters: seasonType and year');
    }

    const safe = sanitizeJQL(seasonType);
    if (safe !== 'R' && safe !== 'F') {
      throw badRequest('seasonType must be "R" or "F"');
    }

    const epics = await epicService.getEpics(seasonType, year);
    res.json(epics);
  }));

  /**
   * POST /api/epics/from-url  { url: string }
   */
  router.post('/from-url', asyncHandler(async (req, res) => {
    const { url } = req.body;

    if (!url || typeof url !== 'string') {
      throw badRequest('Missing required body parameter: url (string)');
    }

    const result = await epicService.generateEpicFromURL(url);
    res.json(result);
  }));

  return router;
}
