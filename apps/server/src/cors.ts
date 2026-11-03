import type { FastifyInstance } from 'fastify';

/**
 * 안드로이드 앱(Capacitor) 화면은 https://localhost 에서 열려서
 * 서버 주소가 달라 CORS 허용이 필요. 웹은 같은 주소라 상관없음.
 * 더 허용할 곳은 환경변수 CORS_ORIGINS (쉼표로 구분)
 */
const APP_ORIGINS = ['https://localhost', 'http://localhost', 'capacitor://localhost'];

export function registerCors(app: FastifyInstance, extra = process.env.CORS_ORIGINS ?? ''): void {
  const allowed = new Set([...APP_ORIGINS, ...extra.split(',').map((s) => s.trim()).filter(Boolean)]);

  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (!origin || !allowed.has(origin)) return;
    reply.header('Access-Control-Allow-Origin', origin);
    reply.header('Vary', 'Origin');
    if (req.method === 'OPTIONS') {
      reply.header('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
      reply.header('Access-Control-Max-Age', '86400');
      return reply.code(204).send();
    }
  });
}
