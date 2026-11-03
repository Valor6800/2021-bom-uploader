import { Link } from 'react-router-dom';
import Button from '../ui/Button.jsx';
import { buildLabel } from '../../lib/buildNames.js';
import { friendlyClause } from '../../lib/friendlyError.js';

const KITTED = new Set(['hardware', 'vendor']);

/**
 * Kit sheet (`?view=kit`): one bag per build step, listing the hardware and
 * vendor parts to count out for every unit that step builds, then the whole
 * Build's totals for pulling stock. Printed with tick boxes for the kitting
 * table; nothing is saved.
 *
 * @param {object} props
 * @param {object} props.assembly
 * @param {object} props.build
 * @param {{ guide: object|null, error: Error|null, loading: boolean }} props.guideState
 * @param {string} props.backTo
 * @param {string} props.guideTo
 */
export default function KitSheet({ assembly, build, guideState, backTo, guideTo }) {
  const { guide, error, loading } = guideState;
  const printed = new Date().toLocaleDateString('en-CA');
  const bags = (guide?.steps ?? [])
    .map((step) => ({ step, lines: step.lines.filter((l) => KITTED.has(l.kind)) }))
    .filter((b) => b.lines.length > 0);

  return (
    <section className="print-view" aria-labelledby="kit-title">
      <div className="print-view-actions no-print">
        <span className="print-view-links">
          <Link to={backTo} className="btn btn-secondary"><span aria-hidden="true">← </span>Back to BOM</Link>
          <Link to={guideTo} className="btn btn-secondary">Build guide</Link>
        </span>
        <Button variant="primary" onClick={() => window.print()} disabled={!guide}>
          <span aria-hidden="true">🖨 </span>Print
        </Button>
      </div>
      {loading && <p className="page-loading" role="status">Reading the Build from OnShape…</p>}
      {error && <p className="form-error" role="alert">Couldn&apos;t make the kit sheet: {friendlyClause(error)}</p>}
      {guide && (
        <div className="print-sheet">
          <h2 id="kit-title" className="print-title">Kit sheet: {assembly.summary} — {buildLabel(build)}</h2>
          <p className="print-meta">Printed {printed} · one bag per step; count each line into its bag and tick it.</p>

          {bags.length === 0 && (
            <p className="print-note">OnShape lists no hardware or vendor parts in this Build, so there is nothing to kit.</p>
          )}

          {bags.map(({ step, lines }) => (
            <div key={step.id} className="kit-bag">
              <h3 className="kit-bag-title">
                Bag {step.number}: {step.id === 'root' ? `final assembly (${step.name})` : step.name}
                {step.count > 1 ? `, for ${step.count}` : ''}
              </h3>
              <table className="print-table">
                <thead>
                  <tr>
                    <th scope="col" className="print-tick"><span aria-hidden="true">☐</span><span className="visually-hidden">Tick</span></th>
                    <th scope="col">Count</th>
                    <th scope="col">Item</th>
                    <th scope="col">Part number</th>
                    <th scope="col">Each</th>
                  </tr>
                </thead>
                <tbody>
                  {lines.map((line, i) => (
                    <tr key={`${line.name}-${i}`}>
                      <td className="print-tick" aria-hidden="true">☐</td>
                      <td className="kit-count">{line.total}</td>
                      <td>{line.name}{line.material && line.kind === 'hardware' ? ` (${line.material})` : ''}</td>
                      <td>{line.sku ?? (line.partNumber && line.partNumber !== 'N/A' ? line.partNumber : '—')}</td>
                      <td>{line.perUnit}{step.count > 1 ? ` × ${step.count}` : ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ))}

          {guide.kit.length > 0 && (
            <div className="kit-bag">
              <h3 className="kit-bag-title">Whole Build: pull from stock</h3>
              <table className="print-table">
                <thead>
                  <tr>
                    <th scope="col" className="print-tick"><span aria-hidden="true">☐</span><span className="visually-hidden">Tick</span></th>
                    <th scope="col">Total</th>
                    <th scope="col">Item</th>
                    <th scope="col">Part number</th>
                    <th scope="col">Bags</th>
                  </tr>
                </thead>
                <tbody>
                  {guide.kit.map((line, i) => (
                    <tr key={`${line.name}-${i}`}>
                      <td className="print-tick" aria-hidden="true">☐</td>
                      <td className="kit-count">{line.total}</td>
                      <td>{line.name}{line.material && line.kind === 'hardware' ? ` (${line.material})` : ''}</td>
                      <td>{line.sku ?? '—'}</td>
                      <td>{[...new Set(line.steps)].join(', ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
