/**
 * Renders a queue line's anomaly flags as compact chips. The flag's `detail`
 * becomes the title attribute, so hovering explains why it fired rather than
 * leaving the coordinator to guess at an abbreviated label.
 */

const SEVERITY_CLASS = {
  blocker: 'flag-chip-blocker',
  warning: 'flag-chip-warning',
  info: 'flag-chip-info',
};

export default function FlagChips({ flags = [] }) {
  if (flags.length === 0) return null;

  return (
    <span className="flag-chips">
      {flags.map((flag) => (
        <span
          key={flag.code}
          className={`flag-chip ${SEVERITY_CLASS[flag.severity] || SEVERITY_CLASS.info}`}
          title={flag.detail || flag.label}
        >
          {flag.label}
        </span>
      ))}
    </span>
  );
}
