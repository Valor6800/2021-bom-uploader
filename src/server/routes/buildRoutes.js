/**
 * Build Routes — Build CRUD, the Part <-> Build link, and the Build
 * workflow transitions (cut version, archive).
 *
 * GET  /api/builds?assemblyKey&revisionChainKeys
 * POST /api/builds
 * GET  /api/builds/for-part/:partKey
 * GET  /api/builds/:key/parts
 * POST /api/builds/:key/parts
 * POST /api/builds/:key/parts/:partKey/recreate
 * POST /api/builds/:key/cut-version
 * POST /api/builds/:key/archive
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';
import { validateIssueKey } from '../utils/validators.js';
import { describeUpstreamError } from '../utils/upstreamError.js';

const CONTROL_RE = /[\x00-\x1f\x7f]/;

/** Throw a 400 naming `field` unless `value` is a valid key of this project. */
function requireKey(field, value) {
  const check = validateIssueKey(value);
  if (!check.valid) throw badRequest(`${field}: ${check.error}`);
}

/**
 * @param {object} deps
 * @param {import('../services/buildService.js').BuildService} deps.buildService
 * @returns {Router}
 */
export default function buildRoutes({ buildService }) {
  const router = Router();

  /**
   * GET /api/builds?assemblyKey=VAL-1&revisionChainKeys=VAL-1,VAL-1B
   * revisionChainKeys defaults to just assemblyKey when omitted.
   */
  router.get('/', asyncHandler(async (req, res) => {
    const { assemblyKey, revisionChainKeys } = req.query;

    if (!assemblyKey) {
      throw badRequest('Missing required query parameter: assemblyKey');
    }

    const chainKeys = revisionChainKeys
      ? String(revisionChainKeys).split(',').map((k) => k.trim()).filter(Boolean)
      : [assemblyKey];

    const builds = await buildService.getBuildsForAssemblies(chainKeys);
    res.json(builds);
  }));

  /**
   * POST /api/builds
   *   { assemblyKey, name, description?, revisionChainKeys?, cloneFromBuildKey? }
   * → { build, linked, failed, cloneError }
   *
   * A clone that fails after the Build exists still answers 200 with the
   * Build and `cloneError`, so the new Build is never hidden behind an error.
   */
  router.post('/', asyncHandler(async (req, res) => {
    const body = req.body ?? {};
    const { assemblyKey, revisionChainKeys, cloneFromBuildKey } = body;

    if (!assemblyKey || !body.name) {
      throw badRequest('Missing required body parameters: assemblyKey, name');
    }
    requireKey('assemblyKey', assemblyKey);

    if (typeof body.name !== 'string') throw badRequest('name must be a string');
    const name = body.name.trim();
    if (name.length < 1 || name.length > 80 || CONTROL_RE.test(name)) {
      throw badRequest('name must be 1 to 80 characters with no control characters');
    }

    let description;
    if (body.description !== undefined && body.description !== null) {
      if (typeof body.description !== 'string') throw badRequest('description must be a string');
      if (CONTROL_RE.test(body.description)) {
        throw badRequest('description must not contain control characters');
      }
      const collapsed = body.description.trim().replace(/\s+/g, ' ');
      if (collapsed.length > 60) throw badRequest('description is limited to 60 characters');
      description = collapsed || undefined;
    }

    if (revisionChainKeys !== undefined) {
      if (!Array.isArray(revisionChainKeys) || revisionChainKeys.length > 50) {
        throw badRequest('revisionChainKeys must be an array of at most 50 keys');
      }
      revisionChainKeys.forEach((k, i) => requireKey(`revisionChainKeys[${i}]`, k));
    }
    if (cloneFromBuildKey !== undefined) requireKey('cloneFromBuildKey', cloneFromBuildKey);

    const build = await buildService.createBuild({
      assemblyKey, revisionChainKeys, name, description, cloneFromBuildKey,
    });

    let linked = [];
    let failed = [];
    let cloneError = null;
    if (cloneFromBuildKey) {
      try {
        ({ linked, failed } = await buildService.cloneBuildParts(cloneFromBuildKey, build.key));
      } catch (err) {
        cloneError = describeUpstreamError(err);
        console.warn('[builds] clone into', build.key, 'failed:', err?.status, err?.message);
      }
    }

    res.json({ build, linked, failed, cloneError });
  }));

  /**
   * GET /api/builds/for-part/:partKey — every Build this Part is linked to,
   * newest first. The current-build indicator (Sheet 06) is just "the first
   * one in this list."
   */
  router.get('/for-part/:partKey', asyncHandler(async (req, res) => {
    const builds = await buildService.getBuildsForPart(req.params.partKey);
    res.json(builds);
  }));

  /**
   * GET /api/builds/:key/parts — part keys currently linked to this Build.
   */
  router.get('/:key/parts', asyncHandler(async (req, res) => {
    const parts = await buildService.getLinkedParts(req.params.key);
    res.json(parts);
  }));

  /**
   * POST /api/builds/:key/parts  { partKey }
   */
  router.post('/:key/parts', asyncHandler(async (req, res) => {
    const { partKey } = req.body;

    if (!partKey) {
      throw badRequest('Missing required body parameter: partKey');
    }

    await buildService.linkPartToBuild(partKey, req.params.key);
    res.json({ success: true });
  }));

  /**
   * POST /api/builds/:key/parts/:partKey/recreate — "Re-create for this
   * Build" (Sheet 06): the Part's design changed, so it needs a new
   * revision rather than just being moved forward.
   */
  router.post('/:key/parts/:partKey/recreate', asyncHandler(async (req, res) => {
    const result = await buildService.recreateForBuild({
      partKey: req.params.partKey,
      targetBuildKey: req.params.key,
    });
    res.json(result);
  }));

  /**
   * POST /api/builds/:key/cut-version  { assemblyKey, documentId, workspaceId, elementId }
   * Actually cuts a new Onshape version — the link isn't supplied by the
   * caller, it's what comes back from Onshape.
   */
  router.post('/:key/cut-version', asyncHandler(async (req, res) => {
    const { assemblyKey, documentId, workspaceId, elementId } = req.body;

    if (!assemblyKey || !documentId || !workspaceId || !elementId) {
      throw badRequest(
        'Missing required body parameters: assemblyKey, documentId, workspaceId, elementId',
      );
    }

    const result = await buildService.cutVersionFromOnshape({
      buildKey: req.params.key,
      assemblyKey,
      documentId,
      workspaceId,
      elementId,
    });
    res.json(result);
  }));

  /**
   * POST /api/builds/:key/archive
   */
  router.post('/:key/archive', asyncHandler(async (req, res) => {
    await buildService.archiveBuild(req.params.key);
    res.json({ success: true });
  }));

  return router;
}
