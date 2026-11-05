import { STAGES, Stage, readinessOf } from '../../lib/partStage.js';

/**
 * How ready the Build is to put together: N of M Parts ready and a count per
 * stage. Each Part's own status is in the table below.
 *
 * @param {object} props
 * @param {object[]} props.parts    The Build's Parts (with `status`)
 * @param {string} props.buildName  "Build 2"
 */
export default function BuildReadiness({ parts, buildName }) {
  if (parts.length === 0) return null;
  const { total, ready, counts } = readinessOf(parts);
  const percent = Math.round((ready / total) * 100);
  const shown = STAGES.filter((s) => counts[s.id] > 0);

  return (
    <section className="readiness" aria-labelledby="readiness-title">
      <div className="readiness-head">
        <h3 id="readiness-title" className="readiness-title">
          {ready === total
            ? `All ${total} Parts are ready to assemble`
            : `${ready} of ${total} Parts ready to assemble`}
        </h3>
        <meter className="readiness-meter" min={0} max={total} value={ready} aria-label={`${buildName}: ${percent}% of Parts ready`}>
          {percent}%
        </meter>
      </div>
      <ul className="readiness-counts">
        {shown.map((s) => (
          <li key={s.id}>
            <span className={`stage-chip stage-${s.id}`}>{s.label}</span>
            <span className="readiness-count">{counts[s.id]}</span>
          </li>
        ))}
      </ul>
      {counts[Stage.UNKNOWN] > 0 && (
        <p className="readiness-note">
          {counts[Stage.UNKNOWN]} Part{counts[Stage.UNKNOWN] === 1 ? ' has a status' : 's have statuses'} this page doesn&apos;t know (e.g. Ignore).
        </p>
      )}
    </section>
  );
}
