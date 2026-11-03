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
   * after every write, so this sees the numbers just written).
   * @returns {Promise<{ parts: object[], unidentified: object[], subAssemblies: object[], assemblyNumber: string|null }>}
   */
  async readBom(assemblyKey, { fresh = false } = {}) {
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
    const report = await this.bomService.getBOMReport(assemblyKey, documentId, workspaceId, elementId, season, { fresh });
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
    for (const part of parts) {
      const letter = wanted.get(baseNumber(part));
      if (!letter || !part.cad || part.cadRevision === letter) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await this.onshapeClient.updatePartMetadata({
          ...part.cad,
          properties: [{ propertyId: OnshapeProperty.REVISION, value: letter }],
        });
        written += 1;
      } catch (err) {
        refused.push(`${part.fullPartNumber} (${describeUpstreamError(err)})`);
      }
    }
    clearBomCache();
    if (refused.length) {
      throw new HttpError(502, `OnShape wouldn't change the Revision of ${refused.join('; ')}. Nothing was cut.`);
    }
    return { written };
  }
}
