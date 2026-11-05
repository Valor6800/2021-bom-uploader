/**
 * BOM Service — orchestrates BOM retrieval from Onshape and cross-references
 * with Jira stories.
 */

import {
  MATERIAL_MACHINERY_MAP, Material, Machinery, Powdercoat, Tapping, Thickness,
} from '../utils/bomConstants.js';
import { applyPartMask } from '../utils/partMask.js';
import { baseNumber, isCurrentRevision } from '../utils/partChain.js';
import { stripBrackets } from '../utils/cleanName.js';
import { OnshapeProperty } from '../utils/onshapeProperties.js';
import { cleanConfiguration } from '../utils/onshapeConfiguration.js';
import { powdercoatFromAppearance } from '../utils/appearance.js';
import { skuOf } from '../utils/vendorSku.js';

const REQUIRED_COLUMNS = ['quantity', 'partNumber', 'material', 'name'];

const ALUMINIUM = new Set([Material.AL_6061, Material.AL_7075]);

/**
 * OnShape's built-in BOM columns, matched by header propertyId first and by
 * header display name as the fallback (same ids as epicService). Item values
 * are keyed by the matched header's propertyName; `key` is the default when
 * the BOM has no such header.
 */
const BOM_PROPERTY = Object.freeze({
  NAME: { id: OnshapeProperty.NAME, name: 'Name', key: 'name' },
  PART_NUMBER: { id: OnshapeProperty.PART_NUMBER, name: 'Part number', key: 'partNumber' },
  REVISION: { id: OnshapeProperty.REVISION, name: 'Revision', key: 'revision' },
  PROJECT: { id: OnshapeProperty.PROJECT, name: 'Project', key: 'project' },
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

/**
 * Where a BOM row's part lives in OnShape, when the tool may write to it: a
 * part of the Assembly's own document, in a workspace (not a version).
 * Null for anything else (a vendor part, a part from another document).
 */
function cadOf(item, context) {
  const source = item?.itemSource;
  if (!source?.partId || source.wvmType !== 'w'
    || !context.documentId || source.documentId !== context.documentId) return null;
  return {
    documentId: source.documentId,
    workspaceId: source.wvmId,
    elementId: source.elementId,
    partId: source.partId,
    configuration: source.configuration || null,
  };
}

/**
 * Where a BOM row's part lives and which version of its Part Studio the BOM
 * saw, for reading it back (a version, another document: anything).
 */
function originOf(item) {
  const source = item?.itemSource;
  if (!source?.partId) return null;
  return {
    documentId: source.documentId,
    wvmType: source.wvmType,
    wvmId: source.wvmId,
    elementId: source.elementId,
    partId: source.partId,
    configuration: source.configuration || null,
    microversionId: source.sourceElementMicroversionId ?? null,
  };
}

/** One OnShape part, as one string: the same part in two rows is one Part. */
function cadRefOf(cad) {
  return [cad.documentId, cad.elementId, cad.partId, cad.configuration ?? ''].join(':');
}

function readValue(item, key) {
  const value = item?.[key];
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number') return String(value);
  return '';
}

/**
 * A top-level BOM row that is a sub-assembly, not a Part. OnShape lists a
 * sub-assembly with its own rows nested under it ("1" with "1.1", "1.2"),
 * and its source is an assembly element, which has no `partId` (a Part has
 * one). Either signal is enough. A row with no `itemSource` at all (legacy or
 * hand-made BOM shapes) is never treated as one.
 *
 * Not yet confirmed against a live BOM that contains a sub-assembly.
 */
function isSubAssemblyRow(item, items) {
  const source = item?.itemSource;
  if (!source || typeof source !== 'object') return false;
  const path = String(item.item ?? '');
  const hasChildren = path !== '' && items.some((other) => String(other.item ?? '').startsWith(`${path}.`));
  return !!source.elementId && (hasChildren || !source.partId);
}

/**
 * A row whose part lives in another OnShape document: a vendor or
 * off-the-shelf part. The tool makes no Part for it.
 */
function isExternalRow(item, context) {
  const documentId = item?.itemSource?.documentId;
  return !!documentId && !!context.documentId && documentId !== context.documentId;
}

/** What a sub-assembly row tells us before its own metadata is read. */
function describeSubAssembly(item, keys) {
  const source = item.itemSource;
  return {
    item: item.item ?? null,
    name: stripBrackets(readValue(item, keys.name)),
    partNumber: readValue(item, keys.partNumber),
    revision: readValue(item, keys.revision),
    project: readValue(item, keys.project),
    documentId: source.documentId ?? null,
    elementId: source.elementId,
    wvmType: source.wvmType ?? null,
    wvmId: source.wvmId ?? null,
    // The configuration the parent uses this sub-assembly in.
    configuration: cleanConfiguration(source.configuration),
  };
}

// In-memory cache for Onshape BOM responses to minimize API calls. Both
// caches hold the in-flight *promise*, set synchronously before the request
// goes out, so two callers asking for the same BOM at once (e.g. the Assembly
// page's sub-assemblies and off-the-shelf sections, both mounting at once)
// share one OnShape request instead of each firing their own.
// Key: "docId:wsId:elemId:config", Value: { promise, at }
const BOM_CACHE = new Map();
const CACHE_TTL_MS = 60 * 1000; // 1 minute
// A cut version never changes, so its BOM is kept for as long as the server runs.
// Key: "v:docId:versionId:elemId:config", Value: promise
const VERSION_CACHE = new Map();

/** Forget every cached BOM: call after writing to OnShape, so the next read sees it. */
export function clearBomCache() {
  BOM_CACHE.clear();
}

export class BOMService {
  /**
   * @param {object} deps
   * @param {import('../clients/onshapeClient.js').OnshapeClient} deps.onshapeClient
   */
  constructor({ onshapeClient }) {
    this.onshapeClient = onshapeClient;
  }

  /**
   * The raw workspace BOM, shared by every caller asking for the same one at
   * once and kept for CACHE_TTL_MS. Not async: the cache check-and-set must
   * happen with no `await` in between, or two concurrent callers would both
   * see a miss.
   */
  _workspaceBOM(cacheKey, documentId, workspaceId, elementId, configuration) {
    const hit = BOM_CACHE.get(cacheKey);
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) return hit.promise;
    const promise = this.onshapeClient.getAssemblyBOM(
      documentId, workspaceId, elementId, { multiLevel: true, ...(configuration ? { configuration } : {}) },
    );
    BOM_CACHE.set(cacheKey, { promise, at: Date.now() });
    promise.catch(() => BOM_CACHE.delete(cacheKey));
    return promise;
  }

  /**
   * Read a workspace BOM afresh into the cache, for a reader about to need
   * it (`getBOMReport` without `fresh` then shares this read).
   * @returns {Promise<object>}
   */
  prefetch(documentId, workspaceId, elementId, configuration = null) {
    const cacheKey = `${documentId}:${workspaceId}:${elementId}:${configuration ?? ''}`;
    BOM_CACHE.delete(cacheKey);
    return this._workspaceBOM(cacheKey, documentId, workspaceId, elementId, configuration);
  }

  /** The raw BOM at a version: fetched once per version, ever, shared the same way. */
  _versionBOM(cacheKey, documentId, versionId, elementId, configuration) {
    const hit = VERSION_CACHE.get(cacheKey);
    if (hit) return hit;
    const promise = this.onshapeClient.getAssemblyBOMAtVersion(
      documentId, versionId, elementId, ...(configuration ? [{ configuration }] : []),
    );
    VERSION_CACHE.set(cacheKey, promise);
    promise.catch(() => VERSION_CACHE.delete(cacheKey));
    return promise;
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
   * @param {{ fresh?: boolean }} [options]  `fresh` skips the cache read
   *   (the fetched BOM is still cached).
   * @returns {Promise<{ parts: object[], unidentified: object[], subAssemblies: object[] }>}
   */
  async getBOMReport(epicKey, documentId, workspaceId, elementId, assembly, { fresh = false } = {}) {
    // The Assembly's OnShape configuration (if it follows one) says which BOM to read.
    const configuration = assembly?.configuration ?? null;
    const cacheKey = `${documentId}:${workspaceId}:${elementId}:${configuration ?? ''}`;
    if (fresh) BOM_CACHE.delete(cacheKey);
    const raw = await this._workspaceBOM(cacheKey, documentId, workspaceId, elementId, configuration);
    return this._parseBOM(raw, epicKey, assembly, { documentId });
  }

  /**
   * The BOM of an assembly as of a cut version, parsed like the live one.
   * A version never changes, so each answer is kept for good.
   *
   * @returns {Promise<{ parts: object[] }>}
   */
  async getVersionReport(documentId, versionId, elementId, assembly) {
    const configuration = assembly?.configuration ?? null;
    const cacheKey = `v:${documentId}:${versionId}:${elementId}:${configuration ?? ''}`;
    const raw = await this._versionBOM(cacheKey, documentId, versionId, elementId, configuration);
    return this._parseBOM(raw, null, assembly, { documentId });
  }

  /**
   * The raw OnShape BOM table (every level), through the same caches as the
   * parsed reads: a workspace's for a minute, a version's for good.
   *
   * @param {{ documentId: string, wvmType: 'w'|'v', wvmId: string, elementId: string, configuration?: string|null }} where
   * @returns {Promise<object>}  OnShape's `bomTable`
   */
  async getRawBOM({ documentId, wvmType, wvmId, elementId, configuration = null }) {
    if (wvmType === 'v') {
      const cacheKey = `v:${documentId}:${wvmId}:${elementId}:${configuration ?? ''}`;
      const raw = await this._versionBOM(cacheKey, documentId, wvmId, elementId, configuration);
      return raw?.bomTable ?? null;
    }
    const cacheKey = `${documentId}:${wvmId}:${elementId}:${configuration ?? ''}`;
    const raw = await this._workspaceBOM(cacheKey, documentId, wvmId, elementId, configuration);
    return raw?.bomTable ?? null;
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
    // The tool owns Revisions, so CAD's letter plays no part: a row matches the
    // current Revision of its number. A spare repeats its original's number;
    // CAD matches the original.
    const storyMap = new Map();
    for (const story of existingStories) {
      const number = baseNumber(story);
      if (number && isCurrentRevision(story, storyMap.get(number))) storyMap.set(number, story);
    }

    const matched = [];
    const unmatched = [];

    for (const item of bomItems) {
      const number = baseNumber(item);
      const story = number ? storyMap.get(number) : undefined;
      if (!story) {
        unmatched.push(item);
        continue;
      }

      // CAD owns quantity and material; machinery, powdercoat, tapping and thickness
      // are the student's once a Part exists, so CAD never reports them.
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
   * 4. No Part number at all, on a part of the Assembly's own document that
   *    the tool can write to: the tool will number it (`unnumbered`).
   *
   * The Revision column is not needed: the tool owns Revisions, and a part
   * that has none is Revision A.
   *
   * @returns {{ parsed: object, name: string } | { unnumbered: object, name: string } | { problems: string[] }}
   * @private
   */
  _identifyRow(item, keys, assemblyPrefix, context = {}) {
    const partNumber = readValue(item, keys.partNumber);
    const revision = readValue(item, keys.revision).toUpperCase();
    const project = readValue(item, keys.project).toUpperCase();
    // The legacy path below reads a full number out of the raw name, so only
    // the name that is kept drops its [bracketed] tags.
    const rawName = readValue(item, keys.name);
    const name = stripBrackets(rawName);

    if (PART_NUMBER_PATTERN.test(partNumber)) {
      const problems = [];
      const prefix = project ? project : assemblyPrefix;
      if (project && !PROJECT_PATTERN.test(project)) {
        problems.push(`invalid Project "${project}" (expected V, R or F, then a 2-digit year, e.g. VF27)`);
      } else if (!prefix) {
        problems.push('missing Project (the part has none and the Assembly has no season prefix)');
      }
      if (revision && !REVISION_PATTERN.test(revision)) {
        problems.push(`invalid Revision "${revision}" (expected a single letter, e.g. A)`);
      }
      if (problems.length === 0) {
        const parsed = applyPartMask(`${prefix}P-${partNumber}${revision || 'A'} ${name}`);
        if (parsed) return { parsed, name };
      }
      return { problems };
    }

    const fromPartNumber = applyPartMask(partNumber);
    if (fromPartNumber) return { parsed: fromPartNumber, name };

    const fromName = applyPartMask(rawName);
    if (fromName) return { parsed: fromName, name: stripBrackets(fromName.name) };

    if (!partNumber) {
      if (cadOf(item, context)) {
        const problems = [];
        const prefix = project ? project : assemblyPrefix;
        if (project && !PROJECT_PATTERN.test(project)) {
          problems.push(`invalid Project "${project}" (expected V, R or F, then a 2-digit year, e.g. VF27)`);
        } else if (!prefix) {
          problems.push('missing Project (the part has none and the Assembly has no season prefix)');
        }
        if (problems.length) return { problems };
        return {
          unnumbered: { prefix, setProject: !project },
          name,
        };
      }
      return {
        problems: [item.itemSource?.partId
          ? "missing Part number (this part is pinned to a version, so the tool can't number it)"
          : 'missing Part number'],
      };
    }
    return { problems: [`invalid Part number "${partNumber}" (expected 4 digits, e.g. 0001)`] };
  }

  /**
   * Parse raw Onshape BOM table into structured ParsedBOMItem objects.
   *
   * @param {object} results       Raw OnShape BOM response
   * @param {string} epicKey
   * @param {{ seasonType?: string, year?: string }} [assembly]
   * @returns {{ parts: object[], unidentified: object[], subAssemblies: object[] }}
   * @private
   */
  _parseBOM(results, epicKey, assembly = {}, context = {}) {
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
    const subAssemblies = [];
    const seenSubAssemblies = new Set();
    const external = new Map();

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

    // Parent path ('' = top level) -> its direct children, for walking into
    // unnumbered sub-assemblies below. An unnumbered sub-assembly has no
    // Build or kit sheet of its own, so its off-the-shelf rows are this
    // Assembly's to show (same rule the build guide uses for its steps).
    const childrenByParent = new Map();
    for (const it of items) {
      const path = String(it.item ?? '');
      if (!path) continue;
      const cut = path.lastIndexOf('.');
      const parent = cut < 0 ? '' : path.slice(0, cut);
      if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
      childrenByParent.get(parent).push(it);
    }

    const addExternal = (item, multiplier) => {
      const source = item.itemSource;
      const id = [source.documentId, source.elementId, source.partId ?? '', source.configuration ?? ''].join(':');
      const found = external.get(id);
      const quantity = (item.quantity ?? 0) * multiplier;
      if (found) {
        found.quantity += quantity;
      } else {
        const sku = skuOf({
          partNumber: readValue(item, keys.partNumber), name: readValue(item, keys.name), description: readValue(item, 'description'),
        });
        external.set(id, {
          name: readValue(item, keys.name),
          partNumber: readValue(item, keys.partNumber),
          quantity,
          sku: sku?.sku ?? null,
          vendor: readValue(item, 'vendor') || sku?.vendor || null,
          // OnShape's standard content: screws, nuts, washers (kitting hardware).
          standard: source.isStandardContent === true,
        });
      }
    };

    // Made Parts and unidentified rows nested here are a separate, known gap
    // (HANDOFF.md "Known gaps"): they get no Part ticket. Only off-the-shelf
    // rows are collected at this depth.
    const collectNestedExternal = (path, multiplier) => {
      for (const item of childrenByParent.get(path) ?? []) {
        if (item.excludeFromBom === true) continue;
        if (isSubAssemblyRow(item, items)) {
          const ownDoc = item.itemSource?.documentId === context.documentId;
          const numbered = PART_NUMBER_PATTERN.test(readValue(item, keys.partNumber));
          // A numbered sub-assembly is its own Assembly, with its own Build
          // and kit sheet; a sub-assembly from another document is a
          // vendor kit. Neither is opened up further here.
          if (ownDoc && !numbered) collectNestedExternal(String(item.item ?? ''), multiplier * (item.quantity ?? 1));
          continue;
        }
        if (isExternalRow(item, context)) addExternal(item, multiplier);
      }
    };

    for (const item of items) {
      // Skip nested sub-assembly items (item path contains ".")
      if (item.item && String(item.item).lastIndexOf('.') >= 0) continue;
      // Skip rows OnShape marks "Exclude from all BOMs" (a boolean in the response)
      if (item.excludeFromBom === true) continue;

      // A sub-assembly is an Assembly of its own, never a Part.
      if (isSubAssemblyRow(item, items)) {
        const sub = describeSubAssembly(item, keys);
        const id = `${sub.documentId}:${sub.elementId}`;
        if (!seenSubAssemblies.has(id)) {
          seenSubAssemblies.add(id);
          subAssemblies.push(sub);
        }
        const ownDoc = sub.documentId === context.documentId;
        if (ownDoc && !PART_NUMBER_PATTERN.test(sub.partNumber)) {
          collectNestedExternal(String(item.item ?? ''), item.quantity ?? 1);
        }
        continue;
      }

      // A part from another document is bought, not made: listed for the Assembly page only.
      if (isExternalRow(item, context)) {
        addExternal(item, 1);
        continue;
      }

      const identified = this._identifyRow(item, keys, assemblyPrefix, context);
      if (!identified.parsed && !identified.unnumbered) {
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
      const { name } = identified;
      const parsed = identified.parsed ?? {
        summary: null,
        name,
        version: 'A',
        seasonType: identified.unnumbered.prefix[1],
        year: identified.unnumbered.prefix.slice(2),
        partNumber: null,
        fullPartNumber: null,
        isEpic: false,
      };

      const part = {
        ...parsed,
        cad: cadOf(item, context),
        origin: originOf(item),
        ...(identified.unnumbered
          ? {
            numbering: { prefix: identified.unnumbered.prefix, setProject: identified.unnumbered.setProject },
            cadRef: cadRefOf(cadOf(item, context)),
          }
          : {}),
        cadRevision: readValue(item, keys.revision).toUpperCase(),
        quantity: item.quantity,
        name,
        material: Material.NONE,
        thickness: Thickness.NONE,
        machinery: Machinery.NONE,
        powdercoat: Powdercoat.NONE,
        // OnShape doesn't say whether a part is tapped; the student picks it.
        tapping: Tapping.NO,
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

      // Powdercoat follows the part's colour, on aluminium only (a black 3D
      // print is not powdercoated). It only seeds a new Part: once a Part
      // exists the student's choice stands.
      if (ALUMINIUM.has(part.material)) part.powdercoat = powdercoatFromAppearance(item.appearance);
      // Its colour in OnShape, for its picture.
      const rgb = item.appearance?.color;
      part.color = rgb && [rgb.red, rgb.green, rgb.blue].every(Number.isFinite) ? [rgb.red, rgb.green, rgb.blue] : null;

      // What a new Part needs before the tool will make it.
      part.missing = [];
      if (!part.name) part.missing.push('Name');
      if (part.material === Material.NONE) part.missing.push('Material');

      // Aggregate quantities for one Part, whatever Revision letter CAD shows.
      const identity = baseNumber(part) ?? part.cadRef;
      if (bom[identity]) {
        bom[identity].quantity += part.quantity;
      } else {
        bom[identity] = part;
      }
    }

    return { parts: Object.values(bom), unidentified, subAssemblies, external: [...external.values()] };
  }
}
