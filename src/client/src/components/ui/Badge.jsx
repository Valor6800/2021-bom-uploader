/**
 * Status chip. Colour is never the only signal: every chip shows its word.
 *
 * Build statuses: Draft, Active, Superseded, Archived.
 * Part row statuses: New, Changed, In Build, Saved, Error, Exists,
 * Not in any Build, Current.
 */
const STYLES = {
  // Part rows
  New: 'badge-new',
  Changed: 'badge-changes',
  'In Build': 'badge-exists',
  Saved: 'badge-new',
  Error: 'badge-error',
  Exists: 'badge-exists',
  'Not in any Build': 'badge-exists',
  Current: 'badge-new',
  // Builds
  Draft: 'badge-draft',
  Active: 'badge-active',
  Superseded: 'badge-exists',
  Archived: 'badge-archived',
};

/** Leading marks so the chip reads the same without colour. */
const MARKS = {
  Active: '●',
  Saved: '✓',
};

export default function Badge({ status }) {
  const mark = MARKS[status];
  return (
    <span className={`badge ${STYLES[status] || STYLES.Exists}`}>
      {mark && <span aria-hidden="true">{mark} </span>}
      {status}
    </span>
  );
}
