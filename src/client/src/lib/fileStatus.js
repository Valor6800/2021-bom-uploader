/**
 * Following the files Save leaves to the background (a Part's picture, STEP
 * and DXFs): which Parts to watch, and what a status answer means.
 *
 * Pure, so the server-side Jest suite tests it.
 */

/**
 * The Parts a Save made whose files are being attached.
 * @param {object[]} results  `results` from the save response
 * @returns {{ key: string, name: string }[]}
 */
export function watchFrom(results) {
  return (results ?? [])
    .filter((r) => r.filesPending && r.key)
    .map((r) => ({ key: r.key, name: r.fullPartNumber ?? r.ref }));
}

/** `watching` plus `added`, once per key. */
export function addWatch(watching, added) {
  const known = new Set(watching.map((w) => w.key));
  return [...watching, ...added.filter((w) => !known.has(w.key))];
}

/**
 * Sort the watched Parts by a status answer.
 *
 * A Part the server doesn't know (it restarted) is let go without a word:
 * the Assembly page lists any Part still missing files once its Build is cut.
 *
 * @param {{ key: string, name: string }[]} watching
 * @param {Record<string, { state: string, problems: string[] }>} statuses
 * @returns {{ stillWatching: object[], finished: object[], failed: { key: string, name: string, problems: string[] }[] }}
 */
export function settle(watching, statuses) {
  const stillWatching = [];
  const finished = [];
  const failed = [];
  for (const w of watching) {
    const status = statuses?.[w.key];
    if (status?.state === 'pending') stillWatching.push(w);
    else if (status?.state === 'failed') failed.push({ ...w, problems: status.problems ?? [] });
    else finished.push(w);
  }
  return { stillWatching, finished, failed };
}

/** One line for Parts whose files didn't all go on. */
export function failureText(failed) {
  if (failed.length === 0) return '';
  const names = failed.map((f) => f.name).join(', ');
  return `Couldn't attach all the files to ${names}. Once the Build is cut, the Assembly page can make them again.`;
}
