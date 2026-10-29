import Badge from '../ui/Badge.jsx';

/**
 * One tab per Build under the selected Revision (Sheet 06). There's always
 * exactly one Active tab — the real Jira workflow status, not a flag anyone
 * sets by hand — so it doubles as "the one to grab" at a glance.
 */
export default function BuildTabs({ builds, activeBuildKey, onSelect }) {
  if (builds.length === 0) {
    return <p className="text-dim">No builds yet under this revision.</p>;
  }

  return (
    <div className="tab-strip no-print">
      {builds.map((build) => (
        <button
          key={build.key}
          type="button"
          className={`tab ${build.key === activeBuildKey ? 'tab-active' : ''}`}
          onClick={() => onSelect(build.key)}
        >
          {build.summary}
          <span className="ml-2"><Badge status={build.status} /></span>
        </button>
      ))}
    </div>
  );
}
