import Alert from '../ui/Alert.jsx';

/**
 * Lists OnShape BOM rows that could not be turned into a part number, with
 * the property each one is missing or has wrong, so they are fixed in
 * OnShape instead of silently disappearing from the table.
 */
export default function UnidentifiedPartsWarning({ parts }) {
  if (!parts || parts.length === 0) return null;

  return (
    <div style={{ margin: '1rem' }} role="status">
      <Alert variant="warning">
        {parts.length === 1 ? '1 BOM row was' : `${parts.length} BOM rows were`} not
        loaded because the part number could not be built from its OnShape
        properties. Fix these in the part&apos;s Properties dialog in OnShape, then
        click &quot;Update from CAD&quot; again.
      </Alert>
      <ul aria-label="BOM rows that could not be identified" style={{ margin: '0.5rem 0 0', paddingLeft: '1.25rem' }}>
        {parts.map((part, idx) => (
          <li key={`${part.item ?? ''}-${part.name}-${idx}`} style={{ marginBottom: '0.25rem' }}>
            <span className="text-orange font-semibold">
              {part.name || `Unnamed row${part.item ? ` ${part.item}` : ''}`}
            </span>
            <span className="text-muted text-sm ml-2">— {part.problems.join('; ')}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
