/**
 * Guide Routes — what the Assembly page shows students building a Build.
 * All read-only.
 *
 * GET /api/guide/:buildKey                  build steps and kits (from the Build's OnShape BOM)
 * GET /api/guide/:buildKey/image/:imageId   a step's or a part's picture (?size=large for the enlarged view)
 * GET /api/vendor/lookup?skus=A,B           order tickets and vendor listings by SKU
 * GET /api/vendor/image/:sku                a vendor listing's picture (?size=large for the enlarged view)
 * GET /api/boards/columns                   which board column each Part status is in
 */

import { Router } from 'express';
import { validateIssueKey } from '../utils/validators.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { HttpError, badRequest } from '../middleware/httpError.js';
import { SKU_PATTERN } from '../utils/vendorSku.js';

function requireKey(value) {
  const check = validateIssueKey(value);
  if (!check.valid) throw badRequest(check.error);
}

/**
 * @param {object} deps
 * @param {import('../services/assemblyGuides.js').AssemblyGuides} deps.guides
 * @param {import('../services/vendorCatalog.js').VendorCatalog} deps.vendorCatalog
 * @param {import('../services/boardColumns.js').BoardColumns} deps.boardColumns
 * @returns {Router}
 */
export default function guideRoutes({ guides, vendorCatalog, boardColumns }) {
  const router = Router();

  router.get('/guide/:key', asyncHandler(async (req, res) => {
    requireKey(req.params.key);
    res.json(await guides.guide(req.params.key));
  }));

  router.get('/guide/:key/image/:imageId', asyncHandler(async (req, res) => {
    requireKey(req.params.key);
    const { image, live } = await guides.image(req.params.key, req.params.imageId, { large: req.query.size === 'large' });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', live ? 'private, max-age=300' : 'private, max-age=86400');
    res.send(image);
  }));

  router.get('/vendor/lookup', asyncHandler(async (req, res) => {
    const skus = String(req.query.skus ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    if (skus.length > 60) throw badRequest('At most 60 SKUs at a time');
    const bad = skus.find((s) => !SKU_PATTERN.test(s));
    if (bad) throw badRequest(`"${bad.slice(0, 40)}" is not a vendor part number`);
    res.json(await vendorCatalog.lookup(skus.map((sku) => ({ sku }))));
  }));

  router.get('/vendor/image/:sku', asyncHandler(async (req, res) => {
    const sku = String(req.params.sku ?? '').toUpperCase();
    if (!SKU_PATTERN.test(sku)) throw badRequest('Not a vendor part number');
    const found = await vendorCatalog.image(sku, { large: req.query.size === 'large' });
    if (!found) throw new HttpError(404, 'No picture for this part.');
    res.set('Content-Type', found.contentType);
    res.set('Cache-Control', 'private, max-age=86400');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(found.image);
  }));

  router.get('/boards/columns', asyncHandler(async (req, res) => {
    res.set('Cache-Control', 'private, max-age=300');
    res.json(await boardColumns.get());
  }));

  return router;
}
