/**
 * Epic Routes — GET /api/epics, GET /api/epics/search, GET /api/epics/:key,
 * POST /api/epics/from-url
 */

import { Router } from 'express';
import { sanitizeJQL, validateIssueKey } from '../utils/validators.js';
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
   * GET /api/epics/search?q&limit&includeClosed=1 — Home's Assembly search.
   * Registered before /:key, which would otherwise capture "search".
   */
  router.get('/search', asyncHandler(async (req, res) => {
    const { q = '', limit, includeClosed } = req.query;
    if (typeof q !== 'string') {
      throw badRequest('q must be a single string');
    }
    const query = q.replace(/[\x00-\x1f\x7f]/g, '').trim();
    if (query.length > 100) {
      throw badRequest('Search is limited to 100 characters');
    }
    let max = 50;
    if (limit !== undefined) {
      if (typeof limit !== 'string' || !/^\d+$/.test(limit) || +limit < 1 || +limit > 50) {
        throw badRequest('limit must be an integer from 1 to 50');
      }
      max = Number(limit);
    }
    if (includeClosed !== undefined && includeClosed !== '0' && includeClosed !== '1') {
      throw badRequest('includeClosed must be 0 or 1');
    }
    const result = await epicService.searchAssemblies(query, {
      limit: max,
      includeClosed: includeClosed === '1',
    });
    res.json(result);
  }));

  /**
   * GET /api/epics/:key — a single Assembly by key, numbered or not.
   */
  router.get('/:key', asyncHandler(async (req, res) => {
    const check = validateIssueKey(req.params.key);
    if (!check.valid) {
      throw badRequest(check.error);
    }
    const epic = await epicService.getEpicByKey(req.params.key);

    if (!epic) {
      throw badRequest(`"${req.params.key}" is not an Assembly`);
    }

    res.json(epic);
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
