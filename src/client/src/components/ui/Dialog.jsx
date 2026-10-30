import { useEffect, useId, useRef } from 'react';

/**
 * Modal built on the native <dialog> element, which supplies the focus trap,
 * Esc handling and the inert backdrop.
 *
 * Opens with showModal() when `open` turns true. Esc, the × button and a click
 * on the backdrop all call onClose. Focus goes to `initialFocusRef` (or the
 * browser's default, the first focusable control) and returns to whatever had
 * focus before the dialog opened.
 *
 * @param {object} props
 * @param {boolean} props.open
 * @param {() => void} props.onClose
 * @param {import('react').ReactNode} props.title
 * @param {import('react').ReactNode} [props.description]
 * @param {import('react').RefObject<HTMLElement>} [props.initialFocusRef]
 * @param {import('react').ReactNode} [props.footer]  Action buttons.
 */
export default function Dialog({
  open,
  onClose,
  title,
  description,
  initialFocusRef,
  footer,
  children,
  className = '',
}) {
  const ref = useRef(null);
  const returnFocusRef = useRef(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      returnFocusRef.current = document.activeElement;
      dialog.showModal();
      initialFocusRef?.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open, initialFocusRef]);

  // Restore focus once the dialog has closed, however it closed. The
  // cleanup covers a Dialog unmounted while open, which fires no `close`.
  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return undefined;
    const restore = () => {
      const target = returnFocusRef.current;
      returnFocusRef.current = null;
      if (target && typeof target.focus === 'function' && document.contains(target)) {
        target.focus();
      }
    };
    dialog.addEventListener('close', restore);
    return () => {
      dialog.removeEventListener('close', restore);
      restore();
    };
  }, []);

  // Esc fires `cancel`; keep the element's open state owned by React.
  const handleCancel = (e) => {
    e.preventDefault();
    onClose();
  };

  // A backdrop click is one whose press and release both land on the
  // <dialog> itself. A drag that starts in the panel (selecting text in an
  // input) and ends on the backdrop also targets the <dialog>, so the press
  // target is recorded and checked too.
  const pressedOnBackdrop = useRef(false);
  const handleMouseDown = (e) => {
    pressedOnBackdrop.current = e.target === ref.current;
  };
  const handleClick = (e) => {
    const onBackdrop = pressedOnBackdrop.current && e.target === ref.current;
    pressedOnBackdrop.current = false;
    if (onBackdrop) onClose();
  };

  return (
    <dialog
      ref={ref}
      className={`dialog ${className}`}
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={handleCancel}
      onMouseDown={handleMouseDown}
      onClick={handleClick}
    >
      <div className="dialog-panel">
        <div className="dialog-header">
          <h2 id={titleId} className="dialog-title">{title}</h2>
          <button
            type="button"
            className="dialog-close"
            aria-label="Close"
            onClick={onClose}
          >
            ×
          </button>
        </div>
        {description && <p id={descId} className="dialog-description">{description}</p>}
        {children && <div className="dialog-body">{children}</div>}
        {footer && <div className="dialog-footer">{footer}</div>}
      </div>
    </dialog>
  );
}
