const STYLES = {
  New: 'badge-new',
  Changes: 'badge-changes',
  Updated: 'badge-updated',
  Exists: 'badge-exists',
  Draft: 'badge-exists',
  Active: 'badge-new',
  Superseded: 'badge-changes',
  Archived: 'badge-archived',
  Current: 'badge-new',
};

export default function Badge({ status }) {
  return (
    <span className={`badge ${STYLES[status] || STYLES.Exists}`}>
      {status}
    </span>
  );
}
