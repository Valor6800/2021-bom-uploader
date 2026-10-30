const VARIANTS = {
  primary: 'btn-primary',
  success: 'btn-success',
  secondary: 'btn-secondary',
  ghost: 'btn-ghost',
  danger: 'btn-danger',
  'danger-solid': 'btn-danger-solid',
};

/**
 * @param {object} props
 * @param {'primary'|'success'|'secondary'|'ghost'|'danger'|'danger-solid'} [props.variant]
 * @param {boolean} [props.ariaDisabled]  Disabled but still focusable, so a
 *   `title` or `aria-describedby` can explain why. Clicks are swallowed.
 */
export default function Button({
  variant = 'primary',
  children,
  className = '',
  type = 'button',
  ariaDisabled = false,
  onClick,
  ...props
}) {
  const handleClick = ariaDisabled
    ? (e) => { e.preventDefault(); }
    : onClick;
  return (
    <button
      type={type}
      className={`btn ${VARIANTS[variant] || VARIANTS.primary} ${className}`}
      aria-disabled={ariaDisabled ? 'true' : undefined}
      onClick={handleClick}
      {...props}
    >
      {children}
    </button>
  );
}
