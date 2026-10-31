/**
 * Helpers for Parts read across an Assembly's Revision chain.
 *
 * A Part keeps the Epic Link of the Revision ticket it was created under, so
 * one Part number can appear under several tickets of the same chain. The
 * chain comes from RevisionService.getRevisionChain, newest first.
 */

/**
 * When two stories share a fullPartNumber, keep the one whose `epic` is
 * newest in the chain (lowest index). Stories with no fullPartNumber are
 * kept as they are. Order of the kept stories is preserved.
 *
 * @param {object[]} stories  Parsed Part stories (each with `epic`)
 * @param {string[]} chain    Revision chain keys, newest first
 * @returns {object[]}
 */
export function preferNewestRevision(stories, chain) {
  const rank = new Map(chain.map((key, index) => [key, index]));
  const indexOf = (story) => rank.get(story.epic) ?? Infinity;

  const winners = new Map();
  for (const story of stories) {
    if (!story.fullPartNumber) continue;
    const current = winners.get(story.fullPartNumber);
    if (!current || indexOf(story) < indexOf(current)) {
      winners.set(story.fullPartNumber, story);
    }
  }

  return stories.filter(
    (story) => !story.fullPartNumber || winners.get(story.fullPartNumber) === story,
  );
}
