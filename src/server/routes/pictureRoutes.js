/**
 * Picture Routes — the images the tool shows.
 *
 * GET /api/pictures/part/:key    a Part's picture (the PNG on its ticket)
 * GET /api/pictures/build/:key   a Build's Assembly picture (?fresh=1 draws a Draft again)
 * GET /api/pictures/status?keys= where the background file jobs for Part tickets stand
 */

import { Router } from 'express';
import { validateIssueKey } from '../utils/validators.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';

function requireKey(value) {
  const check = validateIssueKey(value);
  if (!check.valid) throw badRequest(check.error);
}

/**
 * @param {object} deps
 * @param {import('../services/pictures.js').Pictures} deps.pictures
 * @param {import('../services/fileJobs.js').FileJobs} [deps.fileJobs]
 * @returns {Router}
 */
export default function pictureRoutes({ pictures, fileJobs }) {
  const router = Router();

  /** → { statuses: { [partKey]: { state: 'pending'|'done'|'failed', problems } } }; a key never queued is left out */
  router.get('/status', (req, res) => {
    const keys = String(req.query.keys ?? '').split(',').map((k) => k.trim()).filter(Boolean).slice(0, 100);
    keys.forEach(requireKey);
    res.json({ statuses: fileJobs ? fileJobs.status(keys) : {} });
  });

  router.get('/part/:key', asyncHandler(async (req, res) => {
    requireKey(req.params.key);
    const image = await pictures.partImage(req.params.key);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, max-age=3600');
    res.send(image);
  }));

  router.get('/build/:key', asyncHandler(async (req, res) => {
    requireKey(req.params.key);
    const { image, live } = await pictures.buildImage(req.params.key, { fresh: req.query.fresh === '1' });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', live ? 'no-cache' : 'private, max-age=3600');
    res.send(image);
  }));

  return router;
}
