/**
 * Run `fn` after every earlier call for the same `key` has settled, so
 * concurrent requests for one key (a double click, a second tab) run one at
 * a time within this process. The entry is removed once the last call for
 * the key settles. A failed call doesn't block the next one.
 *
 * @template T
 * @param {Map<string, Promise<void>>} locks  Owner's lock map
 * @param {string} key
 * @param {() => Promise<T>} fn
 * @returns {Promise<T>}
 */
export function withKeyedLock(locks, key, fn) {
  const previous = locks.get(key) ?? Promise.resolve();
  const run = previous.then(fn);
  const tail = run.then(() => {}, () => {});
  locks.set(key, tail);
  tail.then(() => {
    if (locks.get(key) === tail) locks.delete(key);
  });
  return run;
}
