import { useEffect, useId, useRef, useState } from 'react';
import Button from '../ui/Button.jsx';
import { buildLabel, buildSummaryPreview } from '../../lib/buildNames.js';

/**
 * Inline "+ New Build" panel. Focus moves to Name when it opens. The line
 * under the description previews the name the server will give the Build.
 *
 * @param {object} props
 * @param {string} props.defaultName     The Assembly name
 * @param {number} props.nextNumber      Display only; the server assigns it
 * @param {object[]} props.copyFrom      Builds whose Parts may be copied
 * @param {string|null} [props.defaultCopyKey]
 * @param {boolean} props.busy
 * @param {string|null} props.error      Text shown under the form
 * @param {(values: { name: string, description: string, cloneFromBuildKey?: string }) => void} props.onCreate
 * @param {() => void} props.onCancel
 */
export default function NewBuildForm({
  defaultName, nextNumber, copyFrom, defaultCopyKey = null, busy, error, onCreate, onCancel,
}) {
  const [name, setName] = useState(defaultName);
  const [description, setDescription] = useState('');
  const [start, setStart] = useState('empty');
  const [copyKey, setCopyKey] = useState(defaultCopyKey ?? copyFrom[0]?.key ?? '');
  const nameRef = useRef(null);
  const ids = useId();
  const errorId = `${ids}-error`;

  useEffect(() => { nameRef.current?.focus(); }, []);

  const trimmed = name.trim();
  const submit = (e) => {
    e.preventDefault();
    if (!trimmed || busy) return;
    onCreate({
      name: trimmed,
      description,
      cloneFromBuildKey: start === 'copy' && copyKey ? copyKey : undefined,
    });
  };

  return (
    <form id="new-build-form" className="new-build-form" onSubmit={submit} aria-labelledby={`${ids}-title`}>
      <h3 id={`${ids}-title`} className="new-build-title">New Build</h3>
      <div className="form-row">
        <label htmlFor={`${ids}-name`} className="form-label">Name</label>
        <input
          ref={nameRef}
          id={`${ids}-name`}
          className="text-input"
          value={name}
          maxLength={80}
          required
          onChange={(e) => setName(e.target.value)}
        />
      </div>
      <div className="form-row">
        <label htmlFor={`${ids}-desc`} className="form-label">What&apos;s different? <span className="text-muted">(optional)</span></label>
        <input
          id={`${ids}-desc`}
          className="text-input"
          value={description}
          maxLength={60}
          aria-describedby={`${ids}-preview`}
          onChange={(e) => setDescription(e.target.value)}
        />
      </div>
      <p id={`${ids}-preview`} className="new-build-preview" data-testid="new-build-preview">
        <span aria-hidden="true">→ </span>&quot;{buildSummaryPreview(trimmed || defaultName, nextNumber, description)}&quot;
      </p>
      <fieldset className="form-row new-build-start">
        <legend className="form-label">Start</legend>
        <label className="radio-label">
          <input type="radio" name={`${ids}-start`} value="empty" checked={start === 'empty'} onChange={() => setStart('empty')} />
          Empty
        </label>
        <label className="radio-label">
          <input
            type="radio"
            name={`${ids}-start`}
            value="copy"
            checked={start === 'copy'}
            disabled={copyFrom.length === 0}
            onChange={() => setStart('copy')}
          />
          Copy Parts from
        </label>
        <select
          className="select-inline"
          aria-label="Copy Parts from"
          value={copyKey}
          disabled={start !== 'copy' || copyFrom.length === 0}
          onChange={(e) => setCopyKey(e.target.value)}
        >
          {copyFrom.map((b) => (
            <option key={b.key} value={b.key}>{buildLabel(b)} · {b.status}</option>
          ))}
        </select>
      </fieldset>
      {error && <p id={errorId} className="form-error" role="alert">{error}</p>}
      <div className="form-actions">
        <Button variant="secondary" onClick={onCancel} disabled={busy}>Cancel</Button>
        <Button
          type="submit"
          variant="primary"
          disabled={busy || !trimmed}
          aria-describedby={error ? errorId : undefined}
        >
          {busy ? 'Creating…' : `Create Build ${nextNumber}`}
        </Button>
      </div>
    </form>
  );
}
