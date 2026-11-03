import type { FastifyInstance } from 'fastify';
import type { AchievementService } from './achievements';

/** 챌린지·업적 API + 매매 이벤트·설정 변경 뒤 다시 확인 */
export function registerAchievementRoutes(app: FastifyInstance, achievements: AchievementService): void {
  app.get('/api/achievements', async () => achievements.view());

  // 알림·관심 그룹·일지·설정처럼 매매 이벤트가 없는 변경도 응답 뒤에 다시 확인
  app.addHook('onResponse', async (req, reply) => {
    if (req.method === 'GET' || reply.statusCode >= 400 || !req.url.startsWith('/api/') || req.url.startsWith('/api/push')) return;
    void achievements.check().catch(() => undefined);
  });

  const stop = achievements.start();
  app.addHook('onClose', async () => {
    stop();
  });
}
