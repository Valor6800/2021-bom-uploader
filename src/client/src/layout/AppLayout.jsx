import { Outlet } from 'react-router-dom';
import AppNav from './AppNav.jsx';

/**
 * Top-level portal shell: shared navigation plus a routed content outlet.
 * Every page renders inside this layout so the nav persists across routes.
 */
export default function AppLayout() {
  return (
    <div className="app-wrapper">
      <AppNav />
      <div className="container container-py">
        <Outlet />
      </div>
    </div>
  );
}
