import type { ClientMessage, Quote, ServerMessage } from '@stock/shared';
import type { MarketDataProvider } from './market/provider';
import { startNotifier } from './trading/alertRoutes';
import type { AchievementService } from './trading/achievements';
import type { AlertService } from './trading/alerts';
import type { PushService } from './trading/push';
import type { TradingService } from './trading/service';

export interface RealtimeOptions {
  provider: MarketDataProvider;
  trading?: TradingService;
  alerts?: AlertService;
  push?: PushService;
  achievements?: AchievementService;
  /** 지수 브로드캐스트 간격 (ms) */
  indicesIntervalMs?: number;
}

/** 실시간 연결 하나 (서버는 WebSocket, 서버 없이 쓸 땐 앱 안 연결) */
export interface RealtimeClient {
  /** 클라이언트가 보낸 메시지 (JSON 문자열) */
  receive(raw: string): void;
  close(): void;
}

/**
 * 실시간: 구독한 종목 시세 + 주기적 지수 + 계좌·업적·가격 알림.
 * 연결 방식과 상관없이 send 함수만 있으면 됨
 */
export function createRealtime({ provider, trading, alerts, push, achievements, indicesIntervalMs = 3_000 }: RealtimeOptions) {
  const clients = new Set<{ send: (m: ServerMessage) => void; codes: Set<string> }>();
  const syncWatch = () => {
    const all = new Set<string>();
    for (const c of clients) for (const code of c.codes) all.add(code);
    provider.watch('screens', all);
  };

  const offQuote = provider.onQuote((quote: Quote) => {
    for (const c of clients) if (c.codes.has(quote.code)) c.send({ type: 'quote', quote });
  });
  const indicesTimer = setInterval(async () => {
    if (clients.size === 0) return;
    const indices = await provider.getIndices();
    for (const c of clients) c.send({ type: 'indices', indices });
  }, indicesIntervalMs);

  // 체결·주문·환전·리셋 알림은 모든 화면에
  const offAccount = trading?.onEvent((e) => {
    for (const c of clients) c.send({ type: 'account', ...e });
  });

  // 업적·챌린지 달성 알림
  const offAchievement = achievements?.onUnlock((u) => {
    for (const c of clients) c.send({ type: 'achievement', ...u });
  });

  // 가격 알림: 시세 확인 → 폰 푸시 + 앱 화면
  const stopNotifier = alerts
    ? startNotifier({
        provider,
        alerts,
        push,
        trading,
        broadcast: (alert, stock) => {
          for (const c of clients) c.send({ type: 'alert', alert, ...(stock ? { stock } : {}) });
        },
      })
    : undefined;

  return {
    connect(send: (m: ServerMessage) => void): RealtimeClient {
      const client = { codes: new Set<string>(), send };
      clients.add(client);
      return {
        receive(raw) {
          try {
            const msg = JSON.parse(raw) as ClientMessage;
            if (msg.type === 'subscribe' && Array.isArray(msg.codes)) {
              client.codes = new Set(msg.codes.slice(0, 200).map(String));
              syncWatch();
            }
          } catch {
            // 잘못된 메시지는 무시
          }
        },
        close() {
          clients.delete(client);
          syncWatch();
        },
      };
    },
    stop() {
      stopNotifier?.();
      offAccount?.();
      offAchievement?.();
      offQuote();
      clearInterval(indicesTimer);
    },
  };
}
