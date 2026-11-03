import { Suspense, lazy, useEffect, type ComponentType } from 'react';
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
import { Home } from './pages/Home';
import { Login } from './pages/Login';
import { ServerSetupFirst } from './pages/ServerSetup';

// 홈 말고는 그 화면을 열 때 내려받음 (첫 화면을 빨리 띄우려고)
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) =>
  lazy(() => load().then((m) => ({ default: m[name] })));
const Achievements = page(() => import('./pages/Achievements'), 'Achievements');
const Alerts = page(() => import('./pages/Alerts'), 'Alerts');
const Discover = page(() => import('./pages/Discover'), 'Discover');
const Fx = page(() => import('./pages/Fx'), 'Fx');
const Journal = page(() => import('./pages/Journal'), 'Journal');
const More = page(() => import('./pages/More'), 'More');
const Orders = page(() => import('./pages/Orders'), 'Orders');
const Replay = page(() => import('./pages/Replay'), 'Replay');
const ReplayPlay = page(() => import('./pages/ReplayPlay'), 'ReplayPlay');
const Seasons = page(() => import('./pages/Seasons'), 'Seasons');
const ServerSetup = page(() => import('./pages/ServerSetup'), 'ServerSetup');
const Settings = page(() => import('./pages/Settings'), 'Settings');
const StockDetail = page(() => import('./pages/StockDetail'), 'StockDetail');
const Watchlist = page(() => import('./pages/Watchlist'), 'Watchlist');

const SUB_PAGES = ['/stock/', '/orders', '/fx', '/seasons', '/alerts', '/achievements', '/replay', '/server', '/settings'];

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
      <Suspense fallback={<div className="p-8 text-center text-sm text-sub">불러오는 중…</div>}>
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
        <Route path="/settings" element={<Settings />} />
      </Routes>
      </Suspense>
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
