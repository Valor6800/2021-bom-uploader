import { useRef } from 'react';
import Dialog from '../ui/Dialog.jsx';
import Button from '../ui/Button.jsx';
import { buildLabel, listLabels } from '../../lib/buildNames.js';

/**
 * Confirm for Cut Version (Designer only). Stays open on failure and shows
 * the error inside; a 409 ("already cut") offers only Close.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {object|null} props.build
 * @param {object[]} props.toSupersede   Other Active Builds this cut supersedes
 * @param {boolean} props.busy
 * @param {string|null} props.error
 * @param {boolean} props.alreadyCut
 * @param {() => void} props.onConfirm
 * @param {() => void} props.onClose
 */
export default function CutVersionDialog({
  open, build, toSupersede, busy, error, alreadyCut, onConfirm, onClose,
}) {
  const cancelRef = useRef(null);
  if (!build) return null;
  const label = buildLabel(build);
  return (
    <Dialog
      open={open}
      onClose={busy ? () => {} : onClose}
      title={`Cut ${label}'s version?`}
      initialFocusRef={cancelRef}
      footer={alreadyCut ? (
        <Button ref={cancelRef} variant="secondary" onClick={onClose}>Close</Button>
      ) : (
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button variant="primary" onClick={onConfirm} disabled={busy}>
            {busy ? 'Cutting…' : error ? 'Try again' : 'Cut Version'}
          </Button>
        </>
      )}
    >
      <p>
        This makes a version in OnShape named {build.key}, marks {label} <strong>Active</strong> (the one to build)
        {toSupersede.length > 0 && <>, and marks {listLabels(toSupersede)} <strong>Superseded</strong></>}.
        {' '}You can&apos;t undo this here.
      </p>
      {error && <p className="form-error" role="alert">{error}</p>}
    </Dialog>
  );
}
