import type { AccountEvent, IndexQuote, Quote, ServerMessage } from '@stock/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { API_BASE } from './api';

export type AlertMessage = Extract<ServerMessage, { type: 'alert' }>;
export type AchievementMessage = Extract<ServerMessage, { type: 'achievement' }>;

/** 실시간 시세 저장소: WebSocket 하나로 화면에 보이는 종목만 구독 */
class LiveStore {
  private quotes = new Map<string, Quote>();
  private indices: IndexQuote[] = [];
  private listeners = new Set<() => void>();
  private counts = new Map<string, number>();
  private ws: WebSocket | undefined;
  private pending = false;
  private version = 0;
  private accountHandler: ((e: AccountEvent) => void) | undefined;
  private alertHandler: ((m: AlertMessage) => void) | undefined;
  private achievementHandler: ((m: AchievementMessage) => void) | undefined;
  connected = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getQuote = (code: string) => this.quotes.get(code);
  getIndices = () => this.indices;
  getConnected = () => this.connected;
  getVersion = () => this.version;

  /** 체결·주문 알림 받을 곳 (계좌 화면 갱신, 토스트) */
  onAccountEvent(handler: (e: AccountEvent) => void) {
    this.accountHandler = handler;
  }

  /** 가격 알림이 울렸을 때 (앱이 켜져 있으면 화면에도) */
  onAlert(handler: (m: AlertMessage) => void) {
    this.alertHandler = handler;
  }

  /** 업적·챌린지를 새로 달성했을 때 */
  onAchievement(handler: (m: AchievementMessage) => void) {
    this.achievementHandler = handler;
  }

  /** REST로 받은 시세 넣기 (더 최신 값이 있으면 무시) */
  seed(quote: Quote | null | undefined) {
    if (!quote) return;
    const cur = this.quotes.get(quote.code);
    if (cur && cur.timestamp >= quote.timestamp) return;
    this.quotes.set(quote.code, quote);
    this.emit();
  }

  seedIndices(indices: IndexQuote[]) {
    this.indices = indices;
    this.emit();
  }

  retain(code: string) {
    this.counts.set(code, (this.counts.get(code) ?? 0) + 1);
    this.syncSubscriptions();
    return () => {
      const n = (this.counts.get(code) ?? 1) - 1;
      if (n <= 0) this.counts.delete(code);
      else this.counts.set(code, n);
      this.syncSubscriptions();
    };
  }

  connect() {
    if (this.ws) return;
    const base = API_BASE || window.location.origin;
    const url = base.replace(/^http/, 'ws') + '/ws';
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.connected = true;
      this.sendSubscriptions();
      this.emit();
    };
    ws.onmessage = (e) => {
      const msg = JSON.parse(String(e.data)) as ServerMessage;
      if (msg.type === 'quote') this.quotes.set(msg.quote.code, msg.quote);
      else if (msg.type === 'indices') this.indices = msg.indices;
      else if (msg.type === 'account') {
        const { type: _t, ...event } = msg;
        this.accountHandler?.(event as AccountEvent);
        return;
      } else if (msg.type === 'alert') {
        this.alertHandler?.(msg);
        return;
      } else if (msg.type === 'achievement') {
        this.achievementHandler?.(msg);
        return;
      }
      this.emit();
    };
    ws.onclose = () => {
      this.connected = false;
      this.ws = undefined;
      this.emit();
      setTimeout(() => this.connect(), 2_000);
    };
  }

  private syncSubscriptions() {
    if (this.pending) return;
    this.pending = true;
    queueMicrotask(() => {
      this.pending = false;
      this.sendSubscriptions();
    });
  }

  private sendSubscriptions() {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({ type: 'subscribe', codes: [...this.counts.keys()] }));
    }
  }

  private emit() {
    this.version++;
    for (const l of this.listeners) l();
  }
}

export const live = new LiveStore();

/** 종목 실시간 시세. 화면에 있는 동안만 구독 */
export function useLiveQuote(code: string | undefined, initial?: Quote | null): Quote | undefined {
  useEffect(() => {
    if (!code) return;
    live.seed(initial);
    return live.retain(code);
  }, [code, initial]);
  return useSyncExternalStore(live.subscribe, () => (code ? live.getQuote(code) : undefined)) ?? initial ?? undefined;
}

export function useLiveIndices(): IndexQuote[] {
  return useSyncExternalStore(live.subscribe, live.getIndices);
}

export function useLiveConnected(): boolean {
  return useSyncExternalStore(live.subscribe, live.getConnected);
}

/** 시세가 바뀔 때마다 다시 그리기 (여러 종목을 한꺼번에 계산할 때) */
export function useLiveVersion(): number {
  return useSyncExternalStore(live.subscribe, live.getVersion);
}

/** 원/달러 환율 (지수 목록의 KRW=X) */
export function useUsdKrw(): number | undefined {
  return useLiveIndices().find((i) => i.symbol === 'KRW=X')?.price;
}
