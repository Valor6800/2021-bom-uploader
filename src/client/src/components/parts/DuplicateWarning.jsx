import Alert from '../ui/Alert.jsx';

/**
 * Warns about duplicate part numbers detected in the OnShape BOM. Duplicates
 * are excluded from save until resolved in OnShape.
 */
export default function DuplicateWarning({ duplicates }) {
  if (!duplicates || duplicates.length === 0) return null;

  return (
    <div className="duplicates-box" style={{ margin: '1rem' }}>
      <Alert variant="error">
        Duplicate part numbers detected. Resolve these in Onshape before
        uploading — duplicates are excluded from save.
      </Alert>
      {duplicates.map((dup) => (
        <div key={dup.partNumber} className="duplicate-item">
          <span className="text-orange font-mono font-semibold">{dup.partNumber}</span>
          <span className="text-red text-sm ml-2">— {dup.occurrences.length} occurrences</span>
        </div>
      ))}
    </div>
  );
}
