import { Link } from 'react-router-dom';
import ModeSwitch from './ModeSwitch.jsx';

export const TRACKER_BASE_URL = 'https://jira.valor6800.com';

/** Link to a ticket in the team tracker, shown as its key. */
export function TrackerKey({ issueKey, className = '' }) {
  return (
    <a
      href={`${TRACKER_BASE_URL}/browse/${encodeURIComponent(issueKey)}`}
      target="_blank"
      rel="noopener noreferrer"
      title="Open in the team tracker"
      className={`mono-key tracker-key ${className}`}
    >
      {issueKey}
    </a>
  );
}

/**
 * The header both work pages share: back link, number and name, mode
 * switch, and the meta line (season, Revision, key, OnShape link).
 *
 * The Revision is a <select> only when the chain has more than one ticket;
 * changing it navigates to that Revision's page (the caller decides how).
 *
 * @param {object} props
 * @param {object} props.assembly        toAssembly shape
 * @param {object[]} props.revisions     toAssembly per chain ticket (newest first), or []
 * @param {'design'|'assemble'} props.mode
 * @param {string|null} props.buildKey
 * @param {(key: string) => void} props.onRevisionChange
 */
export default function AssemblyHeader({ assembly, revisions, mode, buildKey, onRevisionChange }) {
  const showSelect = revisions.length > 1;
  return (
    <header className="assembly-header">
      <Link to="/" className="back-link">← All Assemblies</Link>
      <div className="assembly-header-top">
        <h1
          className="assembly-title"
          title={assembly.numbered ? `${assembly.fullPartNumber} ${assembly.name}` : assembly.name}
        >
          {assembly.numbered && <span className="mono-key assembly-number">{assembly.fullPartNumber}</span>}
          <span className="assembly-name">{assembly.name}</span>
        </h1>
        <ModeSwitch assemblyKey={assembly.key} mode={mode} buildKey={buildKey} />
      </div>
      <div className="assembly-meta">
        {assembly.seasonLabel && <span className="meta-item">{assembly.seasonLabel}</span>}
        {!assembly.numbered && (
          <span className="chip chip-neutral" title="This Assembly's name doesn't follow the VF27A-0000A pattern.">
            (No number)
            <span className="visually-hidden"> This Assembly&apos;s name doesn&apos;t follow the VF27A-0000A pattern.</span>
          </span>
        )}
        <span className="meta-item">
          Revision{' '}
          {showSelect ? (
            <select
              className="select-inline revision-select"
              aria-label="Revision"
              value={assembly.key}
              onChange={(e) => onRevisionChange(e.target.value)}
            >
              {revisions.map((rev) => (
                <option key={rev.key} value={rev.key}>
                  {rev.revision ?? '?'} · {rev.key}
                </option>
              ))}
            </select>
          ) : (
            <strong>{assembly.revision ?? 'A'}</strong>
          )}
        </span>
        <span className="meta-item"><TrackerKey issueKey={assembly.key} /></span>
        {assembly.onshapeUrl && (
          <span className="meta-item">
            <a href={assembly.onshapeUrl} target="_blank" rel="noopener noreferrer" className="link-plain">
              Open in OnShape <span aria-hidden="true">↗</span>
            </a>
          </span>
        )}
      </div>
    </header>
  );
}
