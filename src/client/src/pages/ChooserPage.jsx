import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import AssemblyLoadError from '../components/assembly-shared/AssemblyLoadError.jsx';
import { ChooserOptions, assemblyMetaLine, assemblyTitle } from '../components/home/ChooserDialog.jsx';
import { fetchEpicByKey } from '../api/client.js';

/**
 * `/a/:key`: the chooser as a page, so the team can share a link and let the
 * receiver pick Designer or Assembly (design 3.2).
 */
export default function ChooserPage() {
  const { key } = useParams();
  const [state, setState] = useState({ assembly: null, error: null });

  const load = useCallback(() => {
    let live = true;
    setState({ assembly: null, error: null });
    fetchEpicByKey(key)
      .then((assembly) => { if (live) setState({ assembly, error: null }); })
      .catch((error) => { if (live) setState({ assembly: null, error }); });
    return () => { live = false; };
  }, [key]);

  useEffect(() => load(), [load]);

  if (state.error) {
    return <AssemblyLoadError assemblyKey={key} error={state.error} onRetry={load} />;
  }
  if (!state.assembly) return <p className="page-loading">Loading Assembly…</p>;

  const { assembly } = state;
  return (
    <section className="chooser-page" aria-labelledby="chooser-title">
      <Link to="/" className="back-link">← All Assemblies</Link>
      <h1 id="chooser-title" className="assembly-title">{assemblyTitle(assembly)}</h1>
      <p className="assembly-meta">{assemblyMetaLine(assembly)}</p>
      <ChooserOptions assemblyKey={assembly.key} headingId="chooser-page-question" questionLevel="h2" />
    </section>
  );
}
