import { forwardRef, useRef } from 'react';
import { Link } from 'react-router-dom';
import Dialog from '../ui/Dialog.jsx';

/** "VF27A-0000A Test Assembly", or the bare summary for an unnumbered one. */
export function assemblyTitle(assembly) {
  return assembly.numbered ? `${assembly.fullPartNumber} ${assembly.name}` : assembly.summary;
}

/** "Facility 2027 · Revision A · HAR-2030" */
export function assemblyMetaLine(assembly) {
  return [
    assembly.seasonLabel,
    assembly.revision ? `Revision ${assembly.revision}` : null,
    assembly.key,
  ].filter(Boolean).join(' · ');
}

/**
 * The two mode tiles (design 3.2). Shared by the dialog and the /a/:key page.
 * `firstRef` lands on the Designer tile so the dialog can focus it.
 */
export const ChooserOptions = forwardRef(function ChooserOptions(
  { assemblyKey, headingId, questionLevel = 'h3' },
  firstRef,
) {
  const base = `/a/${encodeURIComponent(assemblyKey)}`;
  const Question = questionLevel;
  return (
    <div className="chooser">
      <Question id={headingId} className="chooser-question">What are you doing?</Question>
      <ul className="chooser-options" aria-labelledby={headingId}>
        <li>
          <Link ref={firstRef} to={`${base}/design`} className="chooser-tile">
            <span className="chooser-tile-title"><span aria-hidden="true">✎</span> Designer</span>
            <span className="chooser-tile-text">I do CAD: update Parts from OnShape, edit, save, cut a version.</span>
          </Link>
        </li>
        <li>
          <Link to={`${base}/assemble`} className="chooser-tile">
            <span className="chooser-tile-title"><span aria-hidden="true">🔧</span> Assembly</span>
            <span className="chooser-tile-text">I build it: Parts list per Build, compare, print.</span>
          </Link>
        </li>
      </ul>
    </div>
  );
});

/**
 * Pick Designer or Assembly for one Assembly. Focus starts on Designer and
 * returns to the card that opened it (ui/Dialog restores it).
 *
 * @param {object} props
 * @param {object|null} props.assembly  toAssembly shape; null keeps it closed
 * @param {() => void} props.onClose
 */
export default function ChooserDialog({ assembly, onClose }) {
  const firstRef = useRef(null);
  return (
    <Dialog
      open={!!assembly}
      onClose={onClose}
      title={assembly ? assemblyTitle(assembly) : ''}
      description={assembly ? assemblyMetaLine(assembly) : undefined}
      initialFocusRef={firstRef}
      className="chooser-dialog"
    >
      {assembly && (
        <ChooserOptions ref={firstRef} assemblyKey={assembly.key} headingId="chooser-question" />
      )}
    </Dialog>
  );
}
