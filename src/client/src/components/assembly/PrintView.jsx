import { Link } from 'react-router-dom';
import Button from '../ui/Button.jsx';
import { buildLabel } from '../../lib/buildNames.js';

const dash = (v) => (!v || v === 'None' ? '—' : v);

/**
 * Print sheet for one Build (design 3.5, `?view=print`): an on-screen
 * preview with a Print button, and print CSS that hides the nav, the
 * header actions and the button. The tick column is for checking Parts
 * off at the pit table, so it is printed, never interactive.
 *
 * @param {object} props
 * @param {object} props.assembly
 * @param {object} props.build
 * @param {object[]} props.parts      The Build's Parts
 * @param {string} props.backTo       The BOM view's URL
 */
export default function PrintView({ assembly, build, parts, backTo }) {
  const printed = new Date().toLocaleDateString('en-CA');
  return (
    <section className="print-view" aria-labelledby="print-title">
      <div className="print-view-actions no-print">
        <Link to={backTo} className="btn btn-secondary">
          <span aria-hidden="true">← </span>Back to BOM
        </Link>
        <Button variant="primary" onClick={() => window.print()}>
          <span aria-hidden="true">🖨 </span>Print
        </Button>
      </div>
      <div className="print-sheet">
        <h2 id="print-title" className="print-title">
          {assembly.summary} — {buildLabel(build)} ({build.status})
        </h2>
        <p className="print-meta">
          Revision {assembly.revision ?? 'A'}
          {build.onshapeVersionLink ? <> · OnShape link: {build.onshapeVersionLink}</> : null}
        </p>
        <p className="print-meta">Printed {printed}</p>
        <table className="print-table">
          <caption className="visually-hidden">Parts in {buildLabel(build)}</caption>
          <thead>
            <tr>
              <th scope="col" className="print-tick"><span aria-hidden="true">☐</span><span className="visually-hidden">Tick</span></th>
              <th scope="col">Qty</th>
              <th scope="col">Part</th>
              <th scope="col">Material</th>
              <th scope="col">Machinery</th>
              <th scope="col">Powdercoat</th>
              <th scope="col">Tapping</th>
              <th scope="col">Thickness</th>
              <th scope="col">Priority</th>
            </tr>
          </thead>
          <tbody>
            {parts.length === 0 && (
              <tr><td colSpan={9}>No Parts in {buildLabel(build)} yet.</td></tr>
            )}
            {parts.map((part) => (
              <tr key={part.key}>
                <td className="print-tick" aria-hidden="true">☐</td>
                <td>{part.quantity}</td>
                <td>{part.summary}</td>
                <td>{dash(part.material)}</td>
                <td>{dash(part.machinery)}</td>
                <td>{dash(part.powdercoat)}</td>
                <td>{dash(part.tapping)}</td>
                <td>{dash(part.thickness)}</td>
                <td>{dash(part.priority)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="print-note">(Assembly instructions will appear here once they exist.)</p>
      </div>
    </section>
  );
}
