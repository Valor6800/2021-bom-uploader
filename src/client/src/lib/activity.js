/**
 * Words for the activity log. Pure, so the server-side Jest suite tests it.
 */

/** Each kind of entry, as its chip reads. */
export const ACTION_LABELS = Object.freeze({
  onboard: 'Added',
  build: 'New Build',
  save: 'Saved',
  cut: 'Cut',
  archive: 'Archived',
  spare: 'Spare',
  files: 'Files',
});

/**
 * When, the way a person says it: "just now", "5 min ago", "3 h ago",
 * "yesterday", else the date.
 *
 * @param {string|null} at  ISO time
 * @param {Date} [now]
 */
export function whenText(at, now = new Date()) {
  const t = at ? new Date(at) : null;
  if (!t || Number.isNaN(t.getTime())) return '—';
  const minutes = Math.round((now.getTime() - t.getTime()) / 60000);
  if (minutes < 1) return 'just now';
  if (minutes < 60) return `${minutes} min ago`;
  if (minutes < 24 * 60) return `${Math.round(minutes / 60)} h ago`;
  if (minutes < 48 * 60) return 'yesterday';
  return t.toLocaleDateString('en-CA');
}
