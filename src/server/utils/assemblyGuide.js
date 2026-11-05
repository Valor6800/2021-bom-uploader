/**
 * Assembly guide — build steps and kits from an OnShape BOM tree. Pure.
 *
 * The multi-level BOM lists every row with its path ("2", "2.4", "2.4.3")
 * and a quantity per one of its parent. From that:
 *
 * - **Steps**: one per sub-assembly built inside this Assembly (a sub-assembly
 *   of the Assembly's own document with no Part number of its own, e.g.
 *   "Bumper Corner Gusset"), deepest first, then the Assembly itself last.
 *   A sub-assembly that has its own number (1200 Bumper) is an Assembly of
 *   its own: it is listed as something to bring to the step, not opened up.
 *   The same sub-assembly used in several places is one step, built as many
 *   times as it is used in total.
 * - **Kits**: per step, the standard hardware (OnShape's standard content:
 *   screws, nuts) and vendor parts (parts from other documents) one unit
 *   needs, and the total for every unit the step builds. The kit sheet is
 *   one bin per step.
 *
 * Rows marked "Exclude from all BOMs" are left out.
 */

import { stripBrackets } from './cleanName.js';
import { skuOf } from './vendorSku.js';
import { hardwareOf } from './hardwareSpec.js';
import { cleanConfiguration } from './onshapeConfiguration.js';

const PART_NUMBER_RE = /^\d{4}$/;

export const LineKind = Object.freeze({
  MADE: 'made',           // a Part the team makes (own document)
  HARDWARE: 'hardware',   // OnShape standard content
  VENDOR: 'vendor',       // a part or assembly from another document
  ASSEMBLY: 'assembly',   // a numbered sub-assembly: an Assembly of its own
  STEP: 'step',           // a sub-assembly built in an earlier step
});

const text = (v) => {
  if (typeof v === 'string') return v.trim();
  if (typeof v === 'number') return String(v);
  if (v && typeof v === 'object') return String(v.displayName ?? v.value ?? '').trim();
  return '';
};

/** The BOM's value for one header property, whichever key the BOM uses. */
function makeReader(headers) {
  const keyOf = (propertyName, displayName) => headers.find((h) => h.propertyName === propertyName)?.propertyName
    ?? headers.find((h) => h.name === displayName)?.propertyName
    ?? propertyName;
  const keys = {
    name: keyOf('name', 'Name'),
    partNumber: keyOf('partNumber', 'Part number'),
    revision: keyOf('revision', 'Revision'),
    description: keyOf('description', 'Description'),
    vendor: keyOf('vendor', 'Vendor'),
  };
  const mass = headers.find((h) => h.name === 'Mass')?.propertyName ?? null;
  return (item, field) => (field === 'mass' ? (mass ? text(item[mass]) : '') : text(item[keys[field]]));
}

/** A row's identity: the same part in two rows is one line. */
function identityOf(item) {
  const s = item.itemSource ?? {};
  return [s.documentId ?? '', s.elementId ?? '', s.partId ?? '', cleanConfiguration(s.configuration) ?? ''].join(':');
}

/** Where to draw a row from (OnShape): an assembly tab or a part. */
function originOf(item) {
  const s = item.itemSource;
  if (!s?.documentId || !s.elementId || !s.wvmType || !s.wvmId) return null;
  return {
    documentId: s.documentId,
    wvmType: s.wvmType,
    wvmId: s.wvmId,
    elementId: s.elementId,
    ...(s.partId ? { partId: s.partId } : {}),
    configuration: cleanConfiguration(s.configuration),
    // For a part drawn from its shape: the Part Studio version (to keep the read) and its colour.
    microversionId: s.sourceElementMicroversionId ?? null,
    color: colorOf(item.appearance),
  };
}

/** A BOM row's colour as [r, g, b], or null. */
function colorOf(appearance) {
  const c = appearance?.color;
  return c && [c.red, c.green, c.blue].every(Number.isFinite) ? [c.red, c.green, c.blue] : null;
}

/**
 * @param {object} bomTable  OnShape's `bomTable` (`headers`, `items`), multi-level
 * @param {object} context
 * @param {string} context.documentId  The Assembly's own document
 * @param {string} context.name        The Assembly's name, for the last step
 * @returns {{ steps: object[], kit: object[], origins: Map<string, object> }}
 *   `origins`: image id -> where to draw it, for the server only.
 */
export function buildGuide(bomTable, { documentId, name }) {
  const headers = bomTable?.headers ?? [];
  const read = makeReader(headers);
  const items = (bomTable?.items ?? []).filter((i) => i.excludeFromBom !== true && i.item != null);

  const children = new Map(); // parent path ('' = root) -> items
  for (const item of items) {
    const path = String(item.item);
    const cut = path.lastIndexOf('.');
    const parent = cut < 0 ? '' : path.slice(0, cut);
    if (!children.has(parent)) children.set(parent, []);
    children.get(parent).push(item);
  }
  const hasChildren = (path) => children.has(path);

  const origins = new Map();
  const remember = (id, item) => {
    if (!origins.has(id)) {
      const origin = originOf(item);
      if (origin) origins.set(id, origin);
    }
  };

  /** What a row is to the guide. */
  function kindOf(item) {
    const s = item.itemSource ?? {};
    const own = !!documentId && s.documentId === documentId;
    const isAssembly = !!s.elementId && (hasChildren(String(item.item)) || !s.partId);
    if (isAssembly) {
      if (!own) return LineKind.VENDOR;
      return PART_NUMBER_RE.test(read(item, 'partNumber')) ? LineKind.ASSEMBLY : LineKind.STEP;
    }
    if (s.isStandardContent) return LineKind.HARDWARE;
    if (s.documentId && !own) return LineKind.VENDOR;
    return LineKind.MADE;
  }

  /** stepKey -> step, in the order first finished (deepest first). */
  const steps = new Map();

  /**
   * Visit a sub-assembly (or the root) built `count` times; returns its step id.
   * Its contents are read from its first occurrence.
   */
  function visit(path, stepKey, label, count, item) {
    const existing = steps.get(stepKey);
    if (existing) {
      existing.count += count;
      // Nested steps inside it are built this many more times as well.
      for (const line of existing.lines) {
        if (line.kind === LineKind.STEP) bump(line.stepKey, line.perUnit * count);
      }
      return existing.id;
    }

    const id = path === '' ? 'root' : path;
    const step = {
      id, stepKey, name: label, count, lines: [], hasImage: path !== '' && !!item && !!originOf(item),
    };
    if (item) remember(id, item);

    const merged = new Map();
    for (const child of children.get(path) ?? []) {
      const kind = kindOf(child);
      const childPath = String(child.item);
      const perUnit = Number(child.quantity) || 0;
      const nameText = stripBrackets(read(child, 'name')) || read(child, 'name') || 'Unnamed';

      let line;
      if (kind === LineKind.STEP) {
        const childKey = `step:${identityOf(child)}`;
        visit(childPath, childKey, nameText, perUnit * count, child);
        const stepId = steps.get(childKey).id;
        // The same picture as that step's own.
        line = { kind, stepKey: childKey, stepId, name: nameText, imageId: origins.has(stepId) ? stepId : null };
      } else {
        const sku = kind === LineKind.VENDOR || kind === LineKind.HARDWARE
          ? skuOf({ partNumber: read(child, 'partNumber'), name: read(child, 'name'), description: read(child, 'description') })
          : null;
        remember(childPath, child);
        // Hardware (standard content, or a bought screw, spacer or bearing) the tool can draw itself.
        if (kind === LineKind.VENDOR || kind === LineKind.HARDWARE) {
          const hardware = hardwareOf({
            name: read(child, 'name'), description: read(child, 'description'), configuration: child.itemSource?.configuration,
          });
          if (hardware) origins.set(childPath, { ...(origins.get(childPath) ?? {}), hardware });
        }
        const drawable = !!origins.get(childPath)?.hardware;
        line = {
          kind,
          name: nameText,
          number: kind === LineKind.MADE || kind === LineKind.ASSEMBLY
            ? (PART_NUMBER_RE.test(read(child, 'partNumber')) ? read(child, 'partNumber') : null)
            : null,
          partNumber: read(child, 'partNumber') || null,
          description: read(child, 'description') || null,
          material: text(child.material) || null,
          vendor: read(child, 'vendor') || sku?.vendor || null,
          sku: sku?.sku ?? null,
          mass: read(child, 'mass') || null,
          imageId: origins.has(childPath) ? childPath : null,
          // The tool can draw it from its name (so its picture never depends on a Part Studio read).
          drawable,
        };
      }

      // A numbered Part is one line however many rows (instances, Part Studio bodies) OnShape gives it.
      const key = line.kind === LineKind.STEP ? line.stepKey
        : line.number ? `${line.kind}:#${line.number}`
          : `${line.kind}:${identityOf(child)}`;
      const found = merged.get(key);
      if (found) found.perUnit += perUnit;
      else merged.set(key, { ...line, perUnit });
    }

    step.lines = [...merged.values()];
    steps.set(stepKey, step);
    return id;
  }

  /** A step already built `n` more times (it is used in another place too). */
  function bump(stepKey, n) {
    const step = steps.get(stepKey);
    if (!step) return;
    step.count += n;
    for (const line of step.lines) {
      if (line.kind === LineKind.STEP) bump(line.stepKey, line.perUnit * n);
    }
  }

  visit('', 'root', name || 'Final assembly', 1, null);

  // Totals once every count is known.
  const ordered = [...steps.values()];
  ordered.forEach((step, index) => {
    step.number = index + 1;
    for (const line of step.lines) line.total = line.perUnit * step.count;
  });

  // One sub-assembly in two configurations is two steps with one name: tell them apart.
  const named = new Map();
  for (const step of ordered) named.set(step.name, (named.get(step.name) ?? 0) + 1);
  const seen = new Map();
  for (const step of ordered) {
    if (named.get(step.name) < 2) continue;
    const n = (seen.get(step.name) ?? 0) + 1;
    seen.set(step.name, n);
    step.name = `${step.name} (variant ${n})`;
  }
  const nameOf = new Map(ordered.map((s) => [s.stepKey, s.name]));
  for (const step of ordered) {
    for (const line of step.lines) if (line.kind === LineKind.STEP) line.name = nameOf.get(line.stepKey) ?? line.name;
  }

  // The whole Build's kit: hardware and vendor parts summed over every step.
  const kit = new Map();
  for (const step of ordered) {
    for (const line of step.lines) {
      if (line.kind !== LineKind.HARDWARE && line.kind !== LineKind.VENDOR) continue;
      const key = `${line.kind}:${line.sku ?? ''}:${line.name}:${line.material ?? ''}`;
      const found = kit.get(key);
      if (found) {
        found.total += line.total;
        found.steps.push(step.number);
      } else {
        kit.set(key, {
          kind: line.kind,
          name: line.name,
          sku: line.sku,
          vendor: line.vendor,
          material: line.material,
          description: line.description,
          imageId: line.imageId,
          drawable: line.drawable,
          total: line.total,
          steps: [step.number],
        });
      }
    }
  }

  const steps_ = ordered.map(({ stepKey, ...step }) => ({
    ...step,
    lines: step.lines.map(({ stepKey: _k, ...line }) => line),
  }));

  return {
    steps: steps_,
    kit: [...kit.values()].sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name)),
    origins,
  };
}
