/**
 * BOM Service — orchestrates BOM retrieval from Onshape and cross-references
 * with Jira stories.
 */

import { MATERIAL_MACHINERY_MAP, Material, Machinery, Powdercoat, Thickness } from '../utils/bomConstants.js';
import { applyPartMask } from '../utils/partMask.js';

const REQUIRED_COLUMNS = ['quantity', 'partNumber', 'material', 'name'];

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
   * Uses a 5-minute cache to avoid redundant API calls.
   */
  async getBOM(epicKey, documentId, workspaceId, elementId) {
    const cacheKey = `${documentId}:${workspaceId}:${elementId}`;
    const cached = BOM_CACHE.get(cacheKey);

    if (cached && (Date.now() - cached.timestamp) < CACHE_TTL_MS) {
      return this._parseBOM(cached.data, epicKey);
    }

    const raw = await this.onshapeClient.getAssemblyBOM(documentId, workspaceId, elementId, { multiLevel: true });
    BOM_CACHE.set(cacheKey, { data: raw, timestamp: Date.now() });
    return this._parseBOM(raw, epicKey);
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
   * Parse raw Onshape BOM table into structured ParsedBOMItem objects.
   * @private
   */
  _parseBOM(results, epicKey) {
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

    for (const item of items) {
      const parsed = applyPartMask(item.partNumber);
      if (!parsed) continue;

      // Skip nested sub-assembly items (item path contains ".")
      if (item.item && item.item.lastIndexOf('.') >= 0) continue;

      const part = {
        ...parsed,
        quantity: item.quantity,
        name: item.name,
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

    return Object.values(bom);
  }
}
