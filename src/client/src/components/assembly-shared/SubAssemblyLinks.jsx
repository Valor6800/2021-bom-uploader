import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { fetchSubAssemblies } from '../../api/client.js';
import { friendlyClause } from '../../lib/friendlyError.js';
import { TrackerKey } from './AssemblyHeader.jsx';

/**
 * The sub-assemblies of this Assembly, each a link to that Assembly's own
 * page in the same mode (Designer or Assembly). Read from the Assembly's
 * OnShape BOM, so it follows the CAD. Shows nothing when there are none.
 *
 * A sub-assembly nobody has added yet has no page to link to; it is listed
 * as not added yet.
 *
 * @param {object} props
 * @param {string} props.assemblyKey
 * @param {'design'|'assemble'} props.mode  Which page the links open
 */
export default function SubAssemblyLinks({ assemblyKey, mode }) {
  const [state, setState] = useState({ loading: true, subs: [], error: null });

  useEffect(() => {
    let live = true;
    setState({ loading: true, subs: [], error: null });
    fetchSubAssemblies(assemblyKey)
      .then((res) => {
        if (live) setState({ loading: false, subs: res.subAssemblies ?? [], error: res.error ?? null });
      })
      .catch((err) => {
        if (live) setState({ loading: false, subs: [], error: friendlyClause(err) });
      });
    return () => { live = false; };
  }, [assemblyKey]);

  if (state.loading) return null;
  if (state.error) {
    return (
      <p className="sub-assemblies-note no-print" role="status">
        Sub-assemblies couldn&apos;t be read ({state.error}).
      </p>
    );
  }
  // The Assembly page links only to sub-assemblies that exist; adding one is the Designer's job.
  const subs = mode === 'assemble' ? state.subs.filter((sub) => sub.status === 'exists') : state.subs;
  if (subs.length === 0) return null;

  return (
    <section className="sub-assemblies no-print" aria-labelledby="sub-assemblies-heading">
      <h2 id="sub-assemblies-heading" className="sub-assemblies-title">
        Sub-assemblies <span className="group-count">{subs.length}</span>
      </h2>
      <ul className="sub-assembly-list">
        {subs.map((sub, i) => (
          <li key={`${sub.name}-${i}`} className="sub-assembly-item" data-sub-status={sub.status}>
            {sub.status === 'exists' ? (
              <>
                <Link to={`/a/${encodeURIComponent(sub.assembly.key)}/${mode}`} className="sub-assembly-link">
                  {sub.assembly.summary}
                </Link>
                <TrackerKey issueKey={sub.assembly.key} />
              </>
            ) : (
              <>
                <span>{sub.name}</span>
                <span className="text-muted">Not added yet</span>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
