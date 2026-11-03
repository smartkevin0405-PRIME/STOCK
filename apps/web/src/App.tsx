import { useEffect } from 'react';
import { HashRouter, Route, Routes, useLocation } from 'react-router';
import { TabBar } from './components/Layout';
import { live } from './lib/live';
import { useTheme } from './lib/theme';
import { Discover } from './pages/Discover';
import { Home } from './pages/Home';
import { Journal } from './pages/Journal';
import { More } from './pages/More';
import { StockDetail } from './pages/StockDetail';
import { Watchlist } from './pages/Watchlist';

function Shell() {
  useTheme();
  const { pathname } = useLocation();
  const showTabs = !pathname.startsWith('/stock/');

  useEffect(() => {
    live.connect();
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
      </Routes>
      {showTabs && <TabBar />}
    </>
  );
}

// HashRouter: 나중에 Capacitor(APK)에서도 주소 처리 없이 그대로 동작
export function App() {
  return (
    <HashRouter>
      <Shell />
    </HashRouter>
  );
}
