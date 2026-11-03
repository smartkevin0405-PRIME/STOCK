import { evaluatePortfolio } from '@stock/core';
import type { AccountView, StockInfo } from '@stock/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { api } from './api';
import { live, useLiveVersion, useUsdKrw } from './live';

export type AccountData = AccountView & { stocks: Record<string, StockInfo> };

/** 내 계좌 (체결·주문 알림이 오면 다시 불러옴) */
class AccountStore {
  private data: AccountData | undefined;
  private listeners = new Set<() => void>();
  private loading: Promise<void> | undefined;

  subscribe = (l: () => void) => {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  };

  get = () => this.data;

  refresh(): Promise<void> {
    this.loading ??= api
      .account()
      .then((d) => {
        this.data = d;
        for (const l of this.listeners) l();
      })
      .catch(() => undefined)
      .finally(() => {
        this.loading = undefined;
      });
    return this.loading;
  }
}

export const account = new AccountStore();

export function useAccount(): AccountData | undefined {
  useEffect(() => {
    if (!account.get()) void account.refresh();
  }, []);
  return useSyncExternalStore(account.subscribe, account.get);
}

/** 보유 종목 실시간 평가 (총자산, 평가손익, 오늘 손익) */
export function usePortfolio(view: AccountData | undefined) {
  useLiveVersion();
  const usdKrw = useUsdKrw();
  const codes = view?.positions.map((p) => p.code).join(',') ?? '';

  useEffect(() => {
    if (!codes) return;
    const list = codes.split(',');
    void api.quotes(list).then(({ quotes }) => quotes.forEach((q) => live.seed(q)), () => undefined);
    const releases = list.map((c) => live.retain(c));
    return () => releases.forEach((r) => r());
  }, [codes]);

  useEffect(() => {
    if (usdKrw === undefined) void api.indices().then((r) => live.seedIndices(r.indices), () => undefined);
  }, [usdKrw]);

  if (!view) return undefined;
  const rate = usdKrw ?? 1_400;
  const quotes = Object.fromEntries(view.positions.map((p) => [p.code, live.getQuote(p.code)]));
  const ev = evaluatePortfolio({ cash: view.cash, positions: Object.fromEntries(view.positions.map((p) => [p.code, p])) }, quotes, rate);
  const totalPnlKrw = ev.totalKrw - view.seedKrw;
  // 오늘 수익 = 지금 총자산 - 오늘 오전 7시 총자산 (오늘 산 주식도 산 가격 기준으로 정확)
  const dayPnlKrw = view.dayBase ? ev.totalKrw - view.dayBase.totalKrw : undefined;
  return {
    ...ev,
    usdKrw: rate,
    totalPnlKrw,
    totalReturnRate: totalPnlKrw / view.seedKrw,
    dayPnlKrw,
    dayReturnRate: dayPnlKrw !== undefined && view.dayBase ? dayPnlKrw / view.dayBase.totalKrw : undefined,
  };
}
