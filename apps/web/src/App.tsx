import { useEffect } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router';
import { TabBar } from './components/Layout';
import { Toaster } from './components/Toaster';
import { handleAchievement } from './lib/achievements';
import { describeAlert } from './lib/alerts';
import { api } from './lib/api';
import { initAuth, useAuthState } from './lib/auth';
import { live } from './lib/live';
import { initNative } from './lib/native';
import { handleAccountEvent } from './lib/notify';
import { registerServiceWorker } from './lib/push';
import { needsServerSetup } from './lib/server';
import { useTheme } from './lib/theme';
import { toast } from './lib/toast';
import { Achievements } from './pages/Achievements';
import { Alerts } from './pages/Alerts';
import { Discover } from './pages/Discover';
import { Fx } from './pages/Fx';
import { Home } from './pages/Home';
import { Journal } from './pages/Journal';
import { Login } from './pages/Login';
import { More } from './pages/More';
import { Orders } from './pages/Orders';
import { Replay } from './pages/Replay';
import { ReplayPlay } from './pages/ReplayPlay';
import { Seasons } from './pages/Seasons';
import { ServerSetup, ServerSetupFirst } from './pages/ServerSetup';
import { StockDetail } from './pages/StockDetail';
import { Watchlist } from './pages/Watchlist';

const SUB_PAGES = ['/stock/', '/orders', '/fx', '/seasons', '/alerts', '/achievements', '/replay', '/server'];

function Shell() {
  useTheme();
  const { pathname } = useLocation();
  const showTabs = !SUB_PAGES.some((p) => pathname.startsWith(p));

  useEffect(() => {
    live.onAccountEvent(handleAccountEvent);
    live.onAlert(({ alert, stock }) => toast(`🔔 ${stock?.nameKo ?? alert.code} ${describeAlert(alert, stock)} 도달`, 'info', `alert:${alert.id}`));
    live.onAchievement(handleAchievement);
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
        <Route path="/achievements" element={<Achievements />} />
        <Route path="/replay" element={<Replay />} />
        <Route path="/replay/:id" element={<ReplayPlay />} />
        <Route path="/server" element={<ServerSetup />} />
      </Routes>
      {showTabs && <TabBar />}
      <Toaster />
    </>
  );
}

// HashRouter: 나중에 Capacitor(APK)에서도 주소 처리 없이 그대로 동작
export function App() {
  // 1) 안드로이드 앱에서 서버 주소를 아직 안 정했으면 그것부터
  // 2) 서버에 비밀번호가 있으면 로그인부터
  const setup = needsServerSetup();
  const auth = useAuthState();
  useEffect(() => {
    if (setup) return;
    api.health().then(
      (h) => initAuth(!!h.auth),
      () => initAuth(false),
    );
  }, [setup]);
  if (setup) return <ServerSetupFirst />;
  if (auth === 'checking') return null;
  if (auth === 'out') return <Login />;
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
