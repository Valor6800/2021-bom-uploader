import { Link } from 'react-router-dom';

/** Neutral chip with hidden text, so the meaning isn't only visual. */
function Chip({ children, title, hidden }) {
  return (
    <span className="chip chip-neutral" title={title}>
      {children}
      {hidden && <span className="visually-hidden"> {hidden}</span>}
    </span>
  );
}

/**
 * One Assembly: the left part opens the chooser, the two links go straight
 * to a work page.
 */
function ResultCard({ assembly, showSeason, onChoose }) {
  const base = `/a/${encodeURIComponent(assembly.key)}`;
  return (
    <li className="result-card">
      <button
        type="button"
        className="result-main"
        onClick={(e) => onChoose(assembly, e.currentTarget)}
        data-key={assembly.key}
      >
        <span className="result-title">
          {assembly.numbered && <span className="mono-key result-number">{assembly.fullPartNumber}</span>}
          <span className="result-name">{assembly.name}</span>
        </span>
        <span className="result-meta">
          {showSeason && assembly.seasonLabel && <Chip>{assembly.seasonLabel}</Chip>}
          {!assembly.numbered && (
            <Chip
              title="This Assembly's name doesn't follow the VF27A-0000A pattern."
              hidden="This Assembly's name doesn't follow the VF27A-0000A pattern."
            >
              (No number)
            </Chip>
          )}
          {assembly.closed && <Chip hidden="This Assembly is closed.">Closed</Chip>}
          {assembly.revision && <span>Revision {assembly.revision}</span>}
          <span className="mono-key">{assembly.key}</span>
        </span>
      </button>
      <span className="result-links">
        <Link to={`${base}/design`} className="btn btn-secondary" aria-label={`Designer: ${assembly.summary}`}>Designer</Link>
        <Link to={`${base}/assemble`} className="btn btn-secondary" aria-label={`Assembly: ${assembly.summary}`}>Assembly</Link>
      </span>
    </li>
  );
}

/**
 * Search results (design 3.1): season groups for the empty query, one
 * ranked flat list while typing.
 *
 * @param {object} props
 * @param {object[]} props.results          toAssembly shapes in display order
 * @param {object[]|null} props.groups      [{ label, seasonCode, keys }] or null
 * @param {(assembly: object, opener: HTMLElement) => void} props.onChoose
 */
export default function AssemblyResultList({ results, groups, onChoose }) {
  const byKey = new Map(results.map((a) => [a.key, a]));
  if (groups) {
    return (
      <div className="result-groups">
        {groups.map((g) => {
          const members = g.keys.map((k) => byKey.get(k)).filter(Boolean);
          if (!members.length) return null;
          const id = `group-${(g.seasonCode ?? 'other').toLowerCase()}`;
          return (
            <section key={g.label} className="result-group" aria-labelledby={id}>
              <h2 id={id} className="result-group-heading">
                <span>{g.label}</span>
                <span className="group-count">{members.length}</span>
              </h2>
              <ul className="result-list">
                {members.map((a) => (
                  <ResultCard key={a.key} assembly={a} showSeason={false} onChoose={onChoose} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    );
  }
  return (
    <ul className="result-list" aria-label="Matching Assemblies">
      {results.map((a) => (
        <ResultCard key={a.key} assembly={a} showSeason onChoose={onChoose} />
      ))}
    </ul>
  );
}
