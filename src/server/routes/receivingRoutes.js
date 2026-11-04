/**
 * Receiving Routes — checking parts in, and pulling the purchaser's sheet
 * edits into Jira.
 *
 * GET  /api/receiving
 * GET  /api/receiving/history
 * POST /api/receiving/check-in
 * POST /api/receiving/sync
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';

/**
 * @param {object} deps
 * @param {import('../services/receivingService.js').ReceivingService} deps.receivingService
 * @returns {Router}
 */
export default function receivingRoutes({ receivingService }) {
  const router = Router();

  /**
   * GET /api/receiving
   * In-flight orders (Sent to VFF and Ordered) grouped by vendor, matched to
   * their sheet rows, with the reconciliation plan.
   */
  router.get('/', asyncHandler(async (req, res) => {
    res.json(await receivingService.getReceiving());
  }));

  /**
   * GET /api/receiving/history
   * Past orders from the sheet, newest first, divided by the order-date rows,
   * with the requester and assembly for each line from Jira.
   */
  router.get('/history', asyncHandler(async (req, res) => {
    res.json(await receivingService.getOrderHistory());
  }));

  /**
   * POST /api/receiving/check-in  { keys: ["PARTS-1", ...], rows: [9, 12] }
   * Marks the sheet rows Delivered, then walks each ticket to Delivered.
   *
   * `rows` is for sheet rows the purchaser added with no Jira ticket behind
   * them — those are marked on the sheet only.
   */
  router.post('/check-in', asyncHandler(async (req, res) => {
    const { keys = [], rows = [] } = req.body ?? {};

    if (!Array.isArray(keys) || !Array.isArray(rows)) {
      throw badRequest('Body parameters keys and rows must be arrays');
    }
    if (keys.length === 0 && rows.length === 0) {
      throw badRequest('Provide at least one key or row to check in');
    }

    res.json(await receivingService.checkIn({ keys, rows }));
  }));

  /**
   * POST /api/receiving/sync
   * Advances any ticket the sheet has already moved past. Forward only.
   */
  router.post('/sync', asyncHandler(async (req, res) => {
    res.json(await receivingService.syncFromSheet());
  }));

  return router;
}
