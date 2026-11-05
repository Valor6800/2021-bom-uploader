/**
 * An OnShape assembly can be configured (a "2x2 Lowered" frame, a default
 * one), and a BOM is read for one configuration at a time. The tool keeps the
 * configuration an Assembly follows as a line in the Assembly's description:
 *
 *   Onshape configuration: List_7BgV2vxCHVntIE=_2x2_Lowered;List_SU9X...=Default
 *
 * It takes it from the `?configuration=` in the link pasted when the Assembly
 * is added (and, for a sub-assembly, from the parent's instance of it).
 */

const LINE = /^[ \t]*Onshape configuration:[ \t]*(\S.*?)[ \t]*$/im;

/** What OnShape puts in a configuration: names, `=`, `;`, and the odd unit or space. Nothing that could break out of a query string. */
const VALID = /^[A-Za-z0-9_=;:.\-+% ,()]{1,2000}$/;

/** True for text OnShape could have as a configuration ("default" included). */
export function isConfigurationText(value) {
  return VALID.test(String(value ?? ''));
}

/**
 * @returns {string|null} A configuration, or null when it is empty, has odd
 *   characters, or is "default" (what OnShape calls an assembly that isn't configured)
 */
export function cleanConfiguration(value) {
  const text = String(value ?? '').trim();
  return VALID.test(text) && text.toLowerCase() !== 'default' ? text : null;
}

/** The configuration named in an Assembly's description, or null. */
export function configurationFrom(description) {
  const match = LINE.exec(String(description ?? ''));
  return match ? cleanConfiguration(match[1]) : null;
}

/** The `?configuration=` of a pasted OnShape link, or null. */
export function configurationFromUrl(url) {
  try {
    return cleanConfiguration(new URL(String(url ?? '').trim()).searchParams.get('configuration'));
  } catch {
    return null;
  }
}

/** The description line for a configuration ('' for none). */
export function configurationLine(configuration) {
  const clean = cleanConfiguration(configuration);
  return clean ? `Onshape configuration: ${clean}` : '';
}
