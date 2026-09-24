import AppLayout from './layout/AppLayout.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import AssemblyBomPage from './pages/AssemblyBomPage.jsx';
import NotFoundPage from './pages/NotFoundPage.jsx';

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
      { index: true, element: <DashboardPage /> },
      { path: 'assembly', element: <AssemblyBomPage /> },
      { path: '*', element: <NotFoundPage /> },
    ],
  },
];
