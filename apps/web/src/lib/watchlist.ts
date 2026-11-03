import { useEffect, useSyncExternalStore } from 'react';
import { api, type WatchlistData } from './api';
import { toast } from './toast';

/** 관심종목 그룹 (서버 저장 → 웹·앱 어디서나 같음) */
class WatchStore {
  private data: WatchlistData | undefined;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | undefined;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  get = () => this.data;

  set(d: WatchlistData) {
    this.data = d;
    for (const l of this.listeners) l();
  }

  refresh(): Promise<void> {
    this.loading ??= api
      .watchlists()
      .then((d) => this.migrateLocal(d))
      .then((d) => this.set(d))
      .catch(() => undefined)
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }

  /** 예전(브라우저 저장) 관심종목을 첫 그룹으로 한 번만 옮김 */
  private async migrateLocal(d: WatchlistData): Promise<WatchlistData> {
    try {
      if (localStorage.getItem('watchlist-migrated')) return d;
      const old = JSON.parse(localStorage.getItem('watchlist') ?? '[]') as unknown;
      localStorage.setItem('watchlist-migrated', '1');
      const first = d.groups[0];
      if (!first || !Array.isArray(old)) return d;
      const missing = old.filter((c): c is string => typeof c === 'string' && !first.codes.includes(c));
      return missing.length ? await api.updateWatchGroup(first.id, { codes: [...first.codes, ...missing] }) : d;
    } catch {
      return d;
    }
  }
}

export const watchStore = new WatchStore();

/** 서버 요청 → 결과로 목록 갱신, 실패하면 토스트 */
export async function watchAction(fn: () => Promise<WatchlistData>, done?: string): Promise<boolean> {
  try {
    watchStore.set(await fn());
    if (done) toast(done);
    return true;
  } catch (e) {
    toast((e as Error).message, 'error');
    return false;
  }
}

export function useWatchlists(): WatchlistData | undefined {
  useEffect(() => {
    if (!watchStore.get()) void watchStore.refresh();
  }, []);
  return useSyncExternalStore(watchStore.subscribe, watchStore.get);
}

/** 종목 화면 별표용 */
export function useWatchlist() {
  const data = useWatchlists();
  const groups = data?.groups ?? [];
  const groupsOf = (code: string) => groups.filter((g) => g.codes.includes(code));
  return {
    groups,
    has: (code: string) => groupsOf(code).length > 0,
    groupsOf,
    add: (groupId: number, code: string) => watchAction(() => api.addWatch(groupId, code), '관심 종목에 담았어요'),
    remove: (groupId: number, code: string) => watchAction(() => api.removeWatch(groupId, code), '관심 종목에서 뺐어요'),
    /** 들어 있는 모든 그룹에서 빼기 */
    removeAll: async (code: string) => {
      for (const g of groupsOf(code)) await watchAction(() => api.removeWatch(g.id, code));
      toast('관심 종목에서 뺐어요', 'info', `unwatch:${code}`);
    },
  };
}
