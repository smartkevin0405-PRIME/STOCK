import type { ReplayScenariosResponse, StockInfo } from '@stock/shared';
import type { FastifyInstance, FastifyReply } from 'fastify';
import type { MarketDataProvider } from '../market/provider';
import { REPLAY_SCENARIOS, findScenario } from './scenarios';
import type { ReplayStore } from './store';

const DAY_MS = 86_400_000;
/** 일봉 요청은 이 날짜부터, 최대 3년치까지 */
const MIN_FROM = Date.UTC(1990, 0, 1);
const MAX_RANGE = 3 * 366 * DAY_MS;

const bad = (reply: FastifyReply, error: string, status = 400) => reply.code(status).send({ error, code: 'BAD_REQUEST' });
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** 타임머신 리플레이 API: 시나리오, 과거 일봉, 결과 기록 */
export function registerReplayRoutes(app: FastifyInstance, o: { provider: MarketDataProvider; store: ReplayStore }): void {
  const { provider, store } = o;
  const now = () => store.now();

  app.get('/api/replay/scenarios', async (): Promise<ReplayScenariosResponse> => {
    const codes = [...new Set(REPLAY_SCENARIOS.flatMap((s) => s.codes))];
    const stocks = await Promise.all(codes.map((c) => provider.getStock(c)));
    return {
      scenarios: [...REPLAY_SCENARIOS],
      stocks: Object.fromEntries(stocks.flatMap((s): [string, StockInfo][] => (s ? [[s.code, s]] : []))),
    };
  });

  app.get<{ Querystring: { code?: string; from?: string; to?: string } }>('/api/replay/history', async (req, reply) => {
    const code = req.query.code?.trim() ?? '';
    const from = Number(req.query.from);
    const to = Number(req.query.to);
    if (!code) return bad(reply, '종목 코드가 필요해요');
    if (!Number.isFinite(from) || !Number.isFinite(to) || from >= to) return bad(reply, '기간(from, to)이 올바르지 않아요');
    if (from < MIN_FROM || to > now() + DAY_MS) return bad(reply, '1990년부터 오늘까지만 볼 수 있어요');
    if (to - from > MAX_RANGE) return bad(reply, '한 번에 3년까지만 볼 수 있어요');
    const stock = await provider.getStock(code);
    if (!stock) return bad(reply, '종목을 찾을 수 없어요', 404);
    try {
      return { stock, candles: await provider.getHistory(code, from, to) };
    } catch (e) {
      return reply.code(502).send({ error: `과거 시세를 불러오지 못했어요: ${(e as Error).message}` });
    }
  });

  app.get<{ Querystring: { scenarioId?: string } }>('/api/replay/results', async (req) => ({
    results: store.list(req.query.scenarioId || undefined),
  }));

  app.post<{ Body: Record<string, unknown> }>('/api/replay/results', async (req, reply) => {
    const { scenarioId, codes, finalValue, returnRate, tradeCount, finishedAt } = req.body ?? {};
    const scenario = typeof scenarioId === 'string' ? findScenario(scenarioId) : undefined;
    if (!scenario) return bad(reply, '시나리오를 찾을 수 없어요');
    if (
      !Array.isArray(codes) ||
      codes.length === 0 ||
      !codes.every((c) => typeof c === 'string' && scenario.codes.includes(c)) ||
      new Set(codes).size !== codes.length
    ) {
      return bad(reply, '종목 목록이 올바르지 않아요');
    }
    if (!isNum(finalValue) || finalValue < 0 || finalValue > scenario.startCash * 1_000) return bad(reply, '최종 금액이 올바르지 않아요');
    const expected = (finalValue - scenario.startCash) / scenario.startCash;
    if (!isNum(returnRate) || Math.abs(returnRate - expected) > 1e-6) return bad(reply, '수익률이 최종 금액과 맞지 않아요');
    if (!Number.isInteger(tradeCount) || (tradeCount as number) < 0 || (tradeCount as number) > 100_000) return bad(reply, '거래 횟수가 올바르지 않아요');
    const t = now();
    if (finishedAt !== undefined && (!isNum(finishedAt) || finishedAt < MIN_FROM || finishedAt > t + DAY_MS)) return bad(reply, '끝난 시각이 올바르지 않아요');

    const result = store.save({
      scenarioId: scenario.id,
      codes: codes as string[],
      startCash: scenario.startCash,
      finalValue,
      returnRate: expected,
      tradeCount: tradeCount as number,
      finishedAt: (finishedAt as number | undefined) ?? t,
    });
    return reply.code(201).send({ result });
  });
}
