import { useEffect } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router';
import { TabBar } from './components/Layout';
import { Toaster } from './components/Toaster';
import { describeAlert } from './lib/alerts';
import { live } from './lib/live';
import { initNative } from './lib/native';
import { handleAccountEvent } from './lib/notify';
import { registerServiceWorker } from './lib/push';
import { needsServerSetup } from './lib/server';
import { useTheme } from './lib/theme';
import { toast } from './lib/toast';
import { Alerts } from './pages/Alerts';
import { Discover } from './pages/Discover';
import { Fx } from './pages/Fx';
import { Home } from './pages/Home';
import { Journal } from './pages/Journal';
import { More } from './pages/More';
import { Orders } from './pages/Orders';
import { Seasons } from './pages/Seasons';
import { ServerSetup, ServerSetupFirst } from './pages/ServerSetup';
import { StockDetail } from './pages/StockDetail';
import { Watchlist } from './pages/Watchlist';

const SUB_PAGES = ['/stock/', '/orders', '/fx', '/seasons', '/alerts', '/server'];

function Shell() {
  useTheme();
  const { pathname } = useLocation();
  const showTabs = !SUB_PAGES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    live.onAccountEvent(handleAccountEvent);
    live.onAlert(({ alert, stock }) => toast(`🔔 ${stock?.nameKo ?? alert.code} ${describeAlert(alert, stock)} 도달`, 'info', `alert:${alert.id}`));
    live.connect();
    registerServiceWorker();
    void initNative();
  }, []);
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);

  return (
    <>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/watchlist" element={<Watchlist />} />
        <Route path="/discover" element={<Discover />} />
        <Route path="/journal" element={<Journal />} />
        <Route path="/more" element={<More />} />
        <Route path="/stock/:code" element={<StockDetail />} />
        <Route path="/orders" element={<Orders />} />
        <Route path="/fx" element={<Fx />} />
        <Route path="/seasons" element={<Seasons />} />
        <Route path="/alerts" element={<Alerts />} />
        <Route path="/server" element={<ServerSetup />} />
      </Routes>
      {showTabs && <TabBar />}
      <Toaster />
    </>
  );
}

// HashRouter: 나중에 Capacitor(APK)에서도 주소 처리 없이 그대로 동작
export function App() {
  // 안드로이드 앱에서 서버 주소를 아직 안 정했으면 그것부터
  if (needsServerSetup()) return <ServerSetupFirst />;
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
