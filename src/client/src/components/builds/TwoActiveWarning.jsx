import { useCallback, useEffect, useRef, useState } from 'react';
import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import Dialog from '../ui/Dialog.jsx';
import { cutBuildVersion, fetchBuildStatuses } from '../../api/client.js';
import { friendlyError } from '../../lib/friendlyError.js';
import {
  activeConflict, buildLabel, conflictSignature, cutErrorEntries, cutResultEntries, listLabels,
  repairCandidates, statusCheckEntries, statusCheckKeys, supersedeTargets,
} from '../../lib/buildNames.js';

/**
 * The "two Builds are Active" warning and its confirm-gated repair
 * (design 3.4, "Two Active Builds"), shared by the Designer and the
 * Assembly page.
 *
 * 1. Detect over the overlaid Builds. 2. Re-check those Builds by key
 * (search lags) once per distinct set, writing what it reads through
 * `onStatus`. 3. Offer a button only for a Build the server will accept.
 * 4. Confirm before anything is marked Superseded, with focus on Cancel.
 *
 * @param {object} props
 * @param {object[]} props.builds        Overlaid Builds of the selected Revision
 * @param {string|null} props.cutFailedKey  Build whose cut failed at the supersede stage this session
 * @param {string|null} props.documentId  The Assembly's OnShape document
 * @param {string} props.assemblyKey
 * @param {(entries: [string, object][]) => void} props.onStatus  Add to statusThisSession
 * @param {() => void} props.onResolved  A repair succeeded: clear cutFailedKey, re-fetch Builds
 */
export default function TwoActiveWarning({ builds, cutFailedKey, documentId, assemblyKey, onStatus, onResolved }) {
  const conflict = activeConflict(builds);
  const signature = conflictSignature(conflict);
  const [checked, setChecked] = useState(null);   // signature confirmed by key
  const [checking, setChecking] = useState(false);
  const [checkError, setCheckError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [chosen, setChosen] = useState(null);
  const [busy, setBusy] = useState(false);
  const [dialogError, setDialogError] = useState(null);
  const [noLongerActive, setNoLongerActive] = useState(false);
  const cancelRef = useRef(null);
  const onStatusRef = useRef(onStatus);
  onStatusRef.current = onStatus;
  const conflictRef = useRef(conflict);
  conflictRef.current = conflict;

  useEffect(() => {
    if (!signature || conflictRef.current.length < 2) {
      setChecking(false);
      setCheckError(false);
      return undefined;
    }
    let live = true;
    setChecking(true);
    setCheckError(false);
    fetchBuildStatuses(statusCheckKeys(conflictRef.current))
      .then((res) => {
        if (!live) return;
        onStatusRef.current(statusCheckEntries(res));
        setChecked(signature);
      })
      .catch(() => {
        if (live) setCheckError(true);
      })
      .finally(() => {
        if (live) setChecking(false);
      });
    return () => { live = false; };
  }, [signature, attempt]);

  const closeDialog = useCallback(() => {
    if (busy) return;
    setChosen(null);
    setDialogError(null);
    setNoLongerActive(false);
  }, [busy]);

  const confirm = async () => {
    if (!chosen) return;
    setBusy(true);
    setDialogError(null);
    try {
      const result = await cutBuildVersion(chosen.key, { assemblyKey });
      onStatus(cutResultEntries(chosen.key, result));
      setBusy(false);
      setChosen(null);
      onResolved();
    } catch (err) {
      setBusy(false);
      if (err?.status === 409) {
        onStatus(cutErrorEntries(chosen.key, err));
        setNoLongerActive(true);
        setChecked(null);
        setAttempt((n) => n + 1);
      } else {
        const others = listLabels(supersedeTargets(conflict, chosen.key));
        setDialogError(`Couldn't mark ${others} Superseded: ${friendlyError(err)} Try again.`);
      }
    }
  };

  if (conflict.length < 2 && !chosen) return null;

  let warning = null;
  if (conflict.length >= 2 && checkError) {
    warning = (
      <Alert
        variant="warning"
        role="status"
        className="two-active"
        actions={<Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>Check again</Button>}
      >
        Couldn&apos;t check whether {listLabels(conflict)} are {conflict.length > 2 ? 'all' : 'both'} Active.
      </Alert>
    );
  } else if (conflict.length >= 2 && !checking && checked === signature) {
    const candidates = repairCandidates({ conflict, cutFailedKey, documentId });
    warning = (
      <Alert variant="warning" role="alert" className="two-active">
        <p>{listLabels(conflict)} are {conflict.length > 2 ? 'all' : 'both'} Active. Only one should be.</p>
        {candidates.length === 0 ? (
          <p>ValorBOM didn&apos;t cut these versions, so it can&apos;t choose between them. Ask a mentor to fix it in the team tracker.</p>
        ) : (
          <div className="btn-group two-active-actions">
            {candidates.map(({ build, label }) => (
              <Button key={build.key} variant="secondary" onClick={() => setChosen(build)}>{label}</Button>
            ))}
          </div>
        )}
      </Alert>
    );
  }

  const targets = chosen ? supersedeTargets(conflict.length ? conflict : builds, chosen.key)
    .filter((b) => b.status === 'Active') : [];
  const chosenLabel = chosen ? buildLabel(chosen) : '';

  return (
    <>
      {warning}
      <Dialog
        open={!!chosen}
        onClose={closeDialog}
        title={`Make ${chosenLabel} the Active one?`}
        initialFocusRef={cancelRef}
        footer={noLongerActive ? (
          <Button ref={cancelRef} variant="secondary" onClick={closeDialog}>Close</Button>
        ) : (
          <>
            <Button ref={cancelRef} variant="secondary" onClick={closeDialog} disabled={busy}>Cancel</Button>
            <Button variant="danger-solid" onClick={confirm} disabled={busy}>
              {busy ? 'Marking…' : `Mark ${listLabels(targets) || 'the others'} Superseded`}
            </Button>
          </>
        )}
      >
        {noLongerActive ? (
          <p role="status">{chosenLabel} is no longer Active; nothing to fix.</p>
        ) : (
          <p>
            {listLabels(targets) || 'The other Builds'} will be marked Superseded. This can&apos;t be undone from ValorBOM.
          </p>
        )}
        {dialogError && <p className="form-error" role="alert">{dialogError}</p>}
      </Dialog>
    </>
  );
}
