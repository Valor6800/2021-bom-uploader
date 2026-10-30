const VARIANTS = {
  info: { cls: 'alert-info', icon: 'ℹ' },
  warning: { cls: 'alert-warning', icon: '⚠' },
  error: { cls: 'alert-error', icon: '🚫' },
};

/**
 * @param {object} props
 * @param {'info'|'warning'|'error'} [props.variant]
 * @param {'alert'|'status'} [props.role]  `alert` for a failed action,
 *   `status` for a load problem that shouldn't interrupt a screen reader.
 * @param {import('react').ReactNode} [props.actions]  Buttons after the text.
 */
export default function Alert({ variant = 'info', children, className = '', role, actions, id }) {
  const style = VARIANTS[variant] || VARIANTS.info;
  return (
    <div className={`alert ${style.cls} no-print ${className}`} role={role} id={id}>
      <div className="alert-inner">
        <span className="alert-icon" aria-hidden="true">{style.icon}</span>
        <div className="alert-text">{children}</div>
        {actions && <div className="alert-actions">{actions}</div>}
      </div>
    </div>
  );
}
