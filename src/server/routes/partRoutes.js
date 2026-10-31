/**
 * Part Routes — story reads and update, part preview/export
 *
 * GET  /api/stories
 * GET  /api/stories/:key
 * PUT  /api/stories/:key
 * GET  /api/parts/by-keys
 * POST /api/parts/:key/clone
 * POST /api/parts/preview
 * POST /api/parts/auto-export
 *
 * Parts are created only through a Build save (POST /api/builds/:key/save),
 * Clone and Re-create, so every new Part belongs to a Build or an Assembly.
 */

import { Router } from 'express';
import { sanitizeJQL, validateIssueKey, validateQuantity } from '../utils/validators.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';

const ONSHAPE_ID_RE = /^[a-f0-9]{24}$/i;

/** Throw a 400 naming `field` unless `value` is a valid key of this project. */
function requireKey(field, value) {
  const check = validateIssueKey(value);
  if (!check.valid) throw badRequest(`${field}: ${check.error}`);
}

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
   * GET /api/stories?key=...&chain=1 — Parts across the Assembly's whole
   * Revision chain, one per Part number (newest Revision wins).
   */
  router.get('/stories', asyncHandler(async (req, res) => {
    const { key, partNumber, chain } = req.query;

    if (chain !== undefined) {
      if (chain !== '1') throw badRequest('chain must be 1');
      requireKey('key', key);
      const { stories } = await partService.getStoriesForChain(key);
      return res.json(stories);
    }

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
   * POST /api/parts/:key/clone  { epicKey, quantity? }
   * "Create spare": an exact copy (same number, name and Revision) as a
   * fresh, unrelated ticket, not a revision. Nothing is renumbered.
   * → { key, fullPartNumber, part }
   */
  router.post('/parts/:key/clone', asyncHandler(async (req, res) => {
    const { epicKey, quantity } = req.body ?? {};

    if (!epicKey) {
      throw badRequest('Missing required body parameter: epicKey');
    }
    requireKey('key', req.params.key);
    requireKey('epicKey', epicKey);
    if (quantity !== undefined) {
      const check = validateQuantity(quantity);
      if (!check.valid) throw badRequest(`quantity: ${check.error}`);
    }

    const result = await partService.clonePart({ sourceKey: req.params.key, epicKey, quantity });
    res.json(result);
  }));

  /**
   * POST /api/parts/preview  { epicKey, documentId, workspaceId, elementId, fresh? }
   * `fresh: true` skips the 60-second BOM cache (Update from CAD).
   */
  router.post('/parts/preview', asyncHandler(async (req, res) => {
    const { epicKey, documentId, workspaceId, elementId, fresh } = req.body ?? {};

    if (!epicKey || !documentId || !workspaceId || !elementId) {
      throw badRequest('Missing required body parameters: epicKey, documentId, workspaceId, elementId');
    }
    requireKey('epicKey', epicKey);
    for (const [field, value] of Object.entries({ documentId, workspaceId, elementId })) {
      if (typeof value !== 'string' || !ONSHAPE_ID_RE.test(value)) {
        throw badRequest(`${field} must be a 24-character OnShape id`);
      }
    }
    if (fresh !== undefined && typeof fresh !== 'boolean') {
      throw badRequest('fresh must be true or false');
    }

    const preview = await partService.previewParts({
      epicKey, documentId, workspaceId, elementId, fresh: fresh === true,
    });
    res.json(preview);
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
