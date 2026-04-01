const STYLES = {
  New: 'badge-new',
  Changes: 'badge-changes',
  Updated: 'badge-updated',
  Exists: 'badge-exists',
};

export default function Badge({ status }) {
  return (
    <span className={`badge ${STYLES[status] || STYLES.Exists}`}>
      {status}
    </span>
  );
}
