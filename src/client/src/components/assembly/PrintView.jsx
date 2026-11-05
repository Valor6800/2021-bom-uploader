import { Link } from 'react-router-dom';
import Button from '../ui/Button.jsx';
import { buildLabel } from '../../lib/buildNames.js';
import { useGuide, usePurchasedParts } from '../assembly-shared/useGuideData.js';
import { guideImageUrl } from '../../api/client.js';

const dash = (v) => (!v || v === 'None' ? '—' : v);

/** A tick-box table of bought rows (off-the-shelf or hardware). */
function BoughtTable({ title, rows, showVendor }) {
  if (rows.length === 0) return null;
  return (
    <>
      <h3 className="print-subtitle">{title} ({rows.length})</h3>
      <table className="print-table">
        <caption className="visually-hidden">{title}</caption>
        <thead>
          <tr>
            <th scope="col" className="print-tick"><span aria-hidden="true">☐</span><span className="visually-hidden">Tick</span></th>
            <th scope="col">Qty</th>
            <th scope="col">Part</th>
            {showVendor && <th scope="col">Vendor</th>}
            {showVendor && <th scope="col">Vendor part number</th>}
          </tr>
        </thead>
        <tbody>
          {rows.map((part, i) => (
            <tr key={`${part.name}-${i}`}>
              <td className="print-tick" aria-hidden="true">☐</td>
              <td>{part.quantity}</td>
              <td>{part.name}</td>
              {showVendor && <td>{dash(part.vendor)}</td>}
              {showVendor && <td>{dash(part.sku ?? (part.partNumber !== 'N/A' ? part.partNumber : null))}</td>}
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

/** The Build guide's steps, for paper: picture, what to make, and what each step takes. */
function GuideSteps({ buildKey, guideState }) {
  const { guide, loading, error } = guideState;
  if (loading) return <p className="print-note no-print" role="status">Reading the Build guide from OnShape…</p>;
  if (error || !guide?.steps?.length) {
    return <p className="print-note no-print">The Build guide couldn&apos;t be read, so it isn&apos;t on this sheet.</p>;
  }
  return (
    <section className="print-guide" aria-labelledby="print-guide-title">
      <h3 id="print-guide-title" className="print-subtitle">Build guide</h3>
      <ol className="print-steps">
        {guide.steps.map((step) => (
          <li key={step.id} className="print-step">
            <h4 className="print-step-title">
              Step {step.number}: {step.id === 'root' ? `Put together ${step.name}` : step.name}
              {step.count > 1 ? ` (make ${step.count})` : ''}
            </h4>
            <div className="print-step-body">
              {step.id !== 'root' && step.hasImage && (
                <img className="print-step-image" src={guideImageUrl(buildKey, step.id)} alt={`${step.name}, isometric view`} />
              )}
              <table className="print-table print-step-table">
                <caption className="visually-hidden">What step {step.number} takes</caption>
                <thead>
                  <tr>
                    <th scope="col" className="print-tick"><span aria-hidden="true">☐</span><span className="visually-hidden">Tick</span></th>
                    <th scope="col">Qty</th>
                    <th scope="col">Item</th>
                  </tr>
                </thead>
                <tbody>
                  {step.lines.length === 0 && <tr><td colSpan={3}>OnShape lists nothing in this step.</td></tr>}
                  {step.lines.map((line, i) => (
                    <tr key={`${line.kind}-${line.name}-${i}`}>
                      <td className="print-tick" aria-hidden="true">☐</td>
                      <td>{line.total}</td>
                      <td>
                        {line.kind === 'step' ? `${line.name} (from an earlier step)` : line.name}
                        {line.sku ? ` · ${line.sku}` : ''}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

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
 *
 * Below the Parts, the Build's off-the-shelf parts and hardware (from its
 * OnShape BOM, as the BOM view shows them), then the Build guide's steps,
 * each when it can be read.
 */
export default function PrintView({ assembly, build, parts, backTo }) {
  const printed = new Date().toLocaleDateString('en-CA');
  const { parts: bought } = usePurchasedParts(assembly.key, build.key);
  const guideState = useGuide(build.key);
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
        <BoughtTable title="Off-the-shelf" rows={bought.filter((p) => !p.standard)} showVendor />
        <BoughtTable title="Hardware" rows={bought.filter((p) => p.standard)} />
        <GuideSteps buildKey={build.key} guideState={guideState} />
      </div>
    </section>
  );
}
