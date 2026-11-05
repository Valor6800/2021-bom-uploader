/**
 * Picture Routes — the images the tool shows.
 *
 * GET /api/pictures/part/:key    a Part's picture (the PNG on its ticket)
 * GET /api/pictures/drawing/:key a Part's drawing (the `_drawing.png` on its ticket)
 * GET /api/pictures/cad?d&wvm&wvmid&e&p[&c][&mv][&rgb]
 *                                a part as it is in OnShape now, drawn from its shape (the Designer's)
 * GET /api/pictures/build/:key   a Build's Assembly picture (?fresh=1 draws a Draft again)
 * GET /api/pictures/hardware?kind&finish&d&length&head&headHeight&od&id[&hex][&flange][&size=large]
 *                                a screw, nut, washer, spacer or bearing drawn by the tool (no OnShape call)
 * GET /api/pictures/status?keys= where the background file jobs for Part tickets stand
 */

import { Router } from 'express';
import { validateIssueKey } from '../utils/validators.js';
import { asyncHandler } from '../middleware/asyncHandler.js';
import { badRequest } from '../middleware/httpError.js';
import { isConfigurationText } from '../utils/onshapeConfiguration.js';
import { hardwareFromQuery } from '../utils/hardwareSpec.js';
import { hardwarePicture } from '../utils/hardwarePicture.js';

/** Hardware pictures drawn lately, by query: a page shows the same screw many times. */
const HARDWARE_CACHE = new Map();
const MAX_HARDWARE = 200;

const ID = /^[a-f0-9]{24}$/i;
const PART_ID = /^[A-Za-z0-9+/=_-]{1,32}$/;
const RGB = /^[a-f0-9]{6}$/i;

/** The part a live picture is of, from the query, or a 400. */
function cadOrigin(q) {
  const one = (v) => (Array.isArray(v) ? undefined : v);
  const [d, wvm, wvmid, e, p, c, mv, rgb] = ['d', 'wvm', 'wvmid', 'e', 'p', 'c', 'mv', 'rgb'].map((k) => one(q[k]));
  if (![d, wvmid, e].every((v) => ID.test(v ?? '')) || !['w', 'v', 'm'].includes(wvm) || !PART_ID.test(p ?? '')) {
    throw badRequest('Not an OnShape part.');
  }
  if (c !== undefined && !isConfigurationText(c)) throw badRequest('Not an OnShape configuration.');
  if (mv !== undefined && !ID.test(mv)) throw badRequest('Not an OnShape version.');
  if (rgb !== undefined && !RGB.test(rgb)) throw badRequest('Not a colour.');
  return {
    origin: {
      documentId: d.toLowerCase(), wvmType: wvm, wvmId: wvmid.toLowerCase(), elementId: e.toLowerCase(), partId: p,
      configuration: c ?? null, microversionId: mv ? mv.toLowerCase() : null,
    },
    color: rgb ? [0, 2, 4].map((i) => parseInt(rgb.slice(i, i + 2), 16)) : null,
  };
}

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

  router.get('/drawing/:key', asyncHandler(async (req, res) => {
    requireKey(req.params.key);
    const image = await pictures.partDrawing(req.params.key);
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', 'private, max-age=3600');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(image);
  }));

  router.get('/cad', asyncHandler(async (req, res) => {
    const { origin, color } = cadOrigin(req.query);
    const image = await pictures.cadPicture(origin, color);
    res.set('Content-Type', 'image/png');
    // A Part Studio version never changes, and the link names it.
    res.set('Cache-Control', origin.microversionId || origin.wvmType === 'v' ? 'private, max-age=86400' : 'private, max-age=60');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(image);
  }));

  router.get('/hardware', (req, res) => {
    const spec = hardwareFromQuery(req.query);
    if (!spec) throw badRequest('Not a piece of hardware the tool can draw.');
    const large = req.query.size === 'large';
    const key = `${JSON.stringify(spec)}:${large ? 'L' : ''}`;
    let image = HARDWARE_CACHE.get(key);
    if (!image) {
      image = hardwarePicture(spec, large ? { width: 1200, height: 900 } : { width: 400, height: 300 });
      HARDWARE_CACHE.set(key, image);
      if (HARDWARE_CACHE.size > MAX_HARDWARE) HARDWARE_CACHE.delete(HARDWARE_CACHE.keys().next().value);
    }
    res.set('Content-Type', 'image/png');
    // Drawn from the address alone: the same address is always the same picture.
    res.set('Cache-Control', 'private, max-age=604800, immutable');
    res.set('X-Content-Type-Options', 'nosniff');
    res.send(image);
  });

  router.get('/build/:key', asyncHandler(async (req, res) => {
    requireKey(req.params.key);
    const { image, live } = await pictures.buildImage(req.params.key, { fresh: req.query.fresh === '1' });
    res.set('Content-Type', 'image/png');
    res.set('Cache-Control', live ? 'no-cache' : 'private, max-age=3600');
    res.send(image);
  }));

  return router;
}
