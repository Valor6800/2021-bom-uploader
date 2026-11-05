/**
 * Epic Routes — GET /api/epics/search, GET /api/epics/:key,
 * GET /api/epics/:key/sub-assemblies, GET /api/epics/:key/purchased-parts, GET /api/epics/:key/activity, POST /api/epics/onboard/preview, POST /api/epics/onboard
 */

import { Router } from 'express';
import { validateIssueKey } from '../utils/validators.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';

/** The `url` body parameter of the onboarding routes, trimmed. */
function requireOnshapeUrl(body) {
  const url = body?.url;
  if (typeof url !== 'string' || !url.trim()) {
    throw badRequest('Missing required body parameter: url (string)');
  }
  if (url.length > 2000) {
    throw badRequest('url is limited to 2000 characters');
  }
  return url.trim();
}

/**
 * @param {object} deps
 * @param {import('../services/epicService.js').EpicService} deps.epicService
 * @returns {Router}
 */
export default function epicRoutes({ epicService, activityLog }) {
  const router = Router();

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
   * GET /api/epics/:key/activity — who did what to this Assembly, newest
   * first: [{ at, action, who, text }] (empty when the log isn't kept here).
   */
  router.get('/:key/activity', asyncHandler(async (req, res) => {
    const check = validateIssueKey(req.params.key);
    if (!check.valid) throw badRequest(check.error);
    res.json({ entries: activityLog ? await activityLog.list(req.params.key) : [] });
  }));

  /**
   * GET /api/epics/:key/purchased-parts?build=HAR-123 — the off-the-shelf
   * parts of the Assembly (rows from other OnShape documents), from the
   * Build's cut version, or the live BOM for a Draft.
   * → { parts: [{ name, partNumber, quantity }], error? }
   */
  router.get('/:key/purchased-parts', asyncHandler(async (req, res) => {
    const check = validateIssueKey(req.params.key);
    if (!check.valid) throw badRequest(check.error);
    const build = typeof req.query.build === 'string' && req.query.build ? req.query.build : undefined;
    if (build) {
      const buildCheck = validateIssueKey(build);
      if (!buildCheck.valid) throw badRequest(buildCheck.error);
    }
    res.json(await epicService.getPurchasedParts(req.params.key, build));
  }));

  /**
   * GET /api/epics/:key/sub-assemblies?build=HAR-123 — the Assembly's
   * sub-assemblies from its OnShape BOM (a cut Build's version, else the
   * workspace), each matched to its own Assembly where one exists.
   * → { subAssemblies: [{ name, status: 'exists'|'missing', assembly? }], error? }
   */
  router.get('/:key/sub-assemblies', asyncHandler(async (req, res) => {
    const check = validateIssueKey(req.params.key);
    if (!check.valid) {
      throw badRequest(check.error);
    }
    const build = typeof req.query.build === 'string' && req.query.build ? req.query.build : undefined;
    if (build) {
      const buildCheck = validateIssueKey(build);
      if (!buildCheck.valid) throw badRequest(buildCheck.error);
    }
    res.json(await epicService.getSubAssemblies(req.params.key, build));
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
   * POST /api/epics/onboard/preview  { url } — read-only check of a pasted
   * OnShape link: { status: 'new', proposed } or { status: 'exists', … }.
   */
  router.post('/onboard/preview', asyncHandler(async (req, res) => {
    const url = requireOnshapeUrl(req.body);
    const result = await epicService.previewOnboarding(url);
    res.json(result);
  }));

  /**
   * POST /api/epics/onboard  { url, expectedSummary } — creates the
   * Assembly and its Build 1.
   */
  router.post('/onboard', asyncHandler(async (req, res) => {
    const url = requireOnshapeUrl(req.body);
    const { expectedSummary } = req.body;
    if (typeof expectedSummary !== 'string' || !expectedSummary.trim()) {
      throw badRequest('Missing required body parameter: expectedSummary (string)');
    }
    if (expectedSummary.length > 255) {
      throw badRequest('expectedSummary is limited to 255 characters');
    }
    const result = await epicService.onboardAssembly({ url, expectedSummary });
    res.json(result);
    if (result?.status === 'created' && result.assembly?.key) {
      activityLog?.record({
        assemblyKey: result.assembly.key,
        user: req.user,
        action: 'onboard',
        text: `added ${result.assembly.summary ?? result.assembly.key} from OnShape${result.build?.key ? `, with Build 1 (${result.build.key})` : ''}`,
      });
    }
  }));

  return router;
}
