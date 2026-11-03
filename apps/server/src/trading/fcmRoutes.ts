import type { FastifyInstance } from 'fastify';
import type { PushService } from './push';
import { TradingError } from './service';

/** 안드로이드 앱 푸시 토큰 등록·해제 */
export function registerFcmRoutes(app: FastifyInstance, push?: PushService): void {
  const devices = () => push?.fcm?.count() ?? 0;
  const readToken = (body: { token?: unknown } | undefined): string => {
    const token = body?.token;
    if (typeof token !== 'string' || token.length < 20 || token.length > 4_096) throw new TradingError('BAD_REQUEST', '푸시 토큰이 올바르지 않아요');
    return token;
  };

  app.get('/api/push/fcm', async () => ({ enabled: !!push?.fcm, devices: devices() }));

  app.post<{ Body: { token?: unknown } }>('/api/push/fcm', async (req, reply) => {
    const fcm = push?.fcm;
    if (!fcm) throw new TradingError('FCM_OFF', '서버에 앱 푸시(Firebase) 설정이 없어요', 503);
    fcm.register(readToken(req.body));
    return reply.code(201).send({ devices: devices() });
  });

  app.post<{ Body: { token?: unknown } }>('/api/push/fcm/unregister', async (req) => {
    push?.fcm?.unregister(readToken(req.body));
    return { devices: devices() };
  });
}
