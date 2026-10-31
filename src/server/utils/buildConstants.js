/**
 * Centralized constants for the Build/Revision workflow: custom field IDs,
 * the Build issue type's workflow transitions, and the two link types that
 * carry the Part↔Build and revision-chain relationships.
 *
 * Single source of truth for Build Service, Revision Service, and the
 * one-time migration script. Field IDs and transition IDs are specific to
 * this Jira instance's schema (Sheet 02/08 of the plan) — they were assigned
 * when Phase 0 was set up and are not portable to another instance without
 * re-discovering them.
 */

/** The Build issue type's own custom fields. */
export const BuildField = Object.freeze({
  ASSEMBLY_LINK: 'customfield_10110',       // Epic Link, reused — points at the parent Assembly
  BUILD_NUMBER: 'customfield_10501',
  ONSHAPE_VERSION_LINK: 'customfield_10502',
  INSTRUCTIONS_DATA: 'customfield_10503',
});

/** The Revision field, shared by Assembly and Part. */
export const RevisionField = Object.freeze({
  REVISION: 'customfield_10500',
});

/** Build's own workflow statuses. Read, never written directly — see BuildTransition. */
export const BuildStatus = Object.freeze({
  DRAFT: 'Draft',
  ACTIVE: 'Active',
  SUPERSEDED: 'Superseded',
  ARCHIVED: 'Archived',
});

/**
 * Transition IDs on Build's dedicated workflow (Sheet 02). Jira has no direct
 * Draft -> Superseded edge; Draft always passes through Active first.
 */
export const BuildTransition = Object.freeze({
  CUT_VERSION: '11',  // Draft -> Active
  SUPERSEDE: '21',    // Active -> Superseded
  ARCHIVE: '31',      // Draft/Active/Superseded -> Archived (global transition)
});

/** Issue link types created for Phase 0. */
export const LinkType = Object.freeze({
  USED_IN: 'Used In',   // Part <-> Build, many-to-many
  REVISES: 'Revises',   // chains a revision ticket back to the one it replaces
});

/**
 * JQL's `linkedIssues(issue, "...")` takes a link *description* (the inward
 * or outward wording), not the link type's name: `"Used In"` is rejected with
 * a 400 ("Issue link type 'Used In' could not be found"). Matching both
 * descriptions keeps the query limited to Used In links in either direction.
 */
export const UsedInDescription = Object.freeze({
  INWARD: 'is used in',
  OUTWARD: 'uses',
});

/** JQL clause matching every issue joined to `safeKey` by a Used In link. */
export function usedInLinkedClause(safeKey) {
  return `(issue in linkedIssues(${safeKey}, "${UsedInDescription.INWARD}") OR ` +
    `issue in linkedIssues(${safeKey}, "${UsedInDescription.OUTWARD}"))`;
}
