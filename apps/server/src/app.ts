import fastifyStatic from '@fastify/static';
import websocket from '@fastify/websocket';
import Fastify from 'fastify';
import type { AiProvider } from './ai/provider';
import { registerAiRoutes } from './ai/routes';
import { registerOrderBookRoute, type OrderBookFetcher } from './market/orderbookRoutes';
import { registerCors } from './cors';
import { registerAuth, type AuthService } from './auth';
import type { MarketDataProvider } from './market/provider';
import { registerMarketRoutes } from './market/routes';
import { createRealtime } from './realtime';
import { registerAchievementRoutes } from './trading/achievementRoutes';
import type { AchievementService } from './trading/achievements';
import { registerReplayRoutes } from './replay/routes';
import type { ReplayStore } from './replay/store';
import { registerAlertRoutes } from './trading/alertRoutes';
import type { AlertService } from './trading/alerts';
import { registerFcmRoutes } from './trading/fcmRoutes';
import type { PushService } from './trading/push';
import { registerTradingRoutes } from './trading/routes';
import type { TradingService } from './trading/service';
import type { WatchlistService } from './trading/watchlist';

export interface AppOptions {
  provider: MarketDataProvider;
  /** 모의투자 계좌 (없으면 시세 API만) */
  trading?: TradingService;
  /** 관심종목 그룹 */
  watchlists?: WatchlistService;
  /** 가격 알림 (+ 폰 푸시) */
  alerts?: AlertService;
  push?: PushService;
  /** 챌린지·업적 */
  achievements?: AchievementService;
  /** 타임머신 리플레이 결과 저장소 */
  replay?: ReplayStore;
  logger?: boolean;
  /** 비밀번호 로그인 (없으면 로그인 없이) */
  auth?: AuthService;
  /** 빌드된 웹앱 폴더 (있으면 같은 포트에서 같이 서비스) */
  webDir?: string;
  /** 앞에 Caddy 같은 프록시가 있을 때 X-Forwarded-For로 IP 확인 */
  trustProxy?: boolean;
  /** 지수 브로드캐스트 간격 (ms) */
  indicesIntervalMs?: number;
  /** 10단계 호가 (한투 키 있을 때만) */
  orderBook?: OrderBookFetcher;
  /** AI API (키 있을 때만). 없어도 질문 만들기는 됨 */
  ai?: AiProvider | null;
}

export async function buildApp({
  provider,
  trading,
  watchlists,
  alerts,
  push,
  achievements,
  replay,
  orderBook,
  ai,
  auth,
  webDir,
  trustProxy = false,
  logger = false,
  indicesIntervalMs = 3_000,
}: AppOptions) {
  const app = Fastify({ logger, trustProxy });
  // CORS 먼저 (앱의 사전 요청 OPTIONS가 로그인 검사에 막히지 않게)
  registerCors(app);
  await app.register(websocket);
  registerAuth(app, auth);
  if (trading) registerTradingRoutes(app, trading, provider, watchlists);
  if (trading) registerAiRoutes(app, { trading, provider, ai: ai ?? null });
  if (alerts) registerAlertRoutes(app, { provider, alerts, push });
  if (achievements) registerAchievementRoutes(app, achievements);
  if (replay) registerReplayRoutes(app, { provider, store: replay });
  registerOrderBookRoute(app, provider, orderBook);
  registerFcmRoutes(app, push);

  registerMarketRoutes(app, provider, { auth: !!auth });

  const realtime = createRealtime({ provider, trading, alerts, push, achievements, indicesIntervalMs });
  app.addHook('onClose', async () => realtime.stop());

  app.get('/ws', { websocket: true }, (socket) => {
    const client = realtime.connect((m) => {
      if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(m));
    });
    socket.on('message', (raw: Buffer) => client.receive(raw.toString()));
    socket.on('close', () => client.close());
  });

  if (webDir) {
    await app.register(fastifyStatic, {
      root: webDir,
      // 파일명에 해시가 붙은 빌드 결과는 오래 캐시
      setHeaders: (reply, path) => {
        if (/[\\/]assets[\\/]/.test(path)) reply.header('Cache-Control', 'public, max-age=31536000, immutable');
      },
    });
  }

  return app;
}
