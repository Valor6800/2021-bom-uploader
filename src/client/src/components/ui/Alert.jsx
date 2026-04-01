const VARIANTS = {
  info: { cls: 'alert-info', icon: 'ℹ️' },
  warning: { cls: 'alert-warning', icon: '⚠️' },
  error: { cls: 'alert-error', icon: '🚫' },
};

export default function Alert({ variant = 'info', children, className = '' }) {
  const style = VARIANTS[variant] || VARIANTS.info;
  return (
    <div className={`alert ${style.cls} no-print ${className}`}>
      <div className="alert-inner">
        <span className="alert-icon">{style.icon}</span>
        <p className="alert-text">{children}</p>
      </div>
    </div>
  );
}
