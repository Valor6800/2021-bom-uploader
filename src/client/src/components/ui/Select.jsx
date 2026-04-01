export default function Select({ label, id, children, className = '', ...props }) {
  return (
    <div>
      {label && (
        <label htmlFor={id} className="select-label">
          {label}
        </label>
      )}
      <select
        id={id}
        className={`select ${className}`}
        {...props}
      >
        {children}
      </select>
    </div>
  );
}
