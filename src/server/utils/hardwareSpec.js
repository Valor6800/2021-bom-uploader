/**
 * What a BOM row's hardware is and its size, read from its name ("Socket
 * button head cap screw #10-32 x 0.75", "1/2\" Hex Bore Spacer (0.75\" OD,
 * 0.5\" L)") and, for OnShape's standard content, the dimensions its
 * configuration carries (head diameter, head height, length). Pure: the
 * guide uses it to know a row can be drawn; `hardwarePicture` draws it.
 */

const IN = 0.0254; // metres per inch

/** Number sizes (#2..#12): the screw's major diameter in inches. */
const NUMBER_SIZES = { 0: 0.06, 1: 0.073, 2: 0.086, 3: 0.099, 4: 0.112, 5: 0.125, 6: 0.138, 8: 0.164, 10: 0.19, 12: 0.216 };

/** Kinds of hardware, in the order their names are tried (the first match wins). */
const KINDS = [
  ['pulley', /\bpulleys?\b/],
  ['sprocket', /\bsprockets?\b/],
  ['gear', /\bgears?\b(?!box)/],
  ['locknut', /\b(lock ?nut|nylock|nyloc|nylon[- ]insert)/],
  ['nut', /\bnuts?\b(?!\s*strip)|\bhex nut/],
  ['washer', /\bwashers?\b/],
  ['bearing', /\bbearings?\b/],
  ['standoff', /\bstandoffs?\b/],
  ['spacer', /\bspacers?\b|\bbushings?\b/],
  ['collar', /\bcollars?\b/],
  ['tube', /\btub(e|ing)\b/],
  ['shaft', /\b(hex|round|keyed|d)?\s*shaft\b(?!\s*(end|collar))|\bhex stock\b/],
  ['rivet', /\brivets?\b/],
  ['pin', /\bdowel\b|\bpins?\b(?!ion)/],
  ['set', /\bset ?screws?\b/],
  ['shoulder', /\bshoulder\b/],
  ['button', /\bbutton\b|\bbhcs\b/],
  ['flat', /\bflat ?head\b|\bcountersunk\b|\bfhcs\b/],
  ['pan', /\bpan ?head\b|\bphcs\b|\bshaft end screws?\b/],
  ['hexbolt', /\bhex (head )?(bolt|cap screw|screw)s?\b|\bhex bolts?\b|\bhhcs\b/],
  ['socket', /\bsocket head\b|\bcap screws?\b|\bshcs\b|\bscrews?\b|\bbolts?\b/],
];

/** Finishes a part is drawn in, by name: the drawing's colours. */
export const FINISHES = Object.freeze({
  steel: [168, 174, 184],
  black: [92, 95, 102],
  aluminum: [196, 200, 207],
  brass: [196, 168, 92],
  plastic: [214, 196, 160],
});
export const KIND_NAMES = Object.freeze(['pulley', 'sprocket', 'gear', 'locknut', 'nut', 'washer', 'bearing', 'standoff', 'spacer',
  'collar', 'tube', 'shaft', 'rivet', 'pin', 'set', 'shoulder', 'button', 'flat', 'pan', 'hexbolt', 'socket']);
/** Kinds drawn as a toothed wheel. */
export const TOOTHED = Object.freeze(['pulley', 'sprocket', 'gear']);

/** "1/2", "0.75", ".313", "1-1/4" as a number. */
function number(text) {
  const t = String(text ?? '').trim();
  let m = /^(\d+)-(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[1]) + Number(m[2]) / Number(m[3]);
  m = /^(\d+)\/(\d+)$/.exec(t);
  if (m) return Number(m[1]) / Number(m[2]);
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}
const NUM = String.raw`(\d+-\d+\/\d+|\d+\/\d+|\d*\.\d+|\d+)`;

/**
 * Dimensions in a standard-content configuration ("HeadDiameter=0.009+meter;…",
 * often base64 of that, URL-encoded), in inches. Empty when it has none.
 *
 * @param {string|null|undefined} configuration
 * @returns {Record<string, number>}
 */
export function configurationSizes(configuration) {
  const raw = String(configuration ?? '');
  if (!raw) return {};
  const texts = [raw];
  try {
    const decoded = Buffer.from(raw, 'base64').toString('utf8');
    if (/=/.test(decoded)) texts.unshift(decoded);
  } catch { /* not base64 */ }
  for (const text of texts) {
    let plain = text;
    try { plain = decodeURIComponent(text); } catch { /* already plain */ }
    const out = {};
    for (const [, key, value, unit] of plain.matchAll(/([A-Za-z][A-Za-z0-9]*)=(-?[\d.]+(?:E-?\d+)?)\+(meter|millimeter|inch|centimeter)/gi)) {
      const metres = Number(value) * ({ meter: 1, millimeter: 0.001, centimeter: 0.01, inch: IN })[unit.toLowerCase()];
      if (Number.isFinite(metres) && metres > 0) out[key] = metres / IN;
    }
    if (Object.keys(out).length) return out;
  }
  return {};
}

/** The thread's major diameter in inches, from "#10-32", "10-32", "Number 10", "1/4-20", "M5 x 0.8", or null. */
function threadOf(text) {
  let m = /#\s*(\d{1,2})\s*-\s*\d+/.exec(text) ?? /#\s*(\d{1,2})\b/.exec(text)
    ?? /\b(\d{1,2})-(?:24|32|36|40|48|56|64|72|80)\b(?!\s*(?:"|mm|in\b))/.exec(text)
    ?? /\b(?:number|no\.?)\s*(\d{1,2})\b/i.exec(text);
  if (m && NUMBER_SIZES[m[1]]) return NUMBER_SIZES[m[1]];
  m = new RegExp(String.raw`\bfor\s+${NUM}"`, 'i').exec(text);
  if (m && number(m[1]) < 1.5) return number(m[1]);
  m = new RegExp(String.raw`(?:^|[\s(])${NUM}"?\s*-\s*\d{2}\b`).exec(text);
  if (m && number(m[1]) < 1.5) return number(m[1]);
  m = /\bM(\d+(?:\.\d+)?)\b/i.exec(text);
  if (m) return Number(m[1]) / 25.4;
  return null;
}

/** "<n>" OD", "<n> in. L", "<n>mm" … next to a label, in inches. */
function labelled(text, label) {
  const m = new RegExp(String.raw`${NUM}\s*(mm|"|in\.?|in\b)?\s*${label}\b`, 'i').exec(text);
  if (!m) return null;
  const n = number(m[1]);
  return n == null ? null : (m[2] === 'mm' ? n / 25.4 : n);
}

/** A screw's length: "x 0.75", "x 3/4\"", "M5 x 0.8 x 10" (mm), or "0.25\" L". */
function lengthOf(text, metric) {
  const parts = [...text.matchAll(new RegExp(String.raw`\bx\s*${NUM}\s*(mm|"|in\.?)?`, 'gi'))];
  const last = parts[parts.length - 1];
  if (last) {
    const n = number(last[1]);
    if (n != null) return last[2] === 'mm' || (metric && last[2] == null) ? n / 25.4 : n;
  }
  return labelled(text, '(?:Long|Length|L)');
}

/** The first plain inch size in a name that isn't a thread, a diameter or a wall ("10-32 0.5\" Button Head"). */
function firstInches(text) {
  for (const m of text.matchAll(new RegExp(String.raw`(?:^|[\s(,])${NUM}"(?!\s*-\s*\d)(?!\s*(?:OD|ID|wall|dia|wide|thick|W\b))`, 'gi'))) {
    const n = number(m[1]);
    if (n != null && n > 0) return n;
  }
  return null;
}

/** A bore: "1/2\" Hex Bore", "8mm SplineXS Bore", "0.5\" ID", "1/2\" Rounded Hex"; inches and its shape. */
function boreOf(text) {
  const m = new RegExp(String.raw`${NUM}\s*(mm|"|in\.?)?\s*((?:rounded\s+)?hex|round|splinexs|spline|keyed|square)?\s*(?:\(\s*[\d.]+\s*mm\s*\))?\s*(?:id|bore)\b`, 'i').exec(text)
    ?? new RegExp(String.raw`${NUM}\s*(mm|"|in\.?)?\s*((?:rounded\s+)?hex)\b`, 'i').exec(text);
  if (!m) return null;
  const n = number(m[1]);
  if (n == null) return null;
  return { size: m[2] === 'mm' ? n / 25.4 : n, hex: /hex/i.test(m[3] ?? '') };
}

/** A toothed wheel: teeth, tip diameter, width and bore, from its name (inches). */
function toothedOf(kind, text, finish) {
  const teeth = Number(/\b(\d{1,3})\s*-?\s*(?:t|tooth|teeth)\b/i.exec(text)?.[1]);
  if (!(teeth >= 6 && teeth <= 300)) return null;
  let od;
  if (kind === 'pulley') {
    const mm = Number(/\bHTD\s*(\d)\s*mm|\b(\d)\s*mm\s*HTD|\b(\d)M\b|\bGT(\d)\b/i.exec(text)?.slice(1).find(Boolean) ?? 5);
    const pitch = (mm === 2 && /\bGT2\b/i.test(text) ? 2 : mm) / 25.4;
    od = (teeth * pitch) / Math.PI;
  } else if (kind === 'gear') {
    const dp = Number(/\b(\d{1,2})\s*DP\b/i.exec(text)?.[1] ?? 20);
    od = (teeth + 2) / dp;
  } else {
    const chain = Number(/#?\s*\b(25|35|40|50)\b(?=\s*(?:h\b|chain|roller|sprocket|\)|,|$))/i.exec(text)?.[1] ?? 25);
    const pitch = { 25: 0.25, 35: 0.375, 40: 0.5, 50: 0.625 }[chain];
    od = pitch / Math.sin(Math.PI / teeth) + pitch * 0.3;
  }
  const width = labelled(text, '(?:Wide|WD|W|thick|width)') ?? { pulley: 0.375, gear: 0.5, sprocket: 0.125 }[kind];
  const bore = boreOf(text);
  return {
    kind,
    d: bore?.size ?? od * 0.3,
    length: width,
    head: od,
    headHeight: 0,
    od,
    id: Math.min(bore?.size ?? od * 0.3, od * 0.7),
    hexBore: bore ? bore.hex : true,
    flange: kind === 'pulley',
    finish: /steel/i.test(text) ? 'steel' : finish === 'black' ? 'black' : 'aluminum',
    teeth,
  };
}

/**
 * What a BOM row's hardware is and its size, or null when its name says it
 * is none the tool can draw.
 *
 * @param {{ name?: string, description?: string, configuration?: string|null }} row
 * @returns {{ kind: string, d: number, length: number, head: number, headHeight: number,
 *   od: number, id: number, hexBore: boolean, flange: boolean, finish: string } | null}  inches
 */
export function hardwareOf({ name, description, configuration } = {}) {
  const text = `${name ?? ''} ${description ?? ''}`.replace(/\s+/g, ' ').trim();
  const lower = text.toLowerCase();
  if (!lower) return null;
  const kind = KINDS.find(([, re]) => re.test(lower))?.[0];
  if (!kind) return null;

  const sizes = configurationSizes(configuration);
  const metric = /\bM\d/.test(text);
  // Pins and rivets have no thread: "Dowel pin 1/4 x 1" is diameter x length.
  const plain = new RegExp(String.raw`(?:^|\s)${NUM}"?\s*x\s*${NUM}`).exec(text);
  const d = sizes.BasicDiameter ?? sizes.NominalDiameter ?? sizes.MajorDiameter ?? threadOf(text)
    ?? (kind === 'pin' || kind === 'rivet' ? number(plain?.[1]) : null);
  const od = labelled(text, 'OD') ?? sizes.OuterDiameter ?? null;
  const width = labelled(text, '(?:WD|W|wide|thick)') ?? sizes.Thickness ?? null;
  const length = sizes.Length ?? (kind === 'bearing' || kind === 'washer' ? width
    : (lengthOf(text, metric) ?? (['socket', 'button', 'flat', 'pan', 'hexbolt', 'set', 'shoulder'].includes(kind) ? firstInches(text) : null)));
  const bore = labelled(text, '(?:ID|bore)') ?? new RegExp(String.raw`${NUM}"?\s*(?:rounded )?hex\b`, 'i').exec(text)?.[1];
  const id = typeof bore === 'string' ? number(bore) : bore;
  const finish = /black|oxide/i.test(text) ? 'black' : /alum/i.test(text) ? 'aluminum' : /brass/i.test(text) ? 'brass' : 'steel';

  if (TOOTHED.includes(kind)) return toothedOf(kind, text, finish);

  if (kind === 'shaft') {
    const hex = new RegExp(String.raw`${NUM}\s*(mm|")?\s*(?:rounded\s+)?hex`, 'i').exec(text);
    const round = labelled(text, '(?:OD|dia|diameter|round)');
    const across = hex ? (hex[2] === 'mm' ? number(hex[1]) / 25.4 : number(hex[1])) : round;
    if (!across) return null;
    const long = lengthOf(text, false) ?? across * 8;
    return {
      kind, d: across, length: Math.min(long, across * 14), head: across, headHeight: 0, od: across, id: 0,
      hexBore: !!hex, flange: false, finish: /steel/i.test(text) ? 'steel' : finish === 'black' ? 'black' : 'aluminum',
    };
  }

  if (kind === 'tube') {
    const outer = od ?? labelled(text, '(?:dia|diameter)');
    if (!outer) return null;
    const wall = labelled(text, '(?:wall|wall thickness)');
    const inner = labelled(text, 'ID') ?? (wall ? outer - 2 * wall : outer * 0.8);
    return {
      kind, d: inner, length: outer * 1.4, head: outer, headHeight: 0, od: outer, id: Math.max(0, Math.min(inner, outer * 0.95)),
      hexBore: false, flange: false, finish: /rubber|latex|poly|plastic|nylon|pvc/i.test(text) ? 'plastic' : finish === 'steel' ? 'aluminum' : finish,
    };
  }

  if (['spacer', 'standoff', 'bearing', 'washer', 'collar'].includes(kind)) {
    // A collar's bore is its size ("1/2\" Hex Clamping Shaft Collar").
    const inner = id ?? d ?? (kind === 'collar' ? number(new RegExp(String.raw`^${NUM}"`).exec(text)?.[1]) : null);
    const outer = od ?? (inner ? inner * ({ washer: 2.2, collar: 2.1 }[kind] ?? 1.8) : null);
    if (!outer) return null;
    const tall = length ?? ({ washer: outer * 0.08, collar: outer * 0.36 }[kind] ?? outer);
    return {
      kind,
      d: inner ?? outer * 0.45,
      length: tall,
      head: outer,
      headHeight: 0,
      od: outer,
      id: inner ?? outer * 0.45,
      hexBore: /\bhex\b/i.test(text) && kind !== 'washer',
      flange: /\bflange/i.test(text),
      finish: kind === 'spacer' && !/steel/i.test(text) ? 'aluminum' : finish,
    };
  }

  if (!d) return null;
  const ratios = {
    socket: [1.5, 1], button: [1.75, 0.55], flat: [2, 0.6], pan: [1.9, 0.6], hexbolt: [1.6, 0.65], shoulder: [1.5, 0.7],
    set: [0, 0], rivet: [2, 0.4], pin: [0, 0], nut: [0, 0], locknut: [0, 0],
  }[kind];
  const head = sizes.HeadDiameter ?? sizes.WidthAcrossFlats ?? d * ratios[0];
  const headHeight = sizes.HeadHeight ?? d * ratios[1];
  return {
    kind,
    d,
    length: length ?? (kind === 'nut' || kind === 'locknut' ? d * 0.875 : d * 3),
    head: kind === 'nut' || kind === 'locknut' ? (sizes.WidthAcrossFlats ?? d * 1.75) : head,
    headHeight,
    od: od ?? 0,
    id: d,
    hexBore: false,
    flange: false,
    finish,
  };
}

/** Each number a spec carries, and the largest it may be (inches). */
const SIZE_FIELDS = Object.freeze({ d: 6, length: 48, head: 12, headHeight: 6, od: 24, id: 24 });
const MAX_TEETH = 300;

/**
 * A spec as URL query values (rounded), for a picture address.
 * @param {NonNullable<ReturnType<typeof hardwareOf>>} spec
 * @returns {Record<string, string>}
 */
export function hardwareQuery(spec) {
  const out = { kind: spec.kind, finish: spec.finish };
  for (const f of Object.keys(SIZE_FIELDS)) out[f] = String(Math.round((spec[f] ?? 0) * 10000) / 10000);
  if (spec.hexBore) out.hex = '1';
  if (spec.flange) out.flange = '1';
  if (spec.teeth) out.teeth = String(spec.teeth);
  return out;
}

/**
 * A spec back from query values, or null when any is missing, unknown or out of range.
 * @param {Record<string, unknown>} query
 */
export function hardwareFromQuery(query) {
  const kind = String(query?.kind ?? '');
  const finish = String(query?.finish ?? 'steel');
  if (!KIND_NAMES.includes(kind) || !Object.hasOwn(FINISHES, finish)) return null;
  const spec = { kind, finish, hexBore: query.hex === '1', flange: query.flange === '1' };
  for (const [f, max] of Object.entries(SIZE_FIELDS)) {
    const raw = String(query[f] ?? '');
    if (!/^\d{1,3}(\.\d{1,6})?$/.test(raw)) return null;
    const n = Number(raw);
    if (!(n >= 0 && n <= max)) return null;
    spec[f] = n;
  }
  if (TOOTHED.includes(kind)) {
    const teeth = Number(query.teeth);
    if (!/^\d{1,3}$/.test(String(query.teeth ?? '')) || teeth < 6 || teeth > MAX_TEETH) return null;
    spec.teeth = teeth;
  }
  // Something to draw: a rod or a ring has a size.
  return spec.d > 0 || spec.od > 0 ? spec : null;
}
