/**
 * Part Routes — story CRUD + part preview/upload
 *
 * GET  /api/stories
 * POST /api/stories
 * PUT  /api/stories/:key
 * POST /api/parts/preview
 * POST /api/parts/upload
 */

import { Router } from 'express';
import { sanitizeJQL } from '../utils/validators.js';

/**
 * @param {object} deps
 * @param {import('../services/partService.js').PartService} deps.partService
 * @returns {Router}
 */
export default function partRoutes({ partService }) {
  const router = Router();

  /**
   * GET /api/stories?key=...  or  GET /api/stories?partNumber=...
   */
  router.get('/stories', async (req, res) => {
    try {
      const { key, partNumber } = req.query;

      if (!key && !partNumber) {
        return res.status(400).json({
          error: 'Missing required query parameter: key or partNumber',
          status: 400,
        });
      }

      let stories;
      if (key) {
        stories = await partService.getStoriesByEpic(sanitizeJQL(key));
      } else {
        stories = await partService.getStoriesByPartNumber(sanitizeJQL(partNumber));
      }

      res.json(stories);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, status });
    }
  });

  /**
   * POST /api/stories  { summary, epic, material, machinery, ... }
   */
  router.post('/stories', async (req, res) => {
    try {
      const payload = req.body;

      if (!payload || !payload.summary) {
        return res.status(400).json({
          error: 'Missing required body parameter: summary',
          status: 400,
        });
      }

      const result = await partService.createStory(payload);
      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, status });
    }
  });

  /**
   * PUT /api/stories/:key  { summary, material, machinery, ... }
   */
  router.put('/stories/:key', async (req, res) => {
    try {
      const { key } = req.params;
      const payload = req.body;

      if (!payload || !payload.summary) {
        return res.status(400).json({
          error: 'Missing required body parameter: summary',
          status: 400,
        });
      }

      await partService.updateStory(key, payload);
      res.json({ success: true });
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, status });
    }
  });

  /**
   * POST /api/parts/preview  { epicKey, documentId, workspaceId, elementId }
   */
  router.post('/parts/preview', async (req, res) => {
    try {
      const { epicKey, documentId, workspaceId, elementId } = req.body;

      if (!epicKey || !documentId || !workspaceId || !elementId) {
        return res.status(400).json({
          error: 'Missing required body parameters: epicKey, documentId, workspaceId, elementId',
          status: 400,
        });
      }

      const preview = await partService.previewParts({
        epicKey,
        documentId,
        workspaceId,
        elementId,
      });
      res.json(preview);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, status });
    }
  });

  /**
   * POST /api/parts/upload  { parts: [...] }
   */
  router.post('/parts/upload', async (req, res) => {
    try {
      const { parts } = req.body;

      if (!Array.isArray(parts) || parts.length === 0) {
        return res.status(400).json({
          error: 'Missing required body parameter: parts (non-empty array)',
          status: 400,
        });
      }

      const result = await partService.uploadSelected(parts);
      res.json(result);
    } catch (err) {
      const status = err.status || 500;
      res.status(status).json({ error: err.message, status });
    }
  });

  return router;
}
