import type { IndexQuote, Quote, ServerMessage } from '@stock/shared';
import { useEffect, useSyncExternalStore } from 'react';
import { API_BASE } from './api';

/** 실시간 시세 저장소: WebSocket 하나로 화면에 보이는 종목만 구독 */
class LiveStore {
  private quotes = new Map<string, Quote>();
  private indices: IndexQuote[] = [];
  private listeners = new Set<() => void>();
  private counts = new Map<string, number>();
  private ws: WebSocket | undefined;
  private pending = false;
  connected = false;

  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };

  getQuote = (code: string) => this.quotes.get(code);
  getIndices = () => this.indices;
  getConnected = () => this.connected;

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
