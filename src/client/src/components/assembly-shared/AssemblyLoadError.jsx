import { Link } from 'react-router-dom';
import Button from '../ui/Button.jsx';
import EmptyState from '../ui/EmptyState.jsx';
import { friendlyClause } from '../../lib/friendlyError.js';

/**
 * The full-page card when the Assembly itself can't be read (design 3.6).
 * A 404 or 400 won't change on retry, so only a 5xx or no-connection
 * error offers Retry.
 *
 * @param {object} props
 * @param {string} props.assemblyKey
 * @param {Error & { status?: number }} props.error
 * @param {() => void} props.onRetry
 */
export default function AssemblyLoadError({ assemblyKey, error, onRetry }) {
  const status = error?.status;
  const back = <Link to="/" className="btn btn-secondary">Back to all Assemblies</Link>;
  if (status === 404 || status === 400) {
    return (
      <EmptyState
        headingLevel="h1"
        title={status === 404 ? `We couldn't find Assembly ${assemblyKey}.` : error.message}
        action={back}
      />
    );
  }
  return (
    <EmptyState
      headingLevel="h1"
      title={`Couldn't open this Assembly: ${friendlyClause(error)}`}
      action={(
        <>
          <Button variant="primary" onClick={onRetry}>Retry</Button>
          {back}
        </>
      )}
    />
  );
}
