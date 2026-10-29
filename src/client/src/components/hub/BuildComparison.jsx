import { useState, useMemo } from 'react';
import Card from '../ui/Card.jsx';
import Select from '../ui/Select.jsx';

/**
 * Side-by-side of two Builds' BOMs (Sheet 06), so "which bash bar do I
 * grab" has a direct answer. Derived entirely from the hub's already-loaded
 * part list — each part knows which Builds it's linked to.
 */
export default function BuildComparison({ builds, parts }) {
  const [aKey, setAKey] = useState('');
  const [bKey, setBKey] = useState('');

  const rows = useMemo(() => {
    if (!aKey || !bKey) return [];
    return parts
      .filter((p) => p.linkedBuildKeys.includes(aKey) || p.linkedBuildKeys.includes(bKey))
      .map((p) => {
        const inA = p.linkedBuildKeys.includes(aKey);
        const inB = p.linkedBuildKeys.includes(bKey);
        return { part: p, inA, inB, shared: inA && inB };
      })
      .sort((x, y) => Number(y.shared) - Number(x.shared) || x.part.summary.localeCompare(y.part.summary));
  }, [aKey, bKey, parts]);

  const labelFor = (key) => builds.find((b) => b.key === key)?.summary ?? key;

  return (
    <Card title="Compare builds" icon="⇄" collapsible defaultCollapsed className="mb-8">
      <div className="card-body">
        <div className="grid-3 mb-4">
          <Select label="Build A" id="compareA" value={aKey} onChange={(e) => setAKey(e.target.value)}>
            <option value="">Select build...</option>
            {builds.map((b) => <option key={b.key} value={b.key}>{b.summary} ({b.status})</option>)}
          </Select>
          <Select label="Build B" id="compareB" value={bKey} onChange={(e) => setBKey(e.target.value)}>
            <option value="">Select build...</option>
            {builds.map((b) => <option key={b.key} value={b.key}>{b.summary} ({b.status})</option>)}
          </Select>
        </div>

        {aKey && bKey && (
          <div className="table-wrapper">
            <table className="table">
              <thead>
                <tr>
                  <th>Part</th>
                  <th>Qty</th>
                  <th>{labelFor(aKey)}</th>
                  <th>{labelFor(bKey)}</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={4} className="table-empty">Neither build has any parts yet.</td></tr>
                )}
                {rows.map(({ part, inA, inB }) => (
                  <tr key={part.key}>
                    <td className="text-light">{part.summary}</td>
                    <td>{part.quantity}</td>
                    <td>{inA ? '✓' : <span className="text-dim">—</span>}</td>
                    <td>{inB ? '✓' : <span className="text-dim">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Card>
  );
}
