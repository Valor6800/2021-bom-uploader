import { NavLink } from 'react-router-dom';

/**
 * Navigation entries for the portal. Add a route here and it appears in the
 * nav automatically — keeping navigation extensible as new pages are added.
 */
export const NAV_ITEMS = [
  { to: '/', label: 'Dashboard', end: true },
  { to: '/assembly', label: 'Assembly BOM' },
  // Mentor-only: these move money and close tickets, so they sit behind
  // Authentik while the BOM tooling stays open to the whole team.
  { to: '/purchasing', label: 'Parts Order', mentorsOnly: true },
  { to: '/receiving', label: 'Parts Check-in', mentorsOnly: true },
];

export default function AppNav() {
  return (
    <nav className="nav no-print" aria-label="Main">
      <div className="nav-inner">
        <div className="nav-brand">
          <span className="nav-icon" aria-hidden="true">⚙</span>
          <h1 className="nav-title">BOM Portal</h1>
        </div>
        <ul className="nav-links">
          {NAV_ITEMS.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  `nav-link${isActive ? ' nav-link-active' : ''}`
                }
              >
                {item.label}
                {item.mentorsOnly && (
                  <span className="nav-lock" title="Mentors only" role="img" aria-label="Mentors only">🔒</span>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </div>
    </nav>
  );
}
