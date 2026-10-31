/**
 * Run fn with the named environment variables unset, then put back exactly
 * what was there (unset stays unset). Constructor tests use it so a shell
 * that exports the fallback names (JIRA_BASE_URL, API_KEY, ...) can't
 * satisfy the check the test expects to fail.
 *
 * @param {string[]} names
 * @param {() => void} fn
 */
export function withoutEnv(names, fn) {
  const saved = names.map((n) => [n, Object.hasOwn(process.env, n), process.env[n]]);
  for (const n of names) delete process.env[n];
  try {
    fn();
  } finally {
    for (const [n, had, value] of saved) {
      if (had) process.env[n] = value; else delete process.env[n];
    }
  }
}
