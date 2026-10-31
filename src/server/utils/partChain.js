/**
 * Helpers for Parts read across an Assembly's Revision chain.
 *
 * A Part keeps the Epic Link of the Revision ticket it was created under, so
 * one Part number can appear under several tickets of the same chain. The
 * chain comes from RevisionService.getRevisionChain, newest first.
 */

/**
 * The numeric part of a ticket key ("HAR-2031" -> 2031), or Infinity when it
 * has none.
 * @param {string|undefined} key
 * @returns {number}
 */
export function keyNumber(key) {
  const match = /-(\d+)$/.exec(key ?? '');
  return match ? Number(match[1]) : Infinity;
}

/**
 * Create spare copies a Part exactly, so several tickets can share one full
 * number. The original is the one created first: the lowest ticket number.
 * @param {object} candidate  A Part story
 * @param {object|undefined} current  The Part chosen so far for that number
 * @returns {boolean} True when `candidate` should replace `current`
 */
export function isMoreOriginal(candidate, current) {
  return !current || keyNumber(candidate.key) < keyNumber(current.key);
}

/**
 * When two stories share a fullPartNumber, keep the one whose `epic` is
 * newest in the chain (lowest index); among stories under the same ticket,
 * keep the original (lowest key, see `isMoreOriginal`), so a spare never
 * stands in for it. Stories with no fullPartNumber are kept as they are.
 * Order of the kept stories is preserved.
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
    if (!current
      || indexOf(story) < indexOf(current)
      || (indexOf(story) === indexOf(current) && isMoreOriginal(story, current))) {
      winners.set(story.fullPartNumber, story);
    }
  }

  return stories.filter(
    (story) => !story.fullPartNumber || winners.get(story.fullPartNumber) === story,
  );
}
