import { Outlet } from 'react-router-dom';
import AppNav from './AppNav.jsx';

/**
 * Top-level portal shell: shared navigation plus a routed content outlet.
 * Every page renders inside this layout so the nav persists across routes.
 */
export default function AppLayout() {
  return (
    <div className="app-wrapper">
      <a href="#main" className="skip-link no-print">Skip to content</a>
      <AppNav />
      <main id="main" className="app-main container container-py" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
