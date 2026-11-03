// "AI에게 물어보기": 내 매매 기록·일지·통계·코치 결과를 질문 하나로 정리.
// 복사해서 Claude·ChatGPT 앱에 붙여넣거나, AI API 키가 있으면 바로 보냄.
import { buildClosedTrades, COACH_DISCLAIMER, type ClosedTrade, type TradeStats } from '@stock/core';
import type { Currency, JournalEntry, Position, Quote, StockInfo } from '@stock/shared';
import type { MarketDataProvider } from '../market/provider';
import type { TradingService } from '../trading/service';
import { periodStart, type CoachView, type StatsService } from '../trading/stats';

export type AiTemplate = 'weekly' | 'stock' | 'habits';

export const AI_TEMPLATES: readonly { id: AiTemplate; title: string; needsCode: boolean }[] = [
  { id: 'weekly', title: '이번 주 매매 복기', needsCode: false },
  { id: 'stock', title: '이 종목 왜 손해 봤을까', needsCode: true },
  { id: 'habits', title: '내 매매 습관 분석', needsCode: false },
];

export const isAiTemplate = (v: unknown): v is AiTemplate => AI_TEMPLATES.some((t) => t.id === v);

/** AI API로 보낼 때 쓰는 역할 설명 */
export const AI_SYSTEM =
  '너는 주식 모의투자 기록을 같이 돌아보는 코치야. 투자 조언이나 특정 종목 매수·매도 추천은 하지 않아. ' +
  '기록에 있는 사실만 근거로 매매 습관과 원칙을 짚어 줘. 짧고 쉬운 한국어로, 핵심만.';

/** 질문에 넣는 최대 건수 (너무 길면 붙여넣기 힘듦) */
const MAX_ENTRIES = 40;
const MAX_NOTE = 120;

export interface PromptInput {
  template: AiTemplate;
  now: number;
  season: number;
  /** 매매일지 (최신 먼저) — 템플릿에 맞게 이미 걸러진 것 */
  entries: JournalEntry[];
  stocks: Record<string, StockInfo>;
  /** 템플릿 기간의 청산 통계 */
  stats: TradeStats;
  coach?: CoachView;
  /** '이 종목' 템플릿 */
  stock?: StockInfo;
  closed?: ClosedTrade[];
  position?: Position;
  quote?: Quote;
  stopLossRate?: number;
}

const KST = 9 * 3_600_000;
const WEEKDAY = ['일', '월', '화', '수', '목', '금', '토'];

function when(ms: number): string {
  const d = new Date(ms + KST);
  const p = (n: number) => String(n).padStart(2, '0');
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}(${WEEKDAY[d.getUTCDay()]}) ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

function money(v: number, ccy: Currency, signed = false): string {
  const sign = signed && v > 0 ? '+' : v < 0 ? '-' : '';
  const a = Math.abs(v);
  return ccy === 'KRW' ? `${sign}${Math.round(a).toLocaleString('ko-KR')}원` : `${sign}$${a.toFixed(2)}`;
}

const pct = (r: number, signed = true) => `${signed && r > 0 ? '+' : ''}${(r * 100).toFixed(1)}%`;

function nameOf(code: string, stocks: Record<string, StockInfo>): string {
  const s = stocks[code];
  return s ? `${s.nameKo}(${code})` : code;
}

/** 일지 한 줄: 언제·무엇·얼마·결과·메모 */
export function entryLine(e: JournalEntry, stocks: Record<string, StockInfo>): string {
  const fills = e.fills;
  const qty = fills.reduce((s, f) => s + f.qty, 0);
  const amount = fills.reduce((s, f) => s + f.amount, 0);
  const ccy = fills[0]?.currency ?? 'KRW';
  const at = fills[fills.length - 1]?.executedAt ?? e.order.createdAt;
  const parts = [`${when(at)} ${nameOf(e.order.code, stocks)} ${e.order.side === 'buy' ? '매수' : '매도'} ${qty}주 @${money(qty ? amount / qty : 0, ccy)}`];
  const day = fills[0]?.dayChangeRate;
  if (day !== undefined) parts.push(`그날 ${pct(day)}`);
  if (e.order.side === 'sell') {
    const pnl = fills.reduce((s, f) => s + (f.realizedPnl ?? 0), 0);
    parts.push(`실현손익 ${money(pnl, ccy, true)}`);
  }
  const note = e.note;
  if (note && (note.text.trim() || note.tags.length)) {
    const text = note.text.trim().replace(/\s+/g, ' ');
    const short = text.length > MAX_NOTE ? `${text.slice(0, MAX_NOTE)}…` : text;
    parts.push(`메모: ${[short ? `"${short}"` : '', ...note.tags.map((t) => `#${t}`)].filter(Boolean).join(' ')}`);
  }
  return `- ${parts.join(' · ')}`;
}

function statsLines(s: TradeStats): string[] {
  if (s.count === 0) return ['- 아직 다 판(청산) 거래가 없어요'];
  const krw = (v: number | null) => (v === null ? '-' : money(v, 'KRW', true));
  const lines = [
    `- 청산 ${s.count}건 (수익 ${s.wins} · 손실 ${s.losses}), 승률 ${s.winRate === null ? '-' : pct(s.winRate, false)}`,
    `- 실현손익 합계 ${krw(s.totalPnlKrw)}, 평균 수익 ${krw(s.avgWinKrw)}, 평균 손실 ${krw(s.avgLossKrw)}`,
    `- 손익비 ${s.payoffRatio === null ? '-' : s.payoffRatio.toFixed(2)}, 최대 연승 ${s.maxWinStreak} · 최대 연패 ${s.maxLossStreak}`,
  ];
  if (s.holding) lines.push(`- 보유기간 평균 ${s.holding.avgDays.toFixed(1)}일 (중간값 ${s.holding.medianDays.toFixed(1)}일)`);
  return lines;
}

function coachLines(c: CoachView | undefined, stocks: Record<string, StockInfo>): string[] {
  if (!c) return [];
  const hits = c.report.findings.filter((f) => f.triggered);
  const lines = hits.map((f) => `- ${f.title}: ${f.message}`);
  if (c.concentration?.triggered) lines.push(`- 집중도: 자산의 ${pct(c.concentration.weight, false)}가 ${nameOf(c.concentration.code, stocks)} 한 종목에 있어요`);
  return lines.length ? lines : ['- 규칙 기반 코치가 짚은 습관은 아직 없어요'];
}

function tagLines(entries: JournalEntry[]): string[] {
  const count = new Map<string, number>();
  for (const e of entries) for (const t of e.note?.tags ?? []) count.set(t, (count.get(t) ?? 0) + 1);
  const top = [...count].sort((a, b) => b[1] - a[1]).slice(0, 10);
  return top.length ? [`- ${top.map(([t, n]) => `#${t} ${n}회`).join(', ')}`] : [];
}

function entryLines(entries: JournalEntry[], stocks: Record<string, StockInfo>): string[] {
  if (entries.length === 0) return ['- 체결 기록이 없어요'];
  // 오래된 것부터 읽기 좋게
  const shown = entries.slice(0, MAX_ENTRIES).reverse().map((e) => entryLine(e, stocks));
  if (entries.length > MAX_ENTRIES) shown.unshift(`- (최근 ${MAX_ENTRIES}건만, 전체 ${entries.length}건)`);
  return shown;
}

const INTRO: Record<AiTemplate, string> = {
  weekly: '이번 주 매매를 같이 복기해 주세요.',
  stock: '이 종목 매매에서 왜 손해(또는 수익)가 났는지 같이 따져 봐 주세요.',
  habits: '제 매매 습관을 분석해 주세요.',
};

const QUESTIONS: Record<AiTemplate, string[]> = {
  weekly: ['이번 주에 잘한 점과 아쉬운 점', '메모에 적은 이유와 실제 결과가 맞았는지', '다음 주에 지킬 원칙 2~3개'],
  stock: ['손익이 난 이유를 사고판 시점과 메모 기준으로', '제 원칙(손절 기준 등)을 지켰는지', '비슷한 상황이 오면 다르게 해볼 점'],
  habits: ['기록에서 반복되는 습관 (좋은 것·나쁜 것)', '통계와 코치 결과가 보여주는 약점', '당장 바꿔볼 매매 규칙 3가지'],
};

/** 템플릿 + 내 데이터 → 붙여넣기용 질문 */
export function buildAiPrompt(input: PromptInput): string {
  const { template, stocks } = input;
  const title = AI_TEMPLATES.find((t) => t.id === template)!.title;
  const out: string[] = [
    `[${title}] 아래는 제 주식 모의투자(가상 돈) 기록이에요. ${INTRO[template]}`,
    '- 투자 조언이나 특정 종목을 사라·팔라는 추천은 하지 말아 주세요.',
    '- 기록에 있는 사실을 근거로 제 매매 습관과 원칙을 짚어 주세요.',
    '- 짧고 쉬운 한국어로, 핵심 3~5가지만 알려 주세요.',
    '',
    `기준: ${when(input.now)} (한국시간), 시즌 ${input.season}${input.stopLossRate !== undefined ? `, 내 손절 기준 ${pct(input.stopLossRate)}` : ''}`,
  ];

  if (template === 'stock' && input.stock) {
    const s = input.stock;
    out.push('', `■ 종목: ${s.nameKo}(${s.code}, ${s.exchange})`);
    if (input.quote) out.push(`- 지금 가격 ${money(input.quote.price, s.currency)} (어제보다 ${pct(input.quote.changeRate)})`);
    if (input.position) {
      const p = input.position;
      const rate = input.quote ? ` · 평가 ${pct(input.quote.price / p.avgPrice - 1)}` : '';
      out.push(`- 지금 보유 ${p.qty}주, 평균단가 ${money(p.avgPrice, p.currency)}${rate}`);
    } else out.push('- 지금은 보유하지 않아요');
    const closed = input.closed ?? [];
    if (closed.length) {
      const ccy = closed[0]!.currency;
      const total = closed.reduce((sum, t) => sum + t.pnl, 0);
      out.push(`- 이 종목 청산 ${closed.length}건, 실현손익 합계 ${money(total, ccy, true)}`);
      for (const t of closed.slice(-10)) {
        out.push(`  · ${when(t.closedAt)} ${t.qty}주 ${money(t.entryPrice, ccy)} → ${money(t.exitPrice, ccy)} (${pct(t.pnlRate)}, ${(t.holdingMs / 86_400_000).toFixed(1)}일 보유)`);
      }
    }
  }

  const periodLabel = template === 'weekly' ? '이번 주' : '이번 시즌';
  if (template !== 'stock') out.push('', `■ ${periodLabel} 통계`, ...statsLines(input.stats));

  const coach = coachLines(input.coach, stocks);
  if (template !== 'stock' && coach.length) out.push('', '■ 규칙 기반 코치 결과 (이번 시즌 전체)', ...coach);

  if (template === 'habits') {
    const tags = tagLines(input.entries);
    if (tags.length) out.push('', '■ 일지에 많이 단 태그', ...tags);
  }

  const listTitle = template === 'weekly' ? '이번 주 매매 기록' : template === 'stock' ? '이 종목 매매 기록' : '최근 매매 기록';
  out.push('', `■ ${listTitle} (체결 시각 · 종목 · 수량 @평균가 · 그날 등락 · 결과 · 메모)`, ...entryLines(input.entries, stocks));

  out.push('', '■ 궁금한 점', ...QUESTIONS[template].map((q, i) => `${i + 1}. ${q}`));
  out.push('', `※ ${COACH_DISCLAIMER}`);
  return out.join('\n');
}

/** 요청이 잘못됐을 때 (화면에 그대로 표시) */
export class PromptError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface PromptDeps {
  trading: TradingService;
  provider: MarketDataProvider;
  stats: StatsService;
  now?: () => number;
}

/** 서버 데이터에서 템플릿에 맞는 재료 모으기 */
export async function collectPromptInput(template: AiTemplate, code: string | undefined, deps: PromptDeps): Promise<PromptInput> {
  const { trading, provider, stats } = deps;
  const now = (deps.now ?? Date.now)();
  const acc = trading.account();
  const all = trading.journal(500);
  const executedAt = (e: JournalEntry) => e.fills[e.fills.length - 1]?.executedAt ?? e.order.createdAt;
  const stopLoss = trading.repo.getSetting('stopLossRate');
  const stopLossRate = stopLoss !== undefined ? Number(stopLoss) : undefined;

  let entries = all;
  let input: Partial<PromptInput> = {};

  if (template === 'stock') {
    if (!code) throw new PromptError('종목을 골라 주세요');
    const stock = await provider.getStock(code);
    if (!stock) throw new PromptError('종목을 찾을 수 없어요', 404);
    entries = all.filter((e) => e.order.code === stock.code);
    const closed = buildClosedTrades(trading.repo.allFills(acc.id)).filter((t) => t.code === stock.code);
    const position = trading.view().positions.find((p) => p.code === stock.code);
    const [quote] = await provider.getQuotes([stock.code]).catch(() => [] as Quote[]);
    input = { stock, closed, ...(position ? { position } : {}), ...(quote ? { quote } : {}) };
  } else if (template === 'weekly') {
    const from = periodStart('week', now)!;
    entries = all.filter((e) => executedAt(e) >= from);
  }

  const [view, coach] = await Promise.all([stats.stats(template === 'weekly' ? 'week' : 'all'), template === 'stock' ? undefined : stats.coach()]);
  const codes = new Set(entries.map((e) => e.order.code));
  if (coach?.concentration) codes.add(coach.concentration.code);
  const list = await Promise.all([...codes].map((c) => provider.getStock(c)));
  const stocks = Object.fromEntries(list.flatMap((s) => (s ? [[s.code, s]] : [])));

  return {
    template,
    now,
    season: acc.season,
    entries,
    stocks,
    stats: view.trades,
    ...(coach ? { coach } : {}),
    ...(stopLossRate !== undefined ? { stopLossRate } : {}),
    ...input,
  };
}
