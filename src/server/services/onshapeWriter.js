/**
 * OnShape Writer — the tool owns Part numbers and Revisions, so it writes
 * them back into OnShape: a number and Revision A when it numbers a part,
 * and the new letters when a Build is cut.
 *
 * Every write goes to a part found in the Assembly's own BOM, read here. The
 * client says which part (`cadRef`), never where it lives.
 */

import { badRequest, HttpError } from '../middleware/httpError.js';
import { applyTitleMask, applyPartMask } from '../utils/partMask.js';
import { baseNumber } from '../utils/partChain.js';
import { OnshapeProperty } from '../utils/onshapeProperties.js';
import { describeUpstreamError } from '../utils/upstreamError.js';
import { clearBomCache } from './bomService.js';
import { configurationFrom } from '../utils/onshapeConfiguration.js';

const ASSEMBLY_FIELDS = ['summary', 'description', 'customfield_10300', 'customfield_10301', 'customfield_10302'];

const VERSION_LINK_RE = /\/documents\/([a-f0-9]{24})\/v\/([a-f0-9]{24})\/e\/([a-f0-9]{24})/i;

/**
 * The parts a batched metadata write refused, from OnShape's answer (one
 * item per part, each property with a status), by part id.
 * @returns {Map<string, string>}  part id -> why
 */
function refusedIn(answer) {
  const out = new Map();
  const items = Array.isArray(answer?.items) ? answer.items : [answer];
  for (const item of items) {
    const partId = /\/p\/([^/?]+)/.exec(item?.href ?? '')?.[1];
    const bad = (item?.properties ?? []).find((p) => p.status && !['OK', 'NOTHING_TO_UPDATE'].includes(p.status));
    if (partId && (bad || (item?.status && !['OK', 'NOTHING_TO_UPDATE'].includes(item.status)))) {
      out.set(decodeURIComponent(partId), bad?.errorMessage || bad?.status || item.status);
    }
  }
  return out;
}

export class OnshapeWriter {
  /**
   * @param {object} deps
   * @param {import('../clients/jiraClient.js').JiraClient} deps.jiraClient
   * @param {import('../clients/onshapeClient.js').OnshapeClient} deps.onshapeClient
   * @param {import('./bomService.js').BOMService} deps.bomService
   */
  constructor({ jiraClient, onshapeClient, bomService }) {
    this.jiraClient = jiraClient;
    this.onshapeClient = onshapeClient;
    this.bomService = bomService;
  }

  /**
   * The Assembly's BOM as the tool reads it (the 60-second cache is cleared
   * after every write, so this sees the numbers just written), or as it was
   * in a cut version (`versionLink`, a `/documents/…/v/…/e/…` link).
   * @returns {Promise<{ parts: object[], unidentified: object[], subAssemblies: object[], assemblyNumber: string|null }>}
   */
  async readBom(assemblyKey, { fresh = false, versionLink = null } = {}) {
    const issue = await this.jiraClient.getIssue(assemblyKey, { fields: ASSEMBLY_FIELDS });
    const f = issue?.fields ?? {};
    const [documentId, workspaceId, elementId] = [f.customfield_10300, f.customfield_10301, f.customfield_10302];
    if (!documentId || !workspaceId || !elementId) throw badRequest('This Assembly has no OnShape link.');
    const parsed = applyPartMask(f.summary ?? '') ?? applyTitleMask(f.summary ?? '');
    const configuration = configurationFrom(f.description);
    const context = {
      ...(parsed ? { seasonType: parsed.seasonType, year: parsed.year } : {}),
      ...(configuration ? { configuration } : {}),
    };
    const season = Object.keys(context).length ? context : null;
    // A cut version's BOM, when given: its parts point at that version, which never changes.
    const version = VERSION_LINK_RE.exec(versionLink ?? '');
    const report = version
      ? await this.bomService.getVersionReport(version[1], version[2], version[3], season)
      : await this.bomService.getBOMReport(assemblyKey, documentId, workspaceId, elementId, season, { fresh });
    return { ...report, assemblyNumber: parsed?.partNumber ?? null };
  }

  /**
   * What numbering needs from the Assembly's BOM: its parts that have no
   * number yet (by `cadRef`), and the numbers already on the rest (by season
   * prefix), which a new number must work around.
   * @returns {Promise<{ byRef: Map<string, object>, takenByPrefix: Map<string, string[]>, assemblyNumber: string|null }>}
   */
  async numberingContext(assemblyKey) {
    const { parts, assemblyNumber } = await this.readBom(assemblyKey);
    const byRef = new Map();
    const takenByPrefix = new Map();
    for (const part of parts) {
      if (part.numbering) {
        byRef.set(part.cadRef, part);
      } else if (part.partNumber) {
        const prefix = `V${part.seasonType}${part.year}`;
        takenByPrefix.set(prefix, [...(takenByPrefix.get(prefix) ?? []), part.partNumber]);
      }
    }
    return { byRef, takenByPrefix, assemblyNumber };
  }

  /**
   * Write a number and Revision A onto a part that has none (and the season
   * as its Project when that is empty).
   * @param {object} part    From `numberingContext`
   * @param {string} number  Four digits
   */
  async number(part, number) {
    const properties = [
      { propertyId: OnshapeProperty.PART_NUMBER, value: number },
      { propertyId: OnshapeProperty.REVISION, value: 'A' },
    ];
    if (part.numbering.setProject) {
      properties.push({ propertyId: OnshapeProperty.PROJECT, value: part.numbering.prefix });
    }
    try {
      await this.onshapeClient.updatePartMetadata({ ...part.cad, properties });
    } finally {
      clearBomCache();
    }
  }

  /**
   * Make OnShape show the Revision the tool holds for each Part, for the
   * Parts in `wanted`. Writes only where it differs, so a retry repeats
   * nothing. A part the tool can't write to (a vendor part, another
   * document) is left alone.
   *
   * @param {string} assemblyKey
   * @param {Map<string, string>} wanted  base number ("VR27-0004") -> letter
   * @returns {Promise<{ written: number }>}
   * @throws {HttpError} 502 naming the parts OnShape refused
   */
  async setRevisions(assemblyKey, wanted) {
    if (wanted.size === 0) return { written: 0 };
    const { parts } = await this.readBom(assemblyKey, { fresh: true });
    const refused = [];
    let written = 0;
    // One write per Part Studio, for all its parts that need it.
    const byStudio = new Map();
    for (const part of parts) {
      const letter = wanted.get(baseNumber(part));
      if (!letter || !part.cad || part.cadRevision === letter) continue;
      const key = [part.cad.documentId, part.cad.workspaceId, part.cad.elementId, part.cad.configuration ?? ''].join(':');
      if (!byStudio.has(key)) byStudio.set(key, { studio: part.cad, parts: [] });
      byStudio.get(key).parts.push({ part, letter });
    }
    for (const { studio, parts: group } of byStudio.values()) {
      try {
        // eslint-disable-next-line no-await-in-loop
        const answer = await this.onshapeClient.updatePartsMetadata(studio, group.map(({ part, letter }) => ({
          partId: part.cad.partId,
          properties: [{ propertyId: OnshapeProperty.REVISION, value: letter }],
        })));
        const failed = refusedIn(answer);
        for (const { part } of group) {
          if (failed.has(part.cad.partId)) refused.push(`${part.fullPartNumber} (${failed.get(part.cad.partId)})`);
          else written += 1;
        }
      } catch (err) {
        for (const { part } of group) refused.push(`${part.fullPartNumber} (${describeUpstreamError(err)})`);
      }
    }
    clearBomCache();
    if (refused.length) {
      throw new HttpError(502, `OnShape wouldn't change the Revision of ${refused.join('; ')}. Nothing was cut.`);
    }
    return { written };
  }
}
