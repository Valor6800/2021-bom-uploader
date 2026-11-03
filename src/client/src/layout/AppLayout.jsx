import { Outlet } from 'react-router-dom';
import AppNav from './AppNav.jsx';
import { ImageViewerProvider } from '../components/ui/ImageViewer.jsx';

/**
 * Top-level portal shell: shared navigation plus a routed content outlet.
 * Every page renders inside this layout so the nav persists across routes.
 */
export default function AppLayout() {
  return (
    <ImageViewerProvider>
      <div className="app-wrapper">
        <a href="#main" className="skip-link no-print">Skip to content</a>
        <AppNav />
        <main id="main" className="app-main container container-py" tabIndex={-1}>
          <Outlet />
        </main>
      </div>
    </ImageViewerProvider>
  );
}
