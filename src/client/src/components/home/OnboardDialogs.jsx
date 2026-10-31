import { useRef } from 'react';
import Dialog from '../ui/Dialog.jsx';
import Button from '../ui/Button.jsx';

/**
 * Dialogs A to D of the onboarding flow (design 3.3). Each is a ui/Dialog;
 * OnboardBox decides which one is open.
 */

/** A. Confirm a new Assembly. */
export function ConfirmDialog({ open, proposed, drifted, busy, error, onCancel, onConfirm, returnFocusRef }) {
  const confirmRef = useRef(null);
  return (
    <Dialog
      open={open}
      // Closing mid-request would hide whether the Assembly was made.
      onClose={busy ? () => {} : onCancel}
      title="Create a new Assembly?"
      returnFocusRef={returnFocusRef}
      initialFocusRef={confirmRef}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button
            ref={confirmRef}
            variant="primary"
            onClick={onConfirm}
            disabled={busy}
            aria-describedby={error ? 'onboard-create-error' : undefined}
          >
            {busy ? (<><span className="spinner" aria-hidden="true" /> Creating…</>) : 'Create Assembly and Build 1'}
          </Button>
        </>
      )}
    >
      {proposed && (
        <div className="onboard-dialog">
          {drifted && (
            <p className="onboard-drift" role="status">The name in OnShape changed since you checked.</p>
          )}
          <p className="onboard-proposed">
            <span className="mono-key">{proposed.fullPartNumber}</span> {proposed.name}
          </p>
          <p className="text-muted">{[proposed.seasonLabel, `Revision ${proposed.revision}`].filter(Boolean).join(' · ')}</p>
          <p>Creates this Assembly and its Build 1 (Draft), then opens the Designer.</p>
          {error && <p id="onboard-create-error" className="form-error" role="alert">{error}</p>}
        </div>
      )}
    </Dialog>
  );
}

/** B. The OnShape assembly was onboarded before. */
export function ExistsDialog({ open, assembly, matchedOn, onCancel, onOpen, returnFocusRef }) {
  const openRef = useRef(null);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title="This Assembly is already here"
      returnFocusRef={returnFocusRef}
      initialFocusRef={openRef}
      footer={(
        <>
          <Button variant="secondary" onClick={onCancel}>Cancel</Button>
          <Button ref={openRef} variant="primary" onClick={onOpen}>Open in Designer</Button>
        </>
      )}
    >
      {assembly && (
        <div className="onboard-dialog">
          <p className="onboard-proposed">
            {assembly.summary} <span className="mono-key">({assembly.key})</span>
          </p>
          <p>
            {matchedOn === 'document'
              ? 'That OnShape assembly was added before from another branch of this document, so nothing new will be created.'
              : 'That OnShape assembly was added before, so nothing new will be created.'}
          </p>
        </div>
      )}
    </Dialog>
  );
}

/** One `problems[]` entry as a line: "Part number "12": needs 4 digits, e.g. 0001". */
export function problemText(p) {
  if (p.issue === 'missing') return `${p.property}: missing (${p.hint})`;
  return `${p.property} "${p.value}": needs ${p.hint}`;
}

/** C. The assembly's OnShape properties are incomplete. */
export function PropertiesDialog({ open, problems, fallback, onClose, returnFocusRef }) {
  const okRef = useRef(null);
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={<><span aria-hidden="true">⚠ </span>Can&apos;t add this assembly yet</>}
      returnFocusRef={returnFocusRef}
      initialFocusRef={okRef}
      footer={<Button ref={okRef} variant="primary" onClick={onClose}>Got it</Button>}
    >
      <div className="onboard-dialog">
        {problems?.length ? (
          <>
            <p>Fill these in the assembly&apos;s Properties dialog in OnShape, then try again:</p>
            <ul className="onboard-problems">
              {problems.map((p) => <li key={p.property}>{problemText(p)}</li>)}
            </ul>
          </>
        ) : (
          <p>{fallback}</p>
        )}
      </div>
    </Dialog>
  );
}

/** D. The number already belongs to another Assembly. */
export function ConflictDialog({ open, number, assembly, onCancel, onOpen, returnFocusRef }) {
  const cancelRef = useRef(null);
  return (
    <Dialog
      open={open}
      onClose={onCancel}
      title={<><span aria-hidden="true">⚠ </span>{number} is already used</>}
      returnFocusRef={returnFocusRef}
      initialFocusRef={cancelRef}
      footer={(
        <>
          <Button ref={cancelRef} variant="secondary" onClick={onCancel}>Cancel</Button>
          {assembly && <Button variant="primary" onClick={onOpen}>Open {assembly.key}</Button>}
        </>
      )}
    >
      {assembly && (
        <div className="onboard-dialog">
          <p>
            <span className="mono-key">{assembly.key}</span> &quot;{assembly.summary}&quot; has this number
            but a different OnShape assembly. Change the Part number in OnShape, or
            open {assembly.key} if it&apos;s the same thing.
          </p>
        </div>
      )}
    </Dialog>
  );
}
