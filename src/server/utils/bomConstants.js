/**
 * Centralized BOM field options and material-to-machinery mapping rules.
 * Single source of truth for all configurable field values used across
 * BOM Service, Part Service, Validators, and the React frontend.
 */

export const Material = Object.freeze({
  NONE: 'None',
  AL_6061: 'AL 6061',
  PLA: 'PLA',
  PETG_CF: 'PETG-CF',
  NYLON: 'Nylon',
  WOOD: 'Wood',
  POLYCARB: 'Polycarb',
  SRPP: 'SRPP',
  AL_7075: 'AL 7075',
});

export const Machinery = Object.freeze({
  NONE: 'None',
  CNC_MILL: 'CNC Mill',
  CNC_ROUTER: 'CNC Router',
  MANUAL_MILL: 'Manual Mill',
  MANUAL_LATHE: 'Manual Lathe',
  THREE_D_PRINTER: '3D Printer',
  MANUAL: 'Manual',
});

export const Powdercoat = Object.freeze({
  NONE: 'None',
  BLACK: 'Black',
  GOLD: 'Gold',
});

/** Needs Tapping? on a Part: set by hand, "No" unless picked. */
export const Tapping = Object.freeze({
  NO: 'No',
  YES: 'Yes',
});

export const Thickness = Object.freeze({
  NONE: 'None',
  T_0060: '0.060',
  T_0090: '0.090',
  T_0125: '0.125',
  T_01875: '0.1875',
  T_0250: '0.250',
});

/**
 * The tracker's built-in Priority names, highest first. Priority is optional
 * on a Part: a save sends it only when it changed (see designerSave.js).
 */
export const PRIORITIES = Object.freeze(['Highest', 'High', 'Medium', 'Low', 'Lowest']);

/** Value arrays derived from the enums for validators and dropdowns. */
export const MATERIALS = Object.values(Material);
export const MACHINERY = Object.values(Machinery);
export const POWDERCOAT = Object.values(Powdercoat);
export const TAPPING = Object.values(Tapping);
export const THICKNESS = Object.values(Thickness);

/**
 * Maps raw Onshape material substrings to normalized material/machinery pairs.
 * Keys are lowercase substrings matched against the raw displayName.
 */
export const MATERIAL_MACHINERY_MAP = {
  '6061':          { material: Material.AL_6061,  machinery: Machinery.CNC_ROUTER },
  'pla':           { material: Material.PLA,      machinery: Machinery.THREE_D_PRINTER },
  'petg':          { material: Material.PETG_CF,  machinery: Machinery.THREE_D_PRINTER },
  'nylon':         { material: Material.NYLON,    machinery: Machinery.THREE_D_PRINTER },
  'birch':         { material: Material.WOOD,     machinery: Machinery.CNC_ROUTER },
  'wood':          { material: Material.WOOD,     machinery: Machinery.CNC_ROUTER },
  'polycarbonate': { material: Material.POLYCARB, machinery: Machinery.CNC_ROUTER },
  'polypropylene': { material: Material.SRPP,     machinery: Machinery.CNC_ROUTER },
  '7075':          { material: Material.AL_7075,  machinery: Machinery.MANUAL_LATHE },
};
