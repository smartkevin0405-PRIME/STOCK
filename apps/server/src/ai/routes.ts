import type { FastifyInstance, FastifyReply } from 'fastify';
import type { MarketDataProvider } from '../market/provider';
import type { TradingService } from '../trading/service';
import { StatsService } from '../trading/stats';
import { AI_SYSTEM, AI_TEMPLATES, PromptError, buildAiPrompt, collectPromptInput, isAiTemplate } from './prompt';
import { AiError, type AiProvider } from './provider';

export interface AiRouteDeps {
  trading: TradingService;
  provider: MarketDataProvider;
  /** 없으면 질문 만들기만 (AI API 비활성) */
  ai: AiProvider | null;
  now?: () => number;
}

/**
 * GET  /api/ai              → { enabled, provider }
 * GET  /api/ai/prompt       → { template, title, prompt }  (키 없어도 됨)
 * POST /api/ai/report       → { text }                     (키 있을 때만)
 */
export function registerAiRoutes(app: FastifyInstance, { trading, provider, ai, now }: AiRouteDeps): void {
  const stats = new StatsService(trading, provider, now);

  const makePrompt = async (template: unknown, code: unknown) => {
    if (!isAiTemplate(template)) throw new PromptError(`template은 ${AI_TEMPLATES.map((t) => t.id).join(', ')} 중 하나`);
    const input = await collectPromptInput(template, typeof code === 'string' && code.trim() ? code.trim() : undefined, {
      trading,
      provider,
      stats,
      ...(now ? { now } : {}),
    });
    return { template, title: AI_TEMPLATES.find((t) => t.id === template)!.title, prompt: buildAiPrompt(input) };
  };

  const fail = (reply: FastifyReply, e: unknown) => {
    if (e instanceof PromptError || e instanceof AiError) return reply.code(e.status).send({ error: e.message });
    throw e;
  };

  app.get('/api/ai', async () => ({ enabled: ai !== null, provider: ai?.name ?? null }));

  app.get<{ Querystring: { template?: string; code?: string } }>('/api/ai/prompt', async (req, reply) => {
    try {
      return await makePrompt(req.query.template, req.query.code);
    } catch (e) {
      return fail(reply, e);
    }
  });

  // 유료 API라 한 번에 하나만 (실수로 여러 번 눌러도 한 번만 과금)
  let busy = false;
  app.post<{ Body: { template?: unknown; code?: unknown } }>('/api/ai/report', async (req, reply) => {
    if (!ai) return reply.code(404).send({ error: 'AI API 키가 설정되지 않았어요' });
    if (busy) return reply.code(429).send({ error: '이전 요청을 처리하고 있어요. 잠시만 기다려 주세요' });
    busy = true;
    try {
      const { prompt } = await makePrompt(req.body?.template, req.body?.code);
      const text = await ai.generate({ system: AI_SYSTEM, prompt });
      return { text, provider: ai.name };
    } catch (e) {
      return fail(reply, e);
    } finally {
      busy = false;
    }
  });
}
