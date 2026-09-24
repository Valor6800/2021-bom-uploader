/**
 * Compact, unlabeled select for use inside table cells and dense forms.
 * Distinct from the labeled block-level Select primitive.
 *
 * @param {object} props
 * @param {string} props.value
 * @param {(e: Event) => void} props.onChange
 * @param {string[]} props.options   List of option values (used as label too)
 * @param {boolean} [props.disabled]
 */
export default function InlineSelect({ value, onChange, options, disabled = false, className = '', ...props }) {
  return (
    <select
      value={value ?? 'None'}
      onChange={onChange}
      disabled={disabled}
      className={`select-inline ${className}`}
      {...props}
    >
      {options.map((opt) => (
        <option key={opt} value={opt}>{opt}</option>
      ))}
    </select>
  );
}
