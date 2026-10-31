/**
 * A small model of how Jira Data Center stores and labels issue links, for
 * tests that need the real direction rule rather than a fake that echoes
 * back whatever was written.
 *
 * Jira's POST /rest/api/2/issueLink makes `inwardIssue` the link's source:
 * the source's page shows the link type's OUTWARD phrase, the other issue's
 * page shows the INWARD phrase. On GET /issue, the source's entry holds
 * `outwardIssue: <target>` and the target's entry holds `inwardIssue:
 * <source>`. Verified live on HAR (link 16601: inwardIssue=HAR-2031,
 * outwardIssue=HAR-2032 made HAR-2031 read "uses" HAR-2032).
 */

export const JIRA_LINK_TYPES = Object.freeze({
  'Used In': { name: 'Used In', inward: 'is used in', outward: 'uses' },
  Revises: { name: 'Revises', inward: 'is revised by', outward: 'revises' },
});

export function makeJiraLinkModel() {
  const links = [];

  return {
    /** Stand-in for jira.js issueLinks.linkIssues (POST /issueLink). */
    async linkIssues({ type, inwardIssue, outwardIssue }) {
      const linkType = JIRA_LINK_TYPES[type.name];
      if (!linkType) throw Object.assign(new Error(`No link type ${type.name}`), { status: 404 });
      links.push({ id: String(links.length + 1), type: linkType, source: inwardIssue.key, target: outwardIssue.key });
    },

    /** The `issuelinks` array GET /issue/{key} returns. */
    issuelinksOf(key) {
      return links.flatMap((l) => {
        if (l.source === key) return [{ id: l.id, type: l.type, outwardIssue: { key: l.target } }];
        if (l.target === key) return [{ id: l.id, type: l.type, inwardIssue: { key: l.source } }];
        return [];
      });
    },

    /** What the tracker shows on `key`'s page, one line per link. */
    reads(key) {
      return this.issuelinksOf(key).map((e) => (e.outwardIssue
        ? `${key} ${e.type.outward} ${e.outwardIssue.key}`
        : `${key} ${e.type.inward} ${e.inwardIssue.key}`));
    },
  };
}
