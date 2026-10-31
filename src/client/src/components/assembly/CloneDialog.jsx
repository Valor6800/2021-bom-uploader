import { useEffect, useRef, useState } from 'react';
import Button from '../ui/Button.jsx';
import Dialog from '../ui/Dialog.jsx';

/**
 * "Clone a part" (design 3.5): a fresh Part with its own number, copying
 * another Part's fields. The Clone button stays disabled from the click
 * until the response, so one dialog can't send two requests.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {object[]} props.parts     Parts to copy from
 * @param {string|null} [props.defaultSourceKey]
 * @param {boolean} props.busy
 * @param {string|null} props.error
 * @param {(values: { sourceKey: string, name?: string, quantity?: number }) => void} props.onClone
 * @param {() => void} props.onClose
 */
export default function CloneDialog({ open, parts, defaultSourceKey, busy, error, onClone, onClose }) {
  const [sourceKey, setSourceKey] = useState('');
  const [name, setName] = useState('');
  const [quantity, setQuantity] = useState('');
  const firstRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSourceKey(defaultSourceKey ?? parts[0]?.key ?? '');
    setName('');
    setQuantity('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const qty = quantity === '' ? undefined : Number(quantity);
  const qtyBad = qty !== undefined && (!Number.isInteger(qty) || qty < 1);
  const nameBad = name.trim().length > 80;

  const submit = (e) => {
    e.preventDefault();
    if (busy || !sourceKey || qtyBad || nameBad) return;
    onClone({
      sourceKey,
      ...(name.trim() ? { name: name.trim() } : {}),
      ...(qty !== undefined ? { quantity: qty } : {}),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title="Clone a part"
      description="Makes a new Part with its own number and the same Material and Machinery. It isn't in any Build until you Move it here."
      initialFocusRef={firstRef}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="clone-form"
            disabled={busy || !sourceKey || qtyBad || nameBad}
            aria-describedby={error ? 'clone-error' : undefined}
          >
            {busy ? 'Cloning…' : 'Clone'}
          </Button>
        </>
      )}
    >
      <form id="clone-form" className="dialog-form" onSubmit={submit}>
        <div className="form-row">
          <label className="form-label" htmlFor="clone-source">Copy from</label>
          <select
            id="clone-source"
            ref={firstRef}
            className="select-inline"
            value={sourceKey}
            onChange={(e) => setSourceKey(e.target.value)}
            disabled={busy}
          >
            {parts.map((p) => (
              <option key={p.key} value={p.key}>{p.fullPartNumber ? `${p.fullPartNumber} ${p.name ?? ''}` : p.summary} · {p.key}</option>
            ))}
          </select>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="clone-name">New Part name (optional)</label>
          <input
            id="clone-name"
            type="text"
            className="text-input"
            maxLength={80}
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={busy}
            aria-describedby="clone-name-help"
          />
          <p id="clone-name-help" className="form-help">Leave blank to keep the same name.</p>
        </div>
        <div className="form-row">
          <label className="form-label" htmlFor="clone-qty">Quantity (optional)</label>
          <input
            id="clone-qty"
            type="number"
            min="1"
            step="1"
            className="text-input input-qty"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            disabled={busy}
            aria-invalid={qtyBad ? 'true' : undefined}
          />
          {qtyBad && <p className="form-error">Quantity must be a whole number, 1 or more.</p>}
        </div>
        {error && <p id="clone-error" className="form-error" role="alert">{error}</p>}
      </form>
    </Dialog>
  );
}
