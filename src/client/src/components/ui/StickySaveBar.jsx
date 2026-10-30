/**
 * Bar pinned to the bottom of the work area while there are unsaved changes.
 * `position: sticky` (not fixed) so an iPad's on-screen keyboard doesn't
 * cover it.
 *
 * @param {object} props
 * @param {import('react').ReactNode} props.summary  e.g. "Unsaved: 1 new Part · 1 change"
 * @param {import('react').ReactNode} [props.status] Progress or help text, e.g. "Saving 25/60…"
 * @param {import('react').ReactNode} [props.alert]  An Alert for a whole-request failure.
 * @param {import('react').ReactNode} props.actions  Discard and Save buttons.
 */
export default function StickySaveBar({ summary, status, alert, actions, label = 'Unsaved changes' }) {
  return (
    <section className="save-bar no-print" aria-label={label}>
      {alert && <div className="save-bar-alert">{alert}</div>}
      <div className="save-bar-inner">
        <div className="save-bar-text">
          <span className="save-bar-summary">{summary}</span>
          {status && <span className="save-bar-status" role="status">{status}</span>}
        </div>
        <div className="save-bar-actions">{actions}</div>
      </div>
    </section>
  );
}
