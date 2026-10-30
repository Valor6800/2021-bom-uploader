/**
 * BOM Service — orchestrates BOM retrieval from Onshape and cross-references
 * with Jira stories.
 */

import { MATERIAL_MACHINERY_MAP, Material, Machinery, Powdercoat, Thickness } from '../utils/bomConstants.js';
import { applyPartMask } from '../utils/partMask.js';

const REQUIRED_COLUMNS = ['quantity', 'partNumber', 'material', 'name'];

/**
 * OnShape's built-in BOM columns, matched by header propertyId first and by
 * header display name as the fallback (same ids as epicService). Item values
 * are keyed by the matched header's propertyName; `key` is the default when
 * the BOM has no such header.
 */
const BOM_PROPERTY = Object.freeze({
  NAME: { id: '57f3fb8efa3416c06701d60d', name: 'Name', key: 'name' },
  PART_NUMBER: { id: '57f3fb8efa3416c06701d60f', name: 'Part number', key: 'partNumber' },
  REVISION: { id: '57f3fb8efa3416c06701d610', name: 'Revision', key: 'revision' },
  PROJECT: { id: '57f3fb8efa3416c06701d613', name: 'Project', key: 'project' },
});

const PROJECT_PATTERN = /^V[RF]\d{2}$/;
const PART_NUMBER_PATTERN = /^\d{4}$/;
const REVISION_PATTERN = /^[A-Z]$/;

function resolveItemKey(headers, { id, name, key }) {
  const header =
    headers.find((h) => h.propertyId === id) ??
    headers.find((h) => h.name === name);
  return header?.propertyName ?? key;
}

function readValue(item, key) {
  const value = item?.[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

// In-memory cache for Onshape BOM responses to minimize API calls.
// Key: "docId:wsId:elemId", Value: { data, timestamp }
const BOM_CACHE = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute

export class BOMService {
  /**
   * @param {object} deps
   * @param {import('../clients/onshapeClient.js').OnshapeClient} deps.onshapeClient
   */
  constructor({ onshapeClient }) {
    this.onshapeClient = onshapeClient;
  }

  /**
   * Fetch and parse an assembly BOM from Onshape.
   * Uses a 1-minute in-memory cache (CACHE_TTL_MS) to avoid redundant API calls.
   */
  async getBOM(epicKey, documentId, workspaceId, elementId, assembly) {
    const { parts } = await this.getBOMReport(epicKey, documentId, workspaceId, elementId, assembly);
    return parts;
  }

  /**
   * Like getBOM, but also returns the top-level rows that could not be
   * identified as a Part, each with the reasons why, so callers can show them
   * instead of an unexplained empty BOM.
   *
   * @param {string} epicKey
   * @param {string} documentId
   * @param {string} workspaceId
   * @param {string} elementId
   * @param {{ seasonType?: string, year?: string }} [assembly]
   *   The Assembly's season, used as the part-number prefix for rows whose
   *   own Project property is empty.
   * @returns {Promise<{ parts: object[], unidentified: object[] }>}
   */
  async getBOMReport(epicKey, documentId, workspaceId, elementId, assembly) {
    const cacheKey = `${documentId}:${workspaceId}:${elementId}`;
    const cached = BOM_CACHE.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      return this._parseBOM(cached.data, epicKey, assembly);
    }

    const raw = await this.onshapeClient.getAssemblyBOM(documentId, workspaceId, elementId, { multiLevel: true });
    BOM_CACHE.set(cacheKey, { data: raw, timestamp: Date.now() });
    return this._parseBOM(raw, epicKey, assembly);
  }

  /**
   * Compare parsed BOM items against existing Jira stories and produce
   * a change log for each item that already exists.
   *
   * @param {import('./types').ParsedBOMItem[]} bomItems
   * @param {object[]} existingStories  Jira stories (parsed)
   * @returns {{ matched: object[], unmatched: import('./types').ParsedBOMItem[] }}
   */
  compareBOMWithJira(bomItems, existingStories) {
    const storyMap = new Map();
    for (const story of existingStories) {
      if (story.fullPartNumber) {
        storyMap.set(story.fullPartNumber, story);
      }
    }

    const matched = [];
    const unmatched = [];

    for (const item of bomItems) {
      const story = storyMap.get(item.fullPartNumber);
      if (!story) {
        unmatched.push(item);
        continue;
      }

      const changes = {};
      let changeCount = 0;

      if (story.quantity !== item.quantity) {
        changes.quantity = item.quantity;
        changeCount++;
      }
      if (story.material !== item.material) {
        changes.material = item.material;
        changeCount++;
      }
      if (story.machinery !== item.machinery) {
        changes.machinery = item.machinery;
        changeCount++;
      }
      if (story.powdercoat !== item.powdercoat) {
        changes.powdercoat = item.powdercoat;
        changeCount++;
      }
      if (story.thickness !== item.thickness) {
        changes.thickness = item.thickness;
        changeCount++;
      }

      matched.push({
        bomItem: item,
        story,
        changes: { count: changeCount, ...changes },
      });
    }

    return { matched, unmatched };
  }

  // ---------------------------------------------------------------------------
  // Internal
  // ---------------------------------------------------------------------------

  /**
   * Work out a BOM row's full part number.
   *
   * 1. Part number property holds 4 digits ("0001"): build
   *    `{Project}P-{Part number}{Revision} {Name}`, where Project is the row's
   *    own Project property or, when that is empty, the Assembly's season.
   * 2. Legacy: the Part number cell already holds the full number
   *    ("VR26P-0001A").
   * 3. Legacy: the Name already holds the full number ("VR26P-0001A Plate").
   *
   * @returns {{ parsed: object, name: string } | { problems: string[] }}
   * @private
   */
  _identifyRow(item, keys, assemblyPrefix) {
    const partNumber = readValue(item, keys.partNumber);
    const revision = readValue(item, keys.revision).toUpperCase();
    const project = readValue(item, keys.project).toUpperCase();
    const name = readValue(item, keys.name);

    if (PART_NUMBER_PATTERN.test(partNumber)) {
      const problems = [];
      const prefix = project ? project : assemblyPrefix;
      if (project && !PROJECT_PATTERN.test(project)) {
        problems.push(`invalid Project "${project}" (expected V, R or F, then a 2-digit year, e.g. VF27)`);
      } else if (!prefix) {
        problems.push('missing Project (the part has none and the Assembly has no season prefix)');
      }
      if (!revision) problems.push('missing Revision');
      else if (!REVISION_PATTERN.test(revision)) {
        problems.push(`invalid Revision "${revision}" (expected a single letter, e.g. A)`);
      }
      if (problems.length === 0) {
        const parsed = applyPartMask(`${prefix}P-${partNumber}${revision} ${name}`);
        if (parsed) return { parsed, name };
      }
      return { problems };
    }

    const fromPartNumber = applyPartMask(partNumber);
    if (fromPartNumber) return { parsed: fromPartNumber, name };

    const fromName = applyPartMask(name);
    if (fromName) return { parsed: fromName, name: fromName.name };

    return {
      problems: [partNumber
        ? `invalid Part number "${partNumber}" (expected 4 digits, e.g. 0001)`
        : 'missing Part number'],
    };
  }

  /**
   * Parse raw Onshape BOM table into structured ParsedBOMItem objects.
   *
   * @param {object} results       Raw OnShape BOM response
   * @param {string} epicKey
   * @param {{ seasonType?: string, year?: string }} [assembly]
   * @returns {{ parts: object[], unidentified: object[] }}
   * @private
   */
  _parseBOM(results, epicKey, assembly = {}) {
    const headers = results?.bomTable?.headers ?? [];

    const missing = REQUIRED_COLUMNS.filter(
      (col) => !headers.some((h) => h.propertyName === col),
    );
    if (missing.length > 0) {
      throw new Error(
        `BOM table is missing required columns: ${missing.join(', ')}. ` +
        'Verify the following items are in your BOM: quantity, part number, material, name',
      );
    }

    const items = results.bomTable.items ?? [];
    const bom = {};
    const unidentified = [];

    const keys = {
      name: resolveItemKey(headers, BOM_PROPERTY.NAME),
      partNumber: resolveItemKey(headers, BOM_PROPERTY.PART_NUMBER),
      revision: resolveItemKey(headers, BOM_PROPERTY.REVISION),
      project: resolveItemKey(headers, BOM_PROPERTY.PROJECT),
    };
    const assemblyPrefix =
      /^[RF]$/.test(assembly?.seasonType ?? '') && /^\d{2}$/.test(assembly?.year ?? '')
        ? `V${assembly.seasonType}${assembly.year}`
        : null;

    for (const item of items) {
      // Skip nested sub-assembly items (item path contains ".")
      if (item.item && String(item.item).lastIndexOf('.') >= 0) continue;

      const identified = this._identifyRow(item, keys, assemblyPrefix);
      if (!identified.parsed) {
        unidentified.push({
          item: item.item ?? null,
          name: readValue(item, keys.name),
          partNumber: readValue(item, keys.partNumber),
          revision: readValue(item, keys.revision),
          project: readValue(item, keys.project),
          quantity: item.quantity,
          problems: identified.problems,
        });
        continue;
      }
      const { parsed, name } = identified;

      const part = {
        ...parsed,
        quantity: item.quantity,
        name,
        material: Material.NONE,
        thickness: Thickness.NONE,
        machinery: Machinery.NONE,
        powdercoat: Powdercoat.NONE,
        epic: epicKey,
      };

      // Auto-map material → machinery using centralized map
      const rawMaterial = item.material?.displayName ?? '';
      if (rawMaterial) {
        let mapped = false;
        const lowerMaterial = rawMaterial.toLowerCase();
        for (const [substring, mapping] of Object.entries(MATERIAL_MACHINERY_MAP)) {
          if (lowerMaterial.includes(substring)) {
            part.material = mapping.material;
            part.machinery = mapping.machinery;
            mapped = true;
            break;
          }
        }
        if (!mapped) {
          part.material = rawMaterial;
          part.machinery = Machinery.NONE;
        }
      }

      // Aggregate quantities for duplicate part numbers
      if (bom[part.fullPartNumber]) {
        bom[part.fullPartNumber].quantity += part.quantity;
      } else {
        bom[part.fullPartNumber] = part;
      }
    }

    return { parts: Object.values(bom), unidentified };
  }
}
