import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import Alert from '../ui/Alert.jsx';
import Button from '../ui/Button.jsx';
import { previewOnboarding, onboardAssembly } from '../../api/client.js';
import { friendlyClause, friendlyError } from '../../lib/friendlyError.js';
import SubAssemblyList from './SubAssemblyList.jsx';
import { ConfirmDialog, ConflictDialog, ExistsDialog, PropertiesDialog } from './OnboardDialogs.jsx';

const WORKSPACE_LINK_RE = /\/documents\/[a-f0-9]{24}\/w\/[a-f0-9]{24}\/e\/[a-f0-9]{24}/i;
const VERSION_LINK_RE = /\/documents\/[a-f0-9]+\/[vm]\/[a-f0-9]+/i;

/**
 * Check a pasted link's shape before any request.
 * @param {string} url
 * @returns {string|null} the problem, or null when it looks usable
 */
export function checkOnshapeLink(url) {
  const text = url.trim();
  if (!text) return 'Paste the OnShape assembly link first.';
  if (VERSION_LINK_RE.test(text)) return 'Use the link to the workspace (it has /w/ in it), not a version.';
  if (!WORKSPACE_LINK_RE.test(text)) {
    return "That doesn't look like an OnShape assembly link. Open the assembly tab in OnShape and copy the address bar.";
  }
  return null;
}

/**
 * "New Assembly from OnShape" (design 3.3): link box, preview, dialogs A to
 * D, inline error F, and the hand-off to the Designer.
 */
export default function OnboardBox() {
  const navigate = useNavigate();
  const inputRef = useRef(null);
  const [url, setUrl] = useState('');
  const [checking, setChecking] = useState(false);
  /** Inline error F: { text, retry } */
  const [inline, setInline] = useState(null);
  /**
   * The open dialog:
   * { kind: 'confirm', proposed, drifted, subAssemblies } | { kind: 'exists', assembly, matchedOn, subAssemblies }
   * | { kind: 'problems', problems, fallback } | { kind: 'conflict', assembly, number }
   */
  const [dialog, setDialog] = useState(null);
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);
  /** After adding sub-assemblies to an Assembly that already existed. */
  const [subResult, setSubResult] = useState(null);
  const sentUrl = useRef('');

  const closeDialog = () => {
    setDialog(null);
    setCreateError(null);
  };

  const showError = (err, prefix) => {
    if (err?.status === 400 && err.body?.problems?.length) {
      setDialog({ kind: 'problems', problems: err.body.problems, fallback: err.message });
      return true;
    }
    if (err?.status === 409 && err.body?.assembly) {
      setDialog({
        kind: 'conflict',
        assembly: err.body.assembly,
        number: err.body.proposed?.fullPartNumber ?? err.body.assembly.fullPartNumber ?? err.body.assembly.key,
      });
      return true;
    }
    if (err?.status === 409 && err.body?.proposed) {
      setDialog({ kind: 'confirm', proposed: err.body.proposed, drifted: true });
      return true;
    }
    if (prefix === null) return false;
    // A 400 is our own student copy (bad link, not an assembly tab).
    setInline({ text: err?.status === 400 ? err.message : `${prefix}: ${friendlyClause(err)}` });
    return true;
  };

  const runPreview = async () => {
    const problem = checkOnshapeLink(url);
    if (problem) {
      setInline({ text: problem, local: true });
      inputRef.current?.focus();
      return;
    }
    setInline(null);
    setChecking(true);
    sentUrl.current = url.trim();
    try {
      const res = await previewOnboarding(sentUrl.current);
      const subs = { subAssemblies: res.subAssemblies ?? [], subAssembliesError: res.subAssembliesError ?? null };
      if (res.status === 'exists') {
        setDialog({ kind: 'exists', assembly: res.assembly, matchedOn: res.matchedOn, ...subs });
      } else {
        setDialog({ kind: 'confirm', proposed: res.proposed, drifted: false, ...subs });
      }
    } catch (err) {
      showError(err, "Couldn't check that link");
    } finally {
      setChecking(false);
    }
  };

  const openDesigner = (assembly, { build = null, buildError = null, alreadyAdded = false, subAssemblies = [] } = {}) => {
    const base = `/a/${encodeURIComponent(assembly.key)}/design`;
    const onboard = { assemblySummary: assembly.summary };
    let to = base;
    if (build) {
      onboard.build = build;
      // Only the call that created Build 1 reads Parts from CAD.
      to = `${base}?build=${encodeURIComponent(build.key)}${alreadyAdded ? '' : '&cad=1'}`;
    }
    if (buildError) onboard.buildError = buildError;
    if (alreadyAdded) onboard.alreadyAdded = true;
    if (subAssemblies.length) onboard.subAssemblies = subAssemblies;
    navigate(to, { state: { onboard } });
  };

  const create = async () => {
    if (dialog?.kind !== 'confirm') return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await onboardAssembly({ url: sentUrl.current, expectedSummary: dialog.proposed.summary });
      if (res.status === 'created') {
        openDesigner(res.assembly, {
          build: res.build,
          buildError: res.build ? null : res.buildError,
          subAssemblies: res.subAssemblies ?? [],
        });
      } else {
        // Another tab or a double submit won the race (design 3.3, B from the commit call).
        openDesigner(res.assembly, { build: res.build, alreadyAdded: true });
      }
    } catch (err) {
      if (!showError(err, null)) {
        setCreateError(`Couldn't create the Assembly: ${friendlyError(err)} Nothing was saved. Try again.`);
      }
    } finally {
      setCreating(false);
    }
  };

  /** The Assembly already exists: create only its missing sub-assemblies. */
  const createMissing = async () => {
    if (dialog?.kind !== 'exists') return;
    setCreating(true);
    setCreateError(null);
    try {
      const res = await onboardAssembly({ url: sentUrl.current, expectedSummary: dialog.assembly.summary });
      setSubResult({ assembly: res.assembly, subAssemblies: res.subAssemblies ?? [], error: res.subAssembliesError ?? null });
      setDialog(null);
    } catch (err) {
      setCreateError(`Couldn't create the sub-assemblies: ${friendlyError(err)} Try again.`);
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="onboard-box" aria-labelledby="onboard-heading">
      <h2 id="onboard-heading" className="home-subheading">New Assembly from OnShape</h2>
      <form
        className="search-row"
        // The local check below gives student copy; skip the browser's bubble.
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          if (!checking) runPreview();
        }}
      >
        <label htmlFor="onboard-url" className="visually-hidden">OnShape assembly link</label>
        <input
          ref={inputRef}
          id="onboard-url"
          type="url"
          inputMode="url"
          className="text-input onboard-input"
          placeholder="Paste the OnShape assembly link…"
          autoComplete="off"
          spellCheck={false}
          maxLength={2000}
          value={url}
          aria-invalid={inline ? 'true' : undefined}
          aria-describedby={inline ? 'onboard-error' : undefined}
          onChange={(e) => { setUrl(e.target.value); if (inline?.local) setInline(null); }}
        />
        <Button type="submit" variant="primary" disabled={checking}>
          {checking ? 'Checking…' : 'Continue'}
        </Button>
      </form>
      {subResult && (
        <Alert
          variant="info"
          role="status"
          actions={(
            <Button variant="secondary" onClick={() => navigate(`/a/${encodeURIComponent(subResult.assembly.key)}/design`)}>
              Open {subResult.assembly.key}
            </Button>
          )}
        >
          <SubAssemblyList subAssemblies={subResult.subAssemblies} error={subResult.error} />
        </Alert>
      )}
      {inline && (
        <Alert
          variant="error"
          role="alert"
          id="onboard-error"
          actions={inline.local ? null : <Button variant="secondary" onClick={runPreview} disabled={checking}>Try again</Button>}
        >
          {inline.text}
        </Alert>
      )}

      <ConfirmDialog
        open={dialog?.kind === 'confirm'}
        proposed={dialog?.kind === 'confirm' ? dialog.proposed : null}
        drifted={dialog?.kind === 'confirm' && dialog.drifted}
        busy={creating}
        error={createError}
        onCancel={closeDialog}
        returnFocusRef={inputRef}
        onConfirm={create}
        subAssemblies={dialog?.kind === 'confirm' ? dialog.subAssemblies : []}
        subAssembliesError={dialog?.kind === 'confirm' ? dialog.subAssembliesError : null}
      />
      <ExistsDialog
        open={dialog?.kind === 'exists'}
        assembly={dialog?.kind === 'exists' ? dialog.assembly : null}
        matchedOn={dialog?.matchedOn}
        onCancel={closeDialog}
        returnFocusRef={inputRef}
        onOpen={() => navigate(`/a/${encodeURIComponent(dialog.assembly.key)}/design`)}
        subAssemblies={dialog?.kind === 'exists' ? dialog.subAssemblies : []}
        subAssembliesError={dialog?.kind === 'exists' ? dialog.subAssembliesError : null}
        busy={creating}
        error={dialog?.kind === 'exists' ? createError : null}
        onCreateMissing={createMissing}
      />
      <PropertiesDialog
        open={dialog?.kind === 'problems'}
        problems={dialog?.kind === 'problems' ? dialog.problems : null}
        fallback={dialog?.fallback}
        onClose={closeDialog}
        returnFocusRef={inputRef}
      />
      <ConflictDialog
        open={dialog?.kind === 'conflict'}
        number={dialog?.kind === 'conflict' ? dialog.number : ''}
        assembly={dialog?.kind === 'conflict' ? dialog.assembly : null}
        onCancel={closeDialog}
        returnFocusRef={inputRef}
        onOpen={() => navigate(`/a/${encodeURIComponent(dialog.assembly.key)}`)}
      />
    </section>
  );
}
