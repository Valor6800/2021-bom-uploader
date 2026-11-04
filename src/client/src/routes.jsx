import { Navigate, useLocation, useParams } from 'react-router-dom';
import AppLayout from './layout/AppLayout.jsx';
import HomePage from './pages/HomePage.jsx';
import ChooserPage from './pages/ChooserPage.jsx';
import AssemblyPage from './pages/AssemblyPage.jsx';
import DesignerPage from './pages/DesignerPage.jsx';
import PurchasingQueuePage from './pages/PurchasingQueuePage.jsx';
import ReceivingPage from './pages/ReceivingPage.jsx';
import OrderHistoryPage from './pages/OrderHistoryPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

/** `/assembly/:key` moved to `/a/:key/assemble`; keep the search string. */
function RedirectToAssemble() {
  const { key } = useParams();
  const { search } = useLocation();
  return <Navigate to={`/a/${encodeURIComponent(key)}/assemble${search}`} replace />;
}

/**
 * Central route tree for the portal. Add new pages here (and a matching entry
 * in AppNav's NAV_ITEMS) to extend the portal with new management surfaces.
 *
 * Uses the object route config consumable by createBrowserRouter.
 */
export const routes = [
  {
    path: '/',
    element: <AppLayout />,
    children: [
      { index: true, element: <HomePage /> },
      // The old Build-less Assembly BOM page is replaced by Home.
      { path: 'assembly', element: <Navigate to="/" replace /> },
      // The old Assembly hub lives on as the new Assembly page.
      { path: 'assembly/:key', element: <RedirectToAssemble /> },
      { path: 'a/:key', element: <ChooserPage /> },
      { path: 'a/:key/design', element: <DesignerPage /> },
      { path: 'a/:key/assemble', element: <AssemblyPage /> },
      // The old Designer page never worked (design section 1); the new one
      // lives under /a/:key/design.
      { path: 'designer', element: <Navigate to="/" replace /> },
      { path: 'purchasing', element: <PurchasingQueuePage /> },
      { path: 'receiving', element: <ReceivingPage /> },
      { path: 'receiving/history', element: <OrderHistoryPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
