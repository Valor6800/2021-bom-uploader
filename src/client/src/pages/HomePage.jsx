import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import Alert from '../components/ui/Alert.jsx';
import Button from '../components/ui/Button.jsx';
import EmptyState from '../components/ui/EmptyState.jsx';
import AssemblySearch from '../components/home/AssemblySearch.jsx';
import AssemblyResultList from '../components/home/AssemblyResultList.jsx';
import ChooserDialog from '../components/home/ChooserDialog.jsx';
import OnboardBox from '../components/home/OnboardBox.jsx';
import { searchAssemblies } from '../api/client.js';
import { friendlyError } from '../lib/friendlyError.js';

const DEBOUNCE_MS = 250;

const countLabel = (n) => `${n} ${n === 1 ? 'Assembly' : 'Assemblies'}`;

/**
 * Home `/` (design 3.1): find an Assembly, or add one from its OnShape link.
 * The query and the "Include closed" toggle live in the URL (`?q=`,
 * `?closed=1`), so a shared link shows the same list.
 */
export default function HomePage() {
  const [params, setParams] = useSearchParams();
  const [text, setText] = useState(() => params.get('q') ?? '');
  // The query actually searched: the text after the debounce.
  const [query, setQuery] = useState(() => (params.get('q') ?? '').trim());
  const [includeClosed, setIncludeClosed] = useState(() => params.get('closed') === '1');
  const [attempt, setAttempt] = useState(0);
  const [search, setSearch] = useState({ status: 'loading', data: null, error: null });
  const [chosen, setChosen] = useState(null);

  useEffect(() => {
    const next = text.trim();
    if (next === query) return undefined;
    const timer = setTimeout(() => setQuery(next), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [text, query]);

  useEffect(() => {
    const controller = new AbortController();
    // Deferred a tick, so React StrictMode's throwaway first run never sends.
    const timer = setTimeout(async () => {
      setSearch((s) => ({ ...s, status: 'loading' }));
      try {
        const data = await searchAssemblies(query, { includeClosed, signal: controller.signal });
        setSearch({ status: 'ready', data, error: null });
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setSearch({ status: 'error', data: null, error: err });
      }
    }, 0);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query, includeClosed, attempt]);

  useEffect(() => {
    const next = new URLSearchParams();
    if (query) next.set('q', query);
    if (includeClosed) next.set('closed', '1');
    if (next.toString() !== params.toString()) setParams(next, { replace: true });
    // Only our own state drives the URL; depending on params here would loop.
  }, [query, includeClosed]);

  const clear = () => {
    setText('');
    setQuery('');
  };
  const toggleClosed = (on) => {
    setIncludeClosed(on);
    // Re-run the current text at once, without waiting for the debounce.
    setQuery(text.trim());
  };

  const { data } = search;
  const total = data?.total ?? 0;
  const countText = search.status === 'ready' ? countLabel(total) : '';

  let body;
  if (search.status === 'error') {
    body = (
      <Alert
        variant="error"
        role="alert"
        actions={<Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Retry</Button>}
      >
        <p>Couldn&apos;t load Assemblies:</p>
        <p>{friendlyError(search.error)}</p>
      </Alert>
    );
  } else if (!data) {
    body = <p className="page-loading">Loading Assemblies…</p>;
  } else if (total === 0 && !data.query) {
    body = (
      <EmptyState title="No Assemblies yet.">
        An Assembly is one mechanism, like the intake. Paste its OnShape assembly link above to
        add the first one.
      </EmptyState>
    );
  } else if (total === 0) {
    body = (
      <EmptyState title={`No Assembly matches "${data.query}".`}>
        Check the spelling, or paste its OnShape link above to add it.
      </EmptyState>
    );
  } else {
    body = (
      <>
        <AssemblyResultList
          results={data.results}
          groups={data.groups}
          onChoose={(assembly) => setChosen(assembly)}
        />
        {total > data.results.length && (
          <p className="form-help">
            Showing {data.results.length} of {total}. Add more words to narrow it.
          </p>
        )}
      </>
    );
  }

  return (
    <div className="home-page">
      <AssemblySearch
        value={text}
        onChange={setText}
        onClear={clear}
        includeClosed={includeClosed}
        onIncludeClosedChange={toggleClosed}
        countText={countText}
      />
      <OnboardBox />
      <div className="home-results" aria-busy={search.status === 'loading' ? 'true' : undefined}>
        {body}
      </div>
      <ChooserDialog assembly={chosen} onClose={() => setChosen(null)} />
    </div>
  );
}
