/**
 * Build Routes — Build CRUD, the Part <-> Build link, and the Build
 * workflow transitions (cut version, archive).
 *
 * GET  /api/builds?assemblyKey&revisionChainKeys
 * GET  /api/builds/status?keys=K1,K2
 * POST /api/builds
 * GET  /api/builds/for-part/:partKey
 * GET  /api/builds/:key/parts
 * POST /api/builds/:key/parts
 * POST /api/builds/:key/save
 * POST /api/builds/:key/cut-version
 * POST /api/builds/:key/files
 * POST /api/builds/:key/archive
 */

import { Router } from 'express';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';
import { validateIssueKey } from '../utils/validators.js';
import { describeUpstreamError } from '../utils/upstreamError.js';
import { applyPartMask } from '../utils/partMask.js';

const CONTROL_RE = /[\x00-\x1f\x7f]/;

/** Most items one save request may carry. */
const MAX_SAVE_ITEMS = 200;

/** Most Builds one status request may read. */
const MAX_STATUS_KEYS = 10;

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Structural checks for a save body. These only fail for a buggy or
 * crafted client, so they reject the whole request before any write.
 * Field values (material, quantity, ...) are checked per item by the service.
 *
 * @returns {{ creates: object[], updates: object[], links: object[], copies: object[] }}
 */
function validateSaveBody(body) {
  if (!isPlainObject(body)) throw badRequest('Body must be an object');

  const lists = {};
  for (const name of ['creates', 'updates', 'links', 'copies']) {
    const value = body[name];
    if (value === undefined || value === null) lists[name] = [];
    else if (Array.isArray(value)) lists[name] = value;
    else throw badRequest(`${name} must be an array`);
  }

  const total = lists.creates.length + lists.updates.length + lists.links.length + lists.copies.length;
  if (total < 1 || total > MAX_SAVE_ITEMS) {
    throw badRequest(`A save must hold 1 to ${MAX_SAVE_ITEMS} items`);
  }

  const refs = new Set();
  for (const [name, items] of Object.entries(lists)) {
    items.forEach((item, i) => {
      const path = `${name}[${i}]`;
      if (!isPlainObject(item)) throw badRequest(`${path}: must be an object`);
      if (typeof item.ref !== 'string' || item.ref.length < 1 || item.ref.length > 40) {
        throw badRequest(`${path}.ref: ref must be a string of 1 to 40 characters`);
      }
      if (refs.has(item.ref)) throw badRequest(`${path}.ref: ref "${item.ref}" is used twice`);
      refs.add(item.ref);

      if (name === 'creates') {
        const parsed = typeof item.summary === 'string' && item.summary.length <= 255
          ? applyPartMask(item.summary)
          : null;
        if (!parsed || parsed.isEpic) {
          throw badRequest(`${path}.summary: summary must start with a Part number like VF27P-0001A`);
        }
        if (item.revision !== undefined && item.revision !== null && typeof item.revision !== 'string') {
          throw badRequest(`${path}.revision: revision must be a string`);
        }
        if (item.revises !== undefined) {
          const revises = validateIssueKey(item.revises);
          if (!revises.valid) throw badRequest(`${path}.revises: ${revises.error}`);
        }
        if (item.cadRef !== undefined && (typeof item.cadRef !== 'string' || item.cadRef.length > 200)) {
          throw badRequest(`${path}.cadRef: cadRef must be a string`);
        }
      } else if (name === 'copies') {
        const from = validateIssueKey(item.from);
        if (!from.valid) throw badRequest(`${path}.from: ${from.error}`);
      } else {
        const check = validateIssueKey(item.key);
        if (!check.valid) throw badRequest(`${path}.key: ${check.error}`);
        if (name === 'updates' && item.link !== undefined && typeof item.link !== 'boolean') {
          throw badRequest(`${path}.link: link must be true or false`);
        }
      }
    });
  }
  return lists;
}

/** Throw a 400 naming `field` unless `value` is a valid key of this project. */
/** A save's results in words ("2 Parts made, 1 updated"), or '' when nothing was done. */
export function saveSummary(results) {
  const ok = (op) => (results ?? []).filter((r) => r.op === op && r.ok).length;
  const failed = (results ?? []).filter((r) => !r.ok).length;
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
  const parts = [
    ok('create') && plural(ok('create'), 'Part made', 'Parts made'),
    ok('copy') && plural(ok('copy'), 'copy made', 'copies made'),
    ok('update') && plural(ok('update'), 'Part changed', 'Parts changed'),
    ok('link') && plural(ok('link'), 'Part added', 'Parts added'),
  ].filter(Boolean);
  if (!parts.length) return '';
  return `${parts.join(', ')}${failed ? ` (${failed} failed)` : ''}`;
}

function requireKey(field, value) {
  const check = validateIssueKey(value);
  if (!check.valid) throw badRequest(`${field}: ${check.error}`);
}

/**
 * @param {object} deps
 * @param {import('../services/buildService.js').BuildService} deps.buildService
 * @returns {Router}
 */
export default function buildRoutes({ buildService, activityLog }) {
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
   * GET /api/builds/status?keys=HAR-1,HAR-2 — Build statuses read by key
   * (search lags a status change). Registered before every /:key route.
   * → { builds: [{ key, status, assemblyKey, onshapeVersionLink }], missing }
   */
  router.get('/status', asyncHandler(async (req, res) => {
    const { keys } = req.query;
    if (typeof keys !== 'string') {
      throw badRequest(`keys must list 1 to ${MAX_STATUS_KEYS} Build keys`);
    }
    const list = [...new Set(keys.split(',').map((k) => k.trim()).filter(Boolean))];
    if (list.length < 1 || list.length > MAX_STATUS_KEYS) {
      throw badRequest(`keys must list 1 to ${MAX_STATUS_KEYS} Build keys`);
    }
    for (const key of list) {
      const check = validateIssueKey(key);
      if (!check.valid) throw badRequest(check.error);
    }

    res.json(await buildService.getBuildStatuses(list));
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
    activityLog?.record({
      assemblyKey, buildKey: build?.key, user: req.user, action: 'build',
      text: `made {build}${cloneFromBuildKey ? ` from ${cloneFromBuildKey}` : ''}`,
    });
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
   * POST /api/builds/:key/save  { creates?, updates?, links?, copies? }
   * → 200 { results: [...] }, even when some items failed.
   */
  router.post('/:key/save', asyncHandler(async (req, res) => {
    requireKey('key', req.params.key);
    const { creates, updates, links, copies } = validateSaveBody(req.body);

    const result = await buildService.saveBuildParts({
      buildKey: req.params.key, creates, updates, links, copies,
    });
    res.json(result);
    const done = saveSummary(result.results);
    if (done) activityLog?.record({ buildKey: req.params.key, user: req.user, action: 'save', text: `saved {build}: ${done}` });
  }));

  /**
   * POST /api/builds/:key/cut-version  { assemblyKey }
   * Actually cuts a new Onshape version — the link isn't supplied by the
   * caller, it's what comes back from Onshape. The OnShape ids are read from
   * the Assembly; ids in the body (older clients) are ignored.
   * → { onshapeVersionLink, superseded, resumed }; 409 with `buildStatus`
   *   when the Build was already cut.
   */
  router.post('/:key/cut-version', asyncHandler(async (req, res) => {
    requireKey('key', req.params.key);
    const { assemblyKey } = req.body ?? {};
    if (!assemblyKey) throw badRequest('Missing required body parameter: assemblyKey');
    requireKey('assemblyKey', assemblyKey);

    const result = await buildService.cutVersionFromOnshape({
      buildKey: req.params.key,
      assemblyKey,
    });
    res.json(result);
    const superseded = (result.superseded ?? []).map((b) => b?.key ?? b).filter(Boolean);
    activityLog?.record({
      assemblyKey,
      buildKey: req.params.key,
      user: req.user,
      action: 'cut',
      text: `cut {build} from OnShape${result.resumed ? ' (finishing an earlier try)' : ''}`
        + `${superseded.length ? `; ${superseded.join(', ')} superseded` : ''}`,
    });
  }));

  /**
   * POST /api/builds/:key/files
   * Make the files a cut Build's Parts are missing (picture, drawings, DXF,
   * STEP), in the background. → { queued: [partKey], missing: { partKey: [kind] } };
   * 409 for a Draft.
   */
  router.post('/:key/files', asyncHandler(async (req, res) => {
    requireKey('key', req.params.key);
    const result = await buildService.queueMissingFiles(req.params.key);
    res.json(result);
    if (result.queued.length) {
      activityLog?.record({
        buildKey: req.params.key, user: req.user, action: 'files',
        text: `asked for the missing files of ${result.queued.length} Part${result.queued.length === 1 ? '' : 's'} in {build}`,
      });
    }
  }));

  /**
   * POST /api/builds/:key/archive
   */
  router.post('/:key/archive', asyncHandler(async (req, res) => {
    requireKey('key', req.params.key);
    await buildService.archiveBuild(req.params.key);
    activityLog?.record({ buildKey: req.params.key, user: req.user, action: 'archive', text: 'archived {build}' });
    res.json({ success: true });
  }));

  return router;
}
