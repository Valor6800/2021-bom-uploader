import { useEffect, useState } from 'react';
import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import { fetchFileStatus, makeMissingFiles } from '../../api/client.js';
import { friendlyClause } from '../../lib/friendlyError.js';
import { missingText } from '../../lib/missingFiles.js';

/**
 * A cut Build's Parts that lack some of the cut's files (a picture, their
 * drawings, a routed plate's DXF, a 3D print's STEP), with a button that
 * makes just those in the background and refreshes the page when they're on.
 * Shows nothing for a Draft or when every Part has its files.
 *
 * @param {object} props
 * @param {object} props.build       The selected Build
 * @param {object[]} props.parts     The Build's Parts (`filesMissing` from the server)
 * @param {() => void} props.onDone  Read the Parts again
 */
export default function MissingFiles({ build, parts, onDone }) {
  const [watching, setWatching] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  useEffect(() => { setWatching([]); setError(null); }, [build?.key]);

  useEffect(() => {
    if (watching.length === 0) return undefined;
    let live = true;
    const timer = setInterval(async () => {
      try {
        const { statuses } = await fetchFileStatus(watching);
        if (!live) return;
        const still = watching.filter((k) => statuses?.[k]?.state === 'pending');
        if (still.length === 0) onDone();
        setWatching(still);
      } catch {
        // Asked again on the next tick.
      }
    }, 4000);
    return () => { live = false; clearInterval(timer); };
  }, [watching, onDone]);

  if (!build || build.status === 'Draft') return null;
  const lacking = parts.filter((p) => p.filesMissing?.length);
  if (lacking.length === 0) return null;

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const { queued } = await makeMissingFiles(build.key);
      setWatching(queued);
      if (queued.length === 0) onDone();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const making = watching.length > 0;
  return (
    <Alert
      variant={error ? 'warning' : 'info'}
      role="status"
      actions={(
        <Button variant="secondary" onClick={run} disabled={busy || making}>
          {making ? 'Making files…' : 'Make missing files'}
        </Button>
      )}
    >
      {missingText(lacking)}
      {making && ' They go on in the background; this page updates when they are on.'}
      {error && ` Couldn't start: ${friendlyClause(error)}`}
    </Alert>
  );
}
