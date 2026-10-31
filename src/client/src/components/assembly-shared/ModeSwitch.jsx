import { Link } from 'react-router-dom';

const MODES = [
  { mode: 'design', label: 'Designer' },
  { mode: 'assemble', label: 'Assembly' },
];

/**
 * Designer | Assembly switch in the Assembly header. Keeps `?build` so the
 * student lands on the same Build in the other mode.
 *
 * @param {object} props
 * @param {string} props.assemblyKey
 * @param {'design'|'assemble'} props.mode
 * @param {string|null} [props.buildKey]
 */
export default function ModeSwitch({ assemblyKey, mode, buildKey }) {
  const query = buildKey ? `?build=${encodeURIComponent(buildKey)}` : '';
  return (
    <nav className="mode-switch" aria-label="Mode">
      {MODES.map((m) => (
        <Link
          key={m.mode}
          to={`/a/${encodeURIComponent(assemblyKey)}/${m.mode}${query}`}
          className={`mode-switch-option${m.mode === mode ? ' mode-switch-active' : ''}`}
          aria-current={m.mode === mode ? 'page' : undefined}
        >
          {m.label}
        </Link>
      ))}
    </nav>
  );
}
