/**
 * Export Service — thin wrapper around OnshapeClient export methods
 * with automatic STEP export for 3D-printed parts.
 */

import { Machinery } from '../utils/bomConstants.js';

export class ExportService {
  /**
   * @param {object} deps
   * @param {import('../clients/onshapeClient.js').OnshapeClient} deps.onshapeClient
   */
  constructor({ onshapeClient }) {
    this.onshapeClient = onshapeClient;
  }

  /**
   * Export an STL file for a part.
   *
   * @param {string} documentId
   * @param {string} workspaceId
   * @param {string} elementId
   * @param {string} partId
   * @returns {Promise<Buffer>}
   */
  async exportSTL(documentId, workspaceId, elementId, partId) {
    return this.onshapeClient.exportSTL(documentId, workspaceId, elementId, partId);
  }

  /**
   * Export a STEP file for a part.
   *
   * @param {string} documentId
   * @param {string} workspaceId
   * @param {string} elementId
   * @param {string} partId
   * @returns {Promise<Buffer>}
   */
  async exportSTEP(documentId, workspaceId, elementId, partId) {
    return this.onshapeClient.exportSTEP(documentId, workspaceId, elementId, partId);
  }

  /**
   * Automatically trigger a STEP export when a part's machinery is "3D Printer".
   * Returns null (no-op) for non-3D-print parts.
   * Per-part error isolation: returns an error result instead of throwing.
   *
   * @param {object} part  ParsedBOMItem with documentId, workspaceId, elementId, partId
   * @returns {Promise<{ exported: boolean, buffer?: Buffer, error?: string }>}
   */
  async autoExportForPrint(part) {
    if (part.machinery !== Machinery.THREE_D_PRINTER) {
      return { exported: false };
    }

    try {
      const buffer = await this.exportSTEP(
        part.documentId,
        part.workspaceId,
        part.elementId,
        part.partId,
      );
      return { exported: true, buffer };
    } catch (err) {
      return {
        exported: false,
        error: `STEP export failed for ${part.fullPartNumber ?? 'unknown'}: ${err.message}`,
      };
    }
  }
}
