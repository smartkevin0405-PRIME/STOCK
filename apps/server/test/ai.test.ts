import type { TradeStats } from '@stock/core';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { AI_SYSTEM, buildAiPrompt } from '../src/ai/prompt';
import { AiError, AnthropicProvider, DEFAULT_ANTHROPIC_MODEL, GeminiProvider, aiFromEnv, type AiProvider, type AiRequest } from '../src/ai/provider';
import { openDb } from '../src/trading/db';
import { TradingService } from '../src/trading/service';
import { KR_OPEN, TestProvider } from './helpers';

/** 가짜 AI: 받은 요청 기록, 정해진 답 */
class FakeAi implements AiProvider {
  readonly name = 'fake';
  readonly model = 'fake-model';
  requests: AiRequest[] = [];
  fail?: Error;
  async generate(req: AiRequest) {
    this.requests.push(req);
    if (this.fail) throw this.fail;
    return '추격매수가 잦아요.';
  }
}

const EMPTY_STATS: TradeStats = {
  count: 0, wins: 0, losses: 0, breakeven: 0, winRate: null, totalPnlKrw: 0, grossProfitKrw: 0, grossLossKrw: 0,
  avgWinKrw: null, avgLossKrw: null, avgWinRate: null, avgLossRate: null, payoffRatio: null, profitFactor: null,
  maxWinStreak: 0, maxLossStreak: 0, holding: null,
};

describe('질문 만들기 (순수 함수)', () => {
  it('기록이 없어도 틀과 고지는 들어감', () => {
    const p = buildAiPrompt({ template: 'habits', now: KR_OPEN, season: 1, entries: [], stocks: {}, stats: EMPTY_STATS });
    expect(p).toContain('[내 매매 습관 분석]');
    expect(p).toContain('모의투자');
    expect(p).toContain('투자 조언이나 특정 종목을 사라·팔라는 추천은 하지 말아 주세요');
    expect(p).toContain('체결 기록이 없어요');
    expect(p).toContain('투자 조언이 아니에요');
  });
});

describe('AI API 라우트', () => {
  const provider = new TestProvider();
  provider.prevCloses.set('005930', 66_000); // 그날 +6% → 추격매수
  let now = KR_OPEN;
  const trading = new TradingService({ db: openDb(':memory:'), provider, now: () => now });
  const ai = new FakeAi();
  let off: Awaited<ReturnType<typeof buildApp>>;
  let on: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    off = await buildApp({ provider, trading });
    on = await buildApp({ provider, trading, ai });
    await trading.placeOrder({ code: '005930', side: 'buy', type: 'market', qty: 10, note: { text: '급등해서 따라 샀음', tags: ['뇌동매매'] } });
    now += 3_600_000;
    provider.prices.set('005930', 63_000);
    await trading.placeOrder({ code: '005930', side: 'sell', type: 'market', qty: 10, note: { text: '무서워서 손절', tags: ['손절'] } });
  });
  afterAll(async () => {
    await off.close();
    await on.close();
  });

  it('키 없으면 꺼짐', async () => {
    expect((await off.inject('/api/ai')).json()).toEqual({ enabled: false, provider: null });
    const res = await off.inject({ method: 'POST', url: '/api/ai/report', payload: { template: 'weekly' } });
    expect(res.statusCode).toBe(404);
  });

  it('이번 주 복기 질문: 매매·메모·태그·통계 포함', async () => {
    const res = await off.inject('/api/ai/prompt?template=weekly');
    expect(res.statusCode).toBe(200);
    const { prompt, title } = res.json();
    expect(title).toBe('이번 주 매매 복기');
    expect(prompt).toContain('삼성전자(005930) 매수 10주');
    expect(prompt).toContain('"급등해서 따라 샀음" #뇌동매매');
    expect(prompt).toContain('#손절');
    expect(prompt).toContain('그날 +6.1%');
    expect(prompt).toContain('청산 1건');
    expect(prompt).toContain('■ 궁금한 점');
  });

  it('이 종목 질문은 종목 필요', async () => {
    expect((await off.inject('/api/ai/prompt?template=stock')).statusCode).toBe(400);
    expect((await off.inject('/api/ai/prompt?template=stock&code=NOPE')).statusCode).toBe(404);
    const { prompt } = (await off.inject('/api/ai/prompt?template=stock&code=005930')).json();
    expect(prompt).toContain('■ 종목: 삼성전자(005930');
    expect(prompt).toContain('이 종목 청산 1건');
    expect(prompt).toContain('지금은 보유하지 않아요');
  });

  it('습관 분석: 코치 결과·태그 빈도', async () => {
    const { prompt } = (await off.inject('/api/ai/prompt?template=habits')).json();
    expect(prompt).toContain('■ 규칙 기반 코치 결과');
    expect(prompt).toContain('#뇌동매매 1회');
  });

  it('잘못된 템플릿 → 400', async () => {
    expect((await off.inject('/api/ai/prompt?template=nope')).statusCode).toBe(400);
  });

  it('키 있으면 앱에서 바로 받기', async () => {
    expect((await on.inject('/api/ai')).json()).toEqual({ enabled: true, provider: 'fake' });
    const res = await on.inject({ method: 'POST', url: '/api/ai/report', payload: { template: 'habits' } });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ text: '추격매수가 잦아요.', provider: 'fake' });
    expect(ai.requests.at(-1)!.system).toBe(AI_SYSTEM);
    expect(ai.requests.at(-1)!.prompt).toContain('[내 매매 습관 분석]');
  });

  it('AI 오류는 이유와 함께', async () => {
    ai.fail = new AiError('AI 요청이 너무 많아요. 잠시 후 다시 시도해 주세요');
    const res = await on.inject({ method: 'POST', url: '/api/ai/report', payload: { template: 'weekly' } });
    expect(res.statusCode).toBe(502);
    expect(res.json().error).toContain('너무 많아요');
    ai.fail = undefined;
    expect((await on.inject({ method: 'POST', url: '/api/ai/report', payload: { template: 'stock' } })).statusCode).toBe(400);
  });
});

/** 가짜 fetch: 요청 기록 + 정해진 응답 */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const fn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(body), { status });
  }) as typeof fetch;
  return { calls, fn };
}

describe('Anthropic 공급자', () => {
  const req = { system: '규칙', prompt: '질문' };

  it('요청 형식 + 텍스트만 모음', async () => {
    const f = fakeFetch(200, {
      content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: '첫 줄. ' }, { type: 'text', text: '둘째 줄.' }],
      stop_reason: 'end_turn',
    });
    const p = new AnthropicProvider({ apiKey: 'sk-test', fetch: f.fn });
    expect(await p.generate(req)).toBe('첫 줄. 둘째 줄.');
    const { url, init } = f.calls[0]!;
    expect(url).toBe('https://api.anthropic.com/v1/messages');
    expect(init.headers).toMatchObject({ 'x-api-key': 'sk-test', 'anthropic-version': '2026-10-21', 'content-type': 'application/json' });
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: DEFAULT_ANTHROPIC_MODEL, system: '규칙', messages: [{ role: 'user', content: '질문' }], fallbacks: 'default' });
    expect(body.max_tokens).toBeGreaterThan(0);
    expect(body).not.toHaveProperty('temperature');
  });

  it('다른 모델이면 대체 모델 설정 안 보냄', () => {
    const { headers, body } = new AnthropicProvider({ apiKey: 'k', model: 'my-model' }).buildRequest(req);
    expect(body.model).toBe('my-model');
    expect(body).not.toHaveProperty('fallbacks');
    expect(headers).not.toHaveProperty('anthropic-beta');
  });

  it('거절·오류·잘림', async () => {
    await expect(new AnthropicProvider({ apiKey: 'k', fetch: fakeFetch(200, { content: [], stop_reason: 'refusal' }).fn }).generate(req)).rejects.toThrow('답하지 않았어요');
    await expect(new AnthropicProvider({ apiKey: 'k', fetch: fakeFetch(429, { type: 'error', error: { type: 'rate_limit_error', message: 'x' } }).fn }).generate(req)).rejects.toThrow('너무 많아요');
    await expect(new AnthropicProvider({ apiKey: 'k', fetch: fakeFetch(401, {}).fn }).generate(req)).rejects.toThrow('API 키');
    const cut = await new AnthropicProvider({ apiKey: 'k', fetch: fakeFetch(200, { content: [{ type: 'text', text: '앞부분' }], stop_reason: 'max_tokens' }).fn }).generate(req);
    expect(cut).toContain('끊겼어요');
  });
});

describe('Gemini 공급자', () => {
  it('요청·응답', async () => {
    const f = fakeFetch(200, { candidates: [{ content: { parts: [{ text: '답' }] }, finishReason: 'STOP' }] });
    expect(await new GeminiProvider({ apiKey: 'g', model: 'm1', fetch: f.fn }).generate({ system: 's', prompt: 'p' })).toBe('답');
    expect(f.calls[0]!.url).toContain('/models/m1:generateContent');
    expect(f.calls[0]!.init.headers).toMatchObject({ 'x-goog-api-key': 'g' });
    const blocked = fakeFetch(200, { promptFeedback: { blockReason: 'SAFETY' } });
    await expect(new GeminiProvider({ apiKey: 'g', fetch: blocked.fn }).generate({ system: 's', prompt: 'p' })).rejects.toThrow('답하지 않았어요');
  });
});

describe('환경변수로 공급자 고르기', () => {
  it('키 없으면 null, 있으면 해당 공급자', () => {
    expect(aiFromEnv({})).toBeNull();
    expect(aiFromEnv({ ANTHROPIC_API_KEY: 'a' })?.name).toBe('anthropic');
    expect(aiFromEnv({ ANTHROPIC_API_KEY: 'a', AI_MODEL: 'm' })?.model).toBe('m');
    expect(aiFromEnv({ GEMINI_API_KEY: 'g' })?.name).toBe('gemini');
    expect(aiFromEnv({ ANTHROPIC_API_KEY: 'a', GEMINI_API_KEY: 'g', AI_PROVIDER: 'gemini' })?.name).toBe('gemini');
    expect(aiFromEnv({ ANTHROPIC_API_KEY: 'a', AI_PROVIDER: 'gemini' })).toBeNull();
  });
});
