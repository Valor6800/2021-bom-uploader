const VARIANTS = {
  primary: 'btn-primary',
  success: 'btn-success',
  secondary: 'btn-secondary',
  danger: 'btn-danger',
};

export default function Button({ variant = 'primary', children, className = '', ...props }) {
  return (
    <button
      className={`btn ${VARIANTS[variant] || VARIANTS.primary} ${className}`}
      {...props}
    >
      {children}
    </button>
  );
}
