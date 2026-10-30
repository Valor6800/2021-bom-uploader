import { useEffect, useRef, useState } from 'react';

/** One sentence per word, from the field guide. */
export const GLOSSARY = Object.freeze({
  Assembly: 'A mechanism that does one job, like the intake.',
  Build: 'One specific combination of Parts for an Assembly, like the 1-inch vs 2-inch bash bar version.',
  Part: 'One physical piece. It can be reused across Builds, or redesigned when a Build needs something different.',
  Revision: 'The same Assembly, reworked significantly. Rare. Most Assemblies stay on Revision A.',
});

/**
 * A "?" toggletip placed after a word, once per page, on the heading where the
 * word first appears.
 *
 * The definition lives in a sibling role="status" span that is empty while
 * closed, so a screen reader announces it when it opens. Esc or a click
 * outside closes it. Not a tooltip: it opens on click, not hover.
 *
 * @param {object} props
 * @param {'Assembly'|'Build'|'Part'|'Revision'} props.term
 */
export default function GlossaryTerm({ term }) {
  const [open, setOpen] = useState(false);
  const wrapRef = useRef(null);
  const buttonRef = useRef(null);
  const id = `gloss-${term.toLowerCase()}`;

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    const onPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false);
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onPointer);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onPointer);
    };
  }, [open]);

  return (
    <span className="glossary" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className="glossary-button"
        aria-expanded={open}
        aria-controls={id}
        aria-label={`What is a ${term}?`}
        onClick={() => setOpen((o) => !o)}
      >
        ?
      </button>
      <span id={id} role="status" className={open ? 'glossary-tip' : 'glossary-tip-closed'}>
        {open ? GLOSSARY[term] : ''}
      </span>
    </span>
  );
}
