/**
 * Part Routes — story CRUD + part preview/upload/export
 *
 * GET  /api/stories
 * GET  /api/stories/:key
 * POST /api/stories
 * PUT  /api/stories/:key
 * GET  /api/parts/by-keys
 * POST /api/parts/:key/clone
 * POST /api/parts/preview
 * POST /api/parts/upload
 * POST /api/parts/auto-export
 */

import { Router } from 'express';
import { sanitizeJQL } from '../utils/validators.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';

/**
 * @param {object} deps
 * @param {import('../services/partService.js').PartService} deps.partService
 * @param {import('../services/exportService.js').ExportService} deps.exportService
 * @returns {Router}
 */
export default function partRoutes({ partService, exportService }) {
  const router = Router();

  /**
   * GET /api/stories?key=...  or  GET /api/stories?partNumber=...
   */
  router.get('/stories', asyncHandler(async (req, res) => {
    const { key, partNumber } = req.query;

    if (!key && !partNumber) {
      throw badRequest('Missing required query parameter: key or partNumber');
    }

    const stories = key
      ? await partService.getStoriesByEpic(sanitizeJQL(key))
      : await partService.getStoriesByPartNumber(sanitizeJQL(partNumber));

    res.json(stories);
  }));

  /**
   * GET /api/stories/:key — fetch a single Jira issue by key.
   */
  router.get('/stories/:key', asyncHandler(async (req, res) => {
    const issue = await partService.getStory(req.params.key);
    res.json(issue);
  }));

  /**
   * POST /api/stories  { summary, epic, material, machinery, ... }
   */
  router.post('/stories', asyncHandler(async (req, res) => {
    const payload = req.body;

    if (!payload || !payload.summary) {
      throw badRequest('Missing required body parameter: summary');
    }

    const result = await partService.createStory(payload);
    res.json(result);
  }));

  /**
   * PUT /api/stories/:key  { summary, material, machinery, ... }
   */
  router.put('/stories/:key', asyncHandler(async (req, res) => {
    const { key } = req.params;
    const payload = req.body;

    if (!payload || !payload.summary) {
      throw badRequest('Missing required body parameter: summary');
    }

    await partService.updateStory(key, payload);
    res.json({ success: true });
  }));

  /**
   * GET /api/parts/by-keys?keys=VAL-1,VAL-2 — bulk fetch for rendering a
   * per-build BOM (Sheet 06), where BuildService only knows linked part
   * keys, not their fields.
   */
  router.get('/parts/by-keys', asyncHandler(async (req, res) => {
    const { keys } = req.query;

    if (!keys) {
      throw badRequest('Missing required query parameter: keys');
    }

    const keyList = String(keys).split(',').map((k) => k.trim()).filter(Boolean);
    const stories = await partService.getStoriesByKeys(keyList);
    res.json(stories);
  }));

  /**
   * POST /api/parts/:key/clone  { epicKey, name?, quantity? }
   * "Clone a part" (Sheet 06) — a fresh, unrelated ticket, not a revision.
   */
  router.post('/parts/:key/clone', asyncHandler(async (req, res) => {
    const { epicKey, name, quantity } = req.body;

    if (!epicKey) {
      throw badRequest('Missing required body parameter: epicKey');
    }

    const result = await partService.clonePart({ sourceKey: req.params.key, epicKey, name, quantity });
    res.json(result);
  }));

  /**
   * POST /api/parts/preview  { epicKey, documentId, workspaceId, elementId }
   */
  router.post('/parts/preview', asyncHandler(async (req, res) => {
    const { epicKey, documentId, workspaceId, elementId } = req.body;

    if (!epicKey || !documentId || !workspaceId || !elementId) {
      throw badRequest('Missing required body parameters: epicKey, documentId, workspaceId, elementId');
    }

    const preview = await partService.previewParts({ epicKey, documentId, workspaceId, elementId });
    res.json(preview);
  }));

  /**
   * POST /api/parts/upload  { parts: [...] }
   */
  router.post('/parts/upload', asyncHandler(async (req, res) => {
    const { parts } = req.body;

    if (!Array.isArray(parts) || parts.length === 0) {
      throw badRequest('Missing required body parameter: parts (non-empty array)');
    }

    const result = await partService.uploadSelected(parts);
    res.json(result);
  }));

  /**
   * POST /api/parts/auto-export  { part }
   * Triggers an automatic STEP export when the part's machinery is "3D Printer".
   * Returns { exported: false } for non-3D-print parts. Exposes the previously
   * unrouted exportService.autoExportForPrint capability.
   */
  router.post('/parts/auto-export', asyncHandler(async (req, res) => {
    const { part } = req.body;

    if (!part || typeof part !== 'object') {
      throw badRequest('Missing required body parameter: part (object)');
    }

    const result = await exportService.autoExportForPrint(part);

    // Only the buffer is non-JSON; when a STEP was produced, stream it back.
    if (result.exported && result.buffer) {
      res.set('Content-Type', 'application/step');
      res.set('Content-Disposition', `attachment; filename="${part.fullPartNumber || part.partId || 'part'}.step"`);
      return res.send(result.buffer);
    }

    res.json({ exported: result.exported, error: result.error });
  }));

  return router;
}
