/**
 * Revision Routes — the Revises chain behind the Assembly hub's revision
 * selector (Sheet 06), which only shows up once a chain has more than one
 * ticket.
 *
 * GET /api/revisions/chain/:key
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';

/**
 * @param {object} deps
 * @param {import('../services/revisionService.js').RevisionService} deps.revisionService
 * @returns {Router}
 */
export default function revisionRoutes({ revisionService }) {
  const router = Router();

  /**
   * GET /api/revisions/chain/:key — every revision of this ticket, newest
   * first, starting with the key passed in.
   */
  router.get('/chain/:key', asyncHandler(async (req, res) => {
    const chain = await revisionService.getRevisionChain(req.params.key);
    res.json(chain);
  }));

  return router;
}
