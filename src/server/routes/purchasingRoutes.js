/**
 * Purchasing Routes — the mentor-approved -> submitted-to-purchaser flow.
 *
 * GET  /api/purchasing/queue
 * POST /api/purchasing/preview
 * POST /api/purchasing/submit
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';

/**
 * @param {object} deps
 * @param {import('../services/purchasingService.js').PurchasingService} deps.purchasingService
 * @returns {Router}
 */
export default function purchasingRoutes({ purchasingService }) {
  const router = Router();

  /**
   * GET /api/purchasing/queue
   * Vendor-grouped Approved queue with anomaly flags, budget, and Wish-List.
   */
  router.get('/queue', asyncHandler(async (req, res) => {
    const queue = await purchasingService.getQueue();
    res.json(queue);
  }));

  /**
   * POST /api/purchasing/preview
   *   { rows: [{ key, classification, wishId, source }] }
   * Resolves target sheet rows and projected budget without writing anything.
   */
  router.post('/preview', asyncHandler(async (req, res) => {
    const { rows } = req.body ?? {};

    if (!Array.isArray(rows) || rows.length === 0) {
      throw badRequest('Missing required body parameter: rows (non-empty array)');
    }

    res.json(await purchasingService.previewSubmission({ rows }));
  }));

  /**
   * POST /api/purchasing/submit
   *   { rows: [{ key, classification, wishId, source }] }
   * Writes the rows to the Orders sheet, then transitions each ticket to
   * Sent to VFF. Returns partial results: the sheet write is all-or-nothing,
   * individual transition failures are reported per ticket.
   */
  router.post('/submit', asyncHandler(async (req, res) => {
    const { rows } = req.body ?? {};

    if (!Array.isArray(rows) || rows.length === 0) {
      throw badRequest('Missing required body parameter: rows (non-empty array)');
    }

    const result = await purchasingService.submit({ rows });
    res.json(result);
  }));

  return router;
}
