/**
 * Print-only BOM for the active Build (Sheet 06) — hidden on screen, shown
 * when printing. Separate from the editable table because the app's global
 * print rules strip columns by position, which would drop Qty here.
 */
export default function HubPrintView({ assemblySummary, build, parts }) {
  if (!build) return null;

  return (
    <div className="hub-print-only">
      <h2>{assemblySummary}</h2>
      <h3>{build.summary} — {build.status}</h3>
      {build.onshapeVersionLink && <p>Onshape version: {build.onshapeVersionLink}</p>}
      <table className="hub-print-table">
        <thead>
          <tr>
            <th>Key</th>
            <th>Qty</th>
            <th>Part</th>
            <th>Material</th>
            <th>Machinery</th>
            <th>Powdercoat</th>
            <th>Thickness</th>
          </tr>
        </thead>
        <tbody>
          {parts.map((part) => (
            <tr key={part.key}>
              <td>{part.key}</td>
              <td>{part.quantity}</td>
              <td>{part.summary}</td>
              <td>{part.material}</td>
              <td>{part.machinery}</td>
              <td>{part.powdercoat}</td>
              <td>{part.thickness}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
