import { useCallback, useEffect, useState } from 'react';
import { TriangleAlert } from 'lucide-react';
import { useAuth } from './context/AuthContext.jsx';
import { DataProvider, useData } from './context/DataContext.jsx';
import { Layout } from './components/Layout.jsx';
import { QuickPanelProvider } from './components/QuickPanels.jsx';
import { FullScreenLoader } from './components/ui.jsx';
import { AccessDenied, LoginScreen, SetupNeeded } from './pages/AuthScreens.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Cashbook from './pages/Cashbook.jsx';
import BankCredit from './pages/BankCredit.jsx';
import Partners from './pages/Partners.jsx';
import Planner from './pages/Planner.jsx';
import Vouchers from './pages/Vouchers.jsx';
import Admin from './pages/Admin.jsx';
import { ROUTES, can } from './lib/roles.js';

/* Điều hướng bằng #ten-man-hinh */
function parseHash() {
  const raw = window.location.hash.replace(/^#\/?/, '');
  if (['partners-ap', 'partners-ar', 'partners-ncc', 'partners-chi'].includes(raw)) return { route: 'partners', params: { tab: raw.replace('partners-', '') } };
  const vm = /^vouchers-(all|pending|post|batches|advances)$/.exec(raw);
  if (vm) return { route: 'vouchers', params: { tab: vm[1] } };
  return { route: raw || 'dashboard', params: {} };
}

function useHashRoute() {
  const [loc, setLoc] = useState(parseHash);
  useEffect(() => {
    const h = () => setLoc(parseHash());
    window.addEventListener('hashchange', h);
    return () => window.removeEventListener('hashchange', h);
  }, []);
  const navigate = useCallback((to) => {
    const [path, qs = ''] = to.split('?');
    const tab = new URLSearchParams(qs).get('tab');
    window.location.hash = tab ? `${path}-${tab}` : path;
    window.scrollTo({ top: 0 });
  }, []);
  return { ...loc, navigate };
}

const PAGES = { dashboard: Dashboard, cash: Cashbook, bank: BankCredit, partners: Partners, vouchers: Vouchers, planner: Planner, admin: Admin };

function Main() {
  const { role } = useAuth();
  const { error } = useData();
  const { route, params, navigate } = useHashRoute();
  const def = ROUTES.find((r) => r.key === route);
  const allowed = def && can(role, def.perm);
  const key = allowed ? route : 'dashboard';
  const Page = PAGES[key];
  return (
    <Layout route={key} navigate={navigate}>
      {error && (
        <div className="mb-4 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          <TriangleAlert className="h-5 w-5 shrink-0" /> {error}
        </div>
      )}
      <Page params={params} navigate={navigate} />
    </Layout>
  );
}

export default function App() {
  const { status } = useAuth();
  if (status === 'unconfigured') return <SetupNeeded />;
  if (status === 'loading') return <FullScreenLoader text="Đang khởi động…" />;
  if (status === 'signedOut') return <LoginScreen />;
  if (status === 'checking') return <FullScreenLoader text="Đang kiểm tra quyền truy cập…" />;
  if (status === 'denied') return <AccessDenied />;
  return (
    <DataProvider>
      <QuickPanelProvider>
        <Main />
      </QuickPanelProvider>
    </DataProvider>
  );
}
