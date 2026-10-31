import { useEffect, useRef, useState } from 'react';
import Button from '../ui/Button.jsx';
import Dialog from '../ui/Dialog.jsx';

/**
 * "Create spare": an exact copy of a Part (same number, name and Revision) as
 * a new ticket that is in no Build. The button stays disabled from the click
 * until the response, so one dialog can't send two requests.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {object[]} props.parts     Parts to copy from
 * @param {string|null} [props.defaultSourceKey]
 * @param {boolean} props.busy
 * @param {string|null} props.error
 * @param {(values: { sourceKey: string, quantity?: number }) => void} props.onClone
 * @param {() => void} props.onClose
 */
export default function CloneDialog({ open, parts, defaultSourceKey, busy, error, onClone, onClose }) {
  const [sourceKey, setSourceKey] = useState('');
  const [quantity, setQuantity] = useState('');
  const firstRef = useRef(null);

  useEffect(() => {
    if (!open) return;
    setSourceKey(defaultSourceKey ?? parts[0]?.key ?? '');
    setQuantity('');
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps

  const qty = quantity === '' ? undefined : Number(quantity);
  const qtyBad = qty !== undefined && (!Number.isInteger(qty) || qty < 1);

  const submit = (e) => {
    e.preventDefault();
    if (busy || !sourceKey || qtyBad) return;
    onClone({
      sourceKey,
      ...(qty !== undefined ? { quantity: qty } : {}),
    });
  };

  return (
    <Dialog
      open={open}
      onClose={() => { if (!busy) onClose(); }}
      title="Create spare"
      description="Makes an exact copy of a Part, with the same number and name. The copy isn't in any Build."
      initialFocusRef={firstRef}
      footer={(
        <>
          <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button
            variant="primary"
            type="submit"
            form="clone-form"
            disabled={busy || !sourceKey || qtyBad}
            aria-describedby={error ? 'clone-error' : undefined}
          >
            {busy ? 'Creating…' : 'Create spare'}
          </Button>
        </>
      )}
    >
      <form id="clone-form" className="dialog-form" onSubmit={submit}>
        <div className="form-row">
          <label className="form-label" htmlFor="clone-source">Spare of</label>
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
          <label className="form-label" htmlFor="clone-qty">Quantity (optional, same as the Part if blank)</label>
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
