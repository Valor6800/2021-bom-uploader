import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { TrackerKey } from '../assembly-shared/AssemblyHeader.jsx';
import { buildLabel } from '../../lib/buildNames.js';
import { compareBuildRows } from '../../lib/designerRows.js';

function Mark({ inBuild, name }) {
  return inBuild ? (
    <><span aria-hidden="true">✓</span><span className="visually-hidden">in {name}</span></>
  ) : (
    <><span aria-hidden="true" className="text-muted">—</span><span className="visually-hidden">not in {name}</span></>
  );
}

const option = (b) => `${buildLabel(b)} · ${b.status}`;

/**
 * Two Builds side by side (design 3.5, `?view=compare`), in place of the
 * BOM panel. Shared Parts first, then by summary.
 *
 * @param {object} props
 * @param {object[]} props.builds
 * @param {object[]} props.parts
 * @param {Map<string, Set<string>>} props.links  partKey -> Build keys
 * @param {string|null} props.aKey
 * @param {string|null} props.bKey
 * @param {(a: string, b: string) => void} props.onChange
 * @param {string} props.backTo  The BOM view's URL
 */
export default function BuildCompare({ builds, parts, links, aKey, bKey, onChange, backTo }) {
  const rows = useMemo(() => compareBuildRows(parts, links, aKey, bKey), [parts, links, aKey, bKey]);
  const a = builds.find((b) => b.key === aKey) ?? null;
  const b = builds.find((x) => x.key === bKey) ?? null;
  const aName = a ? buildLabel(a) : 'Build A';
  const bName = b ? buildLabel(b) : 'Build B';

  return (
    <section className="build-panel compare-view" aria-labelledby="compare-title">
      <div className="build-panel-header">
        <h2 id="compare-title" className="build-panel-title">Compare Builds</h2>
        <Link to={backTo} className="btn btn-secondary">
          <span aria-hidden="true">← </span>Back to BOM
        </Link>
      </div>
      <div className="compare-pickers">
        <select
          className="select-inline"
          aria-label="First Build"
          value={aKey ?? ''}
          onChange={(e) => onChange(e.target.value, bKey)}
        >
          {builds.map((x) => <option key={x.key} value={x.key}>{option(x)}</option>)}
        </select>
        <span className="text-muted">vs</span>
        <select
          className="select-inline"
          aria-label="Second Build"
          value={bKey ?? ''}
          onChange={(e) => onChange(aKey, e.target.value)}
        >
          {builds.map((x) => <option key={x.key} value={x.key}>{option(x)}</option>)}
        </select>
      </div>
      <div className="parts-table-wrap">
        <table className="table parts-table compare-table">
          <caption className="visually-hidden">{aName} compared with {bName}</caption>
          <thead>
            <tr>
              <th scope="col" className="cell-part">Part</th>
              <th scope="col">Qty</th>
              <th scope="col">{aName}</th>
              <th scope="col">{bName}</th>
              <th scope="col"><span className="visually-hidden">Difference</span></th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr><td colSpan={5} className="table-empty">Neither Build has any Parts yet.</td></tr>
            )}
            {rows.map(({ part, inA, inB, shared }) => (
              <tr key={part.key} className="part-row">
                <th scope="row" className="cell-part">
                  <span className="part-key"><TrackerKey issueKey={part.key} /></span>
                  <span className="mono-key part-number">{part.fullPartNumber}</span>
                  <span className="part-name">{part.name ?? part.summary}</span>
                </th>
                <td>{part.quantity}</td>
                <td className="cell-mark"><Mark inBuild={inA} name={aName} /></td>
                <td className="cell-mark"><Mark inBuild={inB} name={bName} /></td>
                <td className="status-text">{shared ? 'Same' : `Only in ${inA ? aName : bName}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
