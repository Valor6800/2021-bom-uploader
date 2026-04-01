/**
 * Epic Routes — GET /api/epics, POST /api/epics/from-url
 */

import { Router } from 'express';
import { sanitizeJQL } from '../utils/validators.js';

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
  router.get('/', async (req, res) => {
    try {
      const seasonType = req.query.seasonType;
      const year = req.query.year;

      if (!seasonType || !year) {
        return res.status(400).json({
          error: 'Missing required query parameters: seasonType and year',
          status: 400,
        });
      }

      const safe = sanitizeJQL(seasonType);
      if (safe !== 'R' && safe !== 'F') {
        return res.status(400).json({
          error: 'seasonType must be "R" or "F"',
          status: 400,
        });
      }

      const epics = await epicService.getEpics(seasonType, year);
      res.json(epics);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, status });
    }
  });

  /**
   * POST /api/epics/from-url  { url: string }
   */
  router.post('/from-url', async (req, res) => {
    try {
      const { url } = req.body;

      if (!url || typeof url !== 'string') {
        return res.status(400).json({
          error: 'Missing required body parameter: url (string)',
          status: 400,
        });
      }

      const result = await epicService.generateEpicFromURL(url);
      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, status });
    }
  });

  return router;
}
