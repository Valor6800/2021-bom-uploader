import { useEffect, useId, useRef, useState } from 'react';

/**
 * A "⋯ More actions" disclosure: a toggle button that shows a panel of
 * ordinary buttons. Deliberately not an ARIA menu (no role="menu", no
 * aria-haspopup), so Tab moves through the actions and no arrow-key contract
 * is implied. Esc and a click outside close it and return focus to the toggle.
 *
 * @param {object} props
 * @param {string} props.label      Accessible name, e.g. "More actions for Build 2".
 * @param {import('react').ReactNode} [props.toggleText]  Visible text, default "⋯".
 * @param {(close: () => void) => import('react').ReactNode} props.children
 *   Render prop; call `close` after an action runs.
 */
export default function DisclosureMenu({ label, toggleText = '⋯', children, className = '' }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const toggleRef = useRef(null);
  const panelId = useId();

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) toggleRef.current?.focus();
  };

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') close();
    };
    const onPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) close(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <div className={`disclosure ${className}`} ref={wrapRef}>
      <button
        ref={toggleRef}
        type="button"
        className="btn btn-ghost disclosure-toggle"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={label}
        onClick={() => setOpen((o) => !o)}
      >
        <span aria-hidden="true">{toggleText}</span>
      </button>
      <div id={panelId} className="disclosure-panel" hidden={!open}>
        {open && children(() => close())}
      </div>
    </div>
  );
}
