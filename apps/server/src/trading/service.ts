import {
  DEFAULT_CONFIG,
  applyFill,
  evaluatePortfolio,
  isMarketOpen,
  quoteFx,
  roundMoney,
  sessionCloseAt,
  tryFill,
  validateOrder,
  type FillMode,
  type TradingConfig,
} from '@stock/core';
import type {
  AccountEvent,
  AccountView,
  Candle,
  Currency,
  Fill,
  FxTrade,
  JournalEntry,
  JournalNote,
  Market,
  Order,
  OrderSide,
  OrderType,
  Quote,
  SeasonSummary,
  StockInfo,
} from '@stock/shared';
import type { DatabaseSync } from 'node:sqlite';
import type { MarketDataProvider } from '../market/provider';
import { transaction } from './schema';
import { TradingRepo, type AccountRow, type SnapshotRow } from './repo';

/** 하루 = 한국시간 오전 7시 ~ 다음 날 오전 7시 (미국 장 끝난 뒤, 한국 장 열리기 전) */
export function dayKey(ms: number): string {
  return new Date(ms + (9 - 7) * 3_600_000).toISOString().slice(0, 10);
}

export const SEED_KRW = 10_000_000;

/** 화면에 그대로 보여줄 수 있는 사유가 담긴 오류 */
export class TradingError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}

export interface PlaceOrderInput {
  code: string;
  side: OrderSide;
  type: OrderType;
  qty: number;
  limitPrice?: number;
  /** 매매일지 메모 (선택) */
  note?: JournalNote;
}

/** 메모 정리: 앞뒤 공백 제거, 길이 제한, 태그 중복 제거 */
export function cleanNote(note: JournalNote): JournalNote {
  return {
    text: note.text.trim().slice(0, 2_000),
    tags: [...new Set(note.tags.map((t) => t.trim()).filter(Boolean))].slice(0, 10).map((t) => t.slice(0, 20)),
  };
}

export interface TradingServiceOptions {
  db: DatabaseSync;
  provider: MarketDataProvider;
  config?: TradingConfig;
  now?: () => number;
  seedKrw?: number;
}

const EXPIRED = '장 마감까지 체결되지 않아 자동 취소됐어요';

/** 감시가 이만큼 멈춰 있었으면 (앱이 꺼져 있었으면) 그동안의 봉으로 체결 확인 */
const CATCH_UP_GAP = 60_000;
const BAR_MS = 5 * 60_000;

/**
 * 감시가 멈춰 있던 [start, end) 동안 5분봉으로 주문이 닿았던 첫 봉과 체결 가격 찾기.
 * - 지정가: 봉의 저가(매수)·고가(매도)가 지정가에 닿으면 지정가로 체결.
 *   다만 장 시작 봉(예약주문)이나 창이 열린 뒤 시작한 봉의 시가가 이미 지정가보다 유리하면 시가로 체결
 * - 시장가(예약): 첫 장중 봉의 시가로 체결
 */
export function findCatchUpFill(order: Order, bars: Candle[], start: number, end: number): { price: number; at: number; prevClose?: number } | null {
  let session: number | undefined; // 지금 봉이 속한 장의 마감 시각
  let lastClose: number | undefined; // 직전 장중 봉의 종가
  let base: number | undefined; // 이 장 직전 장의 종가 (등락률용)
  for (const bar of [...bars].sort((a, b) => a.time - b.time)) {
    const t = bar.time * 1000;
    if (t >= end) break;
    if (!isMarketOpen(order.market, t)) continue;
    const close = sessionCloseAt(order.market, t);
    if (close !== session) {
      session = close;
      base = lastClose;
    }
    lastClose = bar.close;
    if (t < start - BAR_MS) continue;

    const at = Math.max(t, start);
    if (order.type === 'market') return { price: bar.open, at, prevClose: base };
    const limit = order.limitPrice;
    if (limit === undefined) return null;
    const buy = order.side === 'buy';
    if (buy ? bar.low > limit : bar.high < limit) continue;
    const opening = !isMarketOpen(order.market, t - BAR_MS);
    const better = buy ? bar.open <= limit : bar.open >= limit;
    const gap = (order.status === 'reserved' && opening) || (better && t > start);
    const price = gap ? (buy ? Math.min(limit, bar.open) : Math.max(limit, bar.open)) : limit;
    return { price, at, prevClose: base };
  }
  return null;
}

/**
 * 모의투자 계좌: 주문 → 체결 → 잔고 반영.
 * - 장중: 시장가는 바로 체결, 지정가는 가격이 닿을 때까지 대기
 * - 장 밖: 예약주문으로 저장했다가 다음 장 시작에 처리
 * - 당일 주문: 그 장 마감까지 안 되면 자동 취소
 */
export class TradingService {
  readonly repo: TradingRepo;
  private readonly provider: MarketDataProvider;
  private readonly config: TradingConfig;
  private readonly now: () => number;
  private readonly seedKrw: number;
  private readonly listeners = new Set<(e: AccountEvent) => void>();
  private timer: ReturnType<typeof setInterval> | undefined;
  private snapshotTimer: ReturnType<typeof setInterval> | undefined;
  private processing = false;
  /** 마지막으로 미체결 주문을 확인한 시각 (앱이 꺼져 있던 공백 감지용) */
  private lastRunAt: number | undefined;

  constructor(o: TradingServiceOptions) {
    this.repo = new TradingRepo(o.db);
    this.provider = o.provider;
    this.config = o.config ?? DEFAULT_CONFIG;
    this.now = o.now ?? Date.now;
    this.seedKrw = o.seedKrw ?? SEED_KRW;
  }

  onEvent(listener: (e: AccountEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 미체결 주문 감시 시작 (3초마다) + 하루 자산 기록 (1분마다 확인) */
  start(intervalMs = 3_000): void {
    this.syncWatch();
    this.timer ??= setInterval(() => void this.processOpenOrders().catch(() => undefined), intervalMs);
    void this.snapshotIfDue().catch(() => undefined);
    this.snapshotTimer ??= setInterval(() => void this.snapshotIfDue().catch(() => undefined), 60_000);
  }

  stop(): void {
    clearInterval(this.timer);
    clearInterval(this.snapshotTimer);
    this.timer = undefined;
    this.snapshotTimer = undefined;
  }

  // ── 계좌 ──────────────────────────────────────────────

  /** 지금 시즌 계좌 (없으면 시즌 1 생성) */
  account(): AccountRow {
    return this.repo.activeAccount() ?? this.openAccount(1);
  }

  /** 새 계좌 + 시작 기록 (현금만 있으니 총자산 = 시드) */
  private openAccount(season: number): AccountRow {
    const acc = this.repo.createAccount(season, this.seedKrw, this.now());
    this.repo.insertSnapshot(acc.id, { day: dayKey(this.now()), totalKrw: this.seedKrw, stockKrw: 0, cash: acc.cash, usdKrw: 0, createdAt: this.now() });
    return acc;
  }

  /** 오늘 기록이 없으면 지금 자산으로 남김 (오전 7시 이후 첫 확인 때) */
  async snapshotIfDue(): Promise<SnapshotRow | undefined> {
    const acc = this.account();
    const day = dayKey(this.now());
    const existing = this.repo.snapshot(acc.id, day);
    if (existing) return existing;
    const v = await this.valueOf(acc);
    const snap: SnapshotRow = { day, totalKrw: v.totalKrw, stockKrw: v.stockValueKrw, cash: acc.cash, usdKrw: v.usdKrw, createdAt: this.now() };
    this.repo.insertSnapshot(acc.id, snap);
    return this.repo.snapshot(acc.id, day);
  }

  snapshots(limit?: number): SnapshotRow[] {
    return this.repo.snapshots(this.account().id, limit);
  }

  view(): AccountView {
    const acc = this.account();
    const positions = this.repo.positions(acc.id);
    const holds = this.repo.holds(acc.id);
    const pendingSell = this.repo.pendingSellQty(acc.id);
    return {
      season: acc.season,
      seedKrw: acc.seedKrw,
      createdAt: acc.createdAt,
      cash: acc.cash,
      available: {
        KRW: roundMoney(acc.cash.KRW - holds.KRW, 'KRW', 'round'),
        USD: roundMoney(acc.cash.USD - holds.USD, 'USD', 'round'),
      },
      positions: Object.values(positions),
      sellable: Object.fromEntries(Object.values(positions).map((p) => [p.code, Math.max(0, p.qty - (pendingSell[p.code] ?? 0))])),
      realizedPnl: this.repo.realizedPnl(acc.id),
      openOrders: this.repo.openOrders(acc.id).length,
      ...(() => {
        const rate = this.repo.avgUsdRate(acc.id);
        return rate ? { avgUsdRate: rate } : {};
      })(),
      ...(() => {
        const base = this.repo.snapshot(acc.id, dayKey(this.now()));
        return base ? { dayBase: { day: base.day, totalKrw: base.totalKrw } } : {};
      })(),
    };
  }

  orders(limit?: number): Order[] {
    return this.repo.orders(this.account().id, limit);
  }

  openOrders(): Order[] {
    return this.repo.openOrders(this.account().id);
  }

  fills(limit?: number, code?: string): Fill[] {
    return this.repo.fills(this.account().id, limit, code);
  }

  fxTrades(limit?: number): FxTrade[] {
    return this.repo.fxTrades(this.account().id, limit);
  }

  /** 매매일지: 체결된 주문 + 체결 내역 + 메모 */
  journal(limit = 100): JournalEntry[] {
    const acc = this.account();
    const orders = this.repo.filledOrders(acc.id, limit);
    const ids = orders.map((o) => o.id);
    const notes = this.repo.notes(ids);
    const fills = this.repo.fillsOfOrders(ids);
    return orders.map((order) => {
      const note = notes.get(order.id);
      return { order, fills: fills.filter((f) => f.orderId === order.id), ...(note ? { note } : {}) };
    });
  }

  /** 메모 쓰기·고치기 (내 주문만) */
  saveNote(orderId: string, note: JournalNote): JournalNote {
    const o = this.repo.order(orderId);
    if (!o || o.accountId !== this.account().id) throw new TradingError('NOT_FOUND', '주문을 찾을 수 없어요', 404);
    this.repo.upsertNote(o.accountId, orderId, cleanNote(note), this.now());
    return this.repo.notes([orderId]).get(orderId)!;
  }

  seasons(): SeasonSummary[] {
    return this.repo.accounts().map((a) => ({
      season: a.season,
      seedKrw: a.seedKrw,
      startedAt: a.createdAt,
      ...(a.closedAt ? { endedAt: a.closedAt } : {}),
      ...(a.finalValueKrw !== undefined ? { finalKrw: a.finalValueKrw } : {}),
      trades: this.repo.fillCount(a.id),
    }));
  }

  // ── 주문 ──────────────────────────────────────────────

  async placeOrder(input: PlaceOrderInput): Promise<{ order: Order; fill?: Fill }> {
    const stock = await this.provider.getStock(input.code);
    if (!stock) throw new TradingError('NOT_FOUND', '종목을 찾을 수 없어요', 404);
    const quote = await this.quoteOf(stock.code);

    const acc = this.account();
    const ccy = stock.currency;
    const v = validateOrder(
      { stock, side: input.side, type: input.type, qty: input.qty, limitPrice: input.type === 'limit' ? input.limitPrice : undefined },
      {
        quote,
        cash: acc.cash,
        position: this.repo.positions(acc.id)[stock.code],
        pendingSellQty: this.repo.pendingSellQty(acc.id)[stock.code] ?? 0,
        pendingBuyAmount: this.repo.holds(acc.id)[ccy],
        config: this.config,
      },
    );
    if (!v.ok) throw new TradingError(v.code, v.message);

    const now = this.now();
    const open = this.isOpen(stock.market, quote);
    const order: Order = {
      id: globalThis.crypto.randomUUID(),
      code: stock.code,
      market: stock.market,
      side: input.side,
      type: input.type,
      qty: input.qty,
      ...(input.type === 'limit' ? { limitPrice: input.limitPrice } : {}),
      status: open ? 'pending' : 'reserved',
      holdAmount: input.side === 'buy' ? v.estimate.total : 0,
      createdAt: now,
      updatedAt: now,
      expiresAt: sessionCloseAt(stock.market, now),
    };
    this.repo.insertOrder(acc.id, order);
    if (input.note) {
      const note = cleanNote(input.note);
      if (note.text || note.tags.length) this.repo.upsertNote(acc.id, order.id, note, now);
    }

    const fill = open ? this.execute(order.id, quote, 'taker', stock) : null;
    const saved = this.repo.order(order.id)!;
    if (!fill) this.emit({ event: 'order', order: saved, stock });
    this.syncWatch();
    return { order: saved, ...(fill ? { fill } : {}) };
  }

  cancelOrder(id: string, reason = '취소했어요'): Order {
    const o = this.ownOpenOrder(id);
    this.repo.updateOrder(o.id, { status: 'cancelled', reason }, this.now());
    const saved = this.repo.order(o.id)!;
    this.emit({ event: 'order', order: saved });
    this.syncWatch();
    return saved;
  }

  /** 정정: 수량·가격 변경 (지정가만). 자기 주문에 묶인 돈·수량은 빼고 다시 검사 */
  async amendOrder(id: string, patch: { qty?: number; limitPrice?: number }): Promise<Order> {
    const o = this.ownOpenOrder(id);
    if (o.type !== 'limit') throw new TradingError('NOT_AMENDABLE', '시장가 주문은 정정할 수 없어요. 취소 후 다시 주문해주세요');
    const stock = await this.provider.getStock(o.code);
    if (!stock) throw new TradingError('NOT_FOUND', '종목을 찾을 수 없어요', 404);
    const quote = await this.quoteOf(o.code);
    const acc = this.account();
    const qty = patch.qty ?? o.qty;
    const limitPrice = patch.limitPrice ?? o.limitPrice;

    const v = validateOrder(
      { stock, side: o.side, type: 'limit', qty, limitPrice },
      {
        quote,
        cash: acc.cash,
        position: this.repo.positions(acc.id)[o.code],
        pendingSellQty: this.repo.pendingSellQty(acc.id, o.id)[o.code] ?? 0,
        pendingBuyAmount: this.repo.holds(acc.id, o.id)[stock.currency],
        config: this.config,
      },
    );
    if (!v.ok) throw new TradingError(v.code, v.message);
    this.repo.updateOrder(o.id, { qty, limitPrice, holdAmount: o.side === 'buy' ? v.estimate.total : 0 }, this.now());

    if (o.status === 'pending' && this.isOpen(stock.market, quote)) {
      const fill = this.execute(o.id, quote, 'taker', stock);
      if (fill) return this.repo.order(o.id)!;
    }
    const saved = this.repo.order(o.id)!;
    this.emit({ event: 'order', order: saved, stock });
    return saved;
  }

  /** 미체결 주문 처리: (공백 따라잡기) → 만료 취소 → 시세 확인 → 체결 */
  async processOpenOrders(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    const now = this.now();
    try {
      // 처음 돌거나 한동안 멈춰 있었으면 그사이 가격이 닿았던 주문부터 체결 (만료 취소보다 먼저)
      if (this.lastRunAt === undefined || now - this.lastRunAt > CATCH_UP_GAP) await this.catchUp(this.lastRunAt);
      let open = this.openOrders();
      for (const o of open) if (o.expiresAt && now >= o.expiresAt) this.cancelOrder(o.id, EXPIRED);
      open = this.openOrders();
      if (open.length === 0) return;

      const quotes = new Map((await this.provider.getQuotes([...new Set(open.map((o) => o.code))])).map((q) => [q.code, q]));
      for (const o of open) {
        const quote = quotes.get(o.code);
        if (!quote || !this.isOpen(o.market, quote)) continue;
        // 예약주문은 장 시작 때 시장에 '들어오는' 주문 → 지금 가격으로 체결 가능
        const mode: FillMode = o.status === 'reserved' ? 'taker' : 'resting';
        const stock = await this.provider.getStock(o.code);
        const fill = this.execute(o.id, quote, mode, stock, true);
        // 예약주문이 장 시작에 안 닿았으면 일반 대기 주문으로 (거부된 주문은 그대로 둠)
        if (!fill && this.repo.order(o.id)?.status === 'reserved') {
          this.repo.updateOrder(o.id, { status: 'pending' }, this.now());
          this.emit({ event: 'order', order: this.repo.order(o.id)! });
        }
      }
    } finally {
      this.lastRunAt = now;
      this.processing = false;
      this.syncWatch();
    }
  }

  /** 감시가 멈춰 있던 동안(since 이후) 5분봉을 보고, 가격이 닿았던 주문을 그 봉 시각으로 체결 */
  private async catchUp(since?: number): Promise<void> {
    const now = this.now();
    const candles = new Map<string, Promise<Candle[]>>();
    const hits: { order: Order; quote: Quote; at: number }[] = [];
    for (const o of this.openOrders()) {
      const start = Math.max(o.createdAt, since ?? 0);
      const end = Math.min(o.expiresAt ?? now, now);
      if (start >= end) continue;
      let bars: Candle[];
      try {
        if (!candles.has(o.code)) candles.set(o.code, this.provider.getCandles(o.code, '5m', 300));
        bars = await candles.get(o.code)!;
      } catch {
        continue; // 봉을 못 받으면 건너뜀 (기존처럼 만료되면 취소)
      }
      const hit = findCatchUpFill(o, bars, start, end);
      if (!hit) continue;
      const prevClose = hit.prevClose ?? hit.price;
      const quote: Quote = {
        code: o.code,
        price: hit.price,
        bid: hit.price,
        ask: hit.price,
        prevClose,
        volume: 0,
        change: hit.price - prevClose,
        changeRate: prevClose ? (hit.price - prevClose) / prevClose : 0,
        timestamp: hit.at,
      };
      hits.push({ order: o, quote, at: hit.at });
    }
    // 실제로 닿은 시간 순서대로 체결 (먼저 판 돈으로 나중에 사는 경우 등)
    for (const h of hits.sort((x, y) => x.at - y.at)) {
      const stock = await this.provider.getStock(h.order.code).catch(() => undefined);
      // 호가 = 체결가로 두고 taker로 체결 → 정확히 그 가격에 체결 (잔고 확인·거부·알림은 평소 경로 그대로)
      this.execute(h.order.id, h.quote, 'taker', stock, true, h.at);
    }
  }

  // ── 환전 ──────────────────────────────────────────────

  async exchange(from: Currency, amount: number): Promise<FxTrade> {
    if (!(amount > 0)) throw new TradingError('INVALID_AMOUNT', '환전할 금액을 입력해주세요');
    const pay = roundMoney(amount, from, 'floor');
    const acc = this.account();
    const available = acc.cash[from] - this.repo.holds(acc.id)[from];
    if (pay > available + 1e-9) throw new TradingError('INSUFFICIENT_CASH', '환전 가능한 금액이 부족해요');

    const base = await this.provider.getUsdKrw();
    const q = quoteFx(from, pay, base, this.config);
    if (q.receive <= 0) throw new TradingError('INVALID_AMOUNT', '금액이 너무 작아요');

    const trade = transaction(this.repo.db, () => {
      const cur = this.repo.account(acc.id)!;
      const cash = { ...cur.cash };
      cash[q.from] = roundMoney(cash[q.from] - q.pay, q.from, 'round');
      cash[q.to] = roundMoney(cash[q.to] + q.receive, q.to, 'round');
      this.repo.setCash(acc.id, cash);
      return this.repo.insertFx(acc.id, { from: q.from, to: q.to, rate: q.rate, pay: q.pay, receive: q.receive, executedAt: this.now() });
    });
    this.emit({ event: 'fx', trade });
    return trade;
  }

  // ── 리셋 ──────────────────────────────────────────────

  /** 지금 시즌 마감(최종 자산 기록) → 새 시즌 1,000만원으로 시작 */
  async reset(): Promise<AccountView> {
    const acc = this.account();
    const finalKrw = (await this.valueOf(acc)).totalKrw;

    const next = transaction(this.repo.db, () => {
      for (const o of this.repo.openOrders(acc.id)) this.repo.updateOrder(o.id, { status: 'cancelled', reason: '계좌 리셋으로 취소됐어요' }, this.now());
      this.repo.closeAccount(acc.id, this.now(), finalKrw);
      return this.openAccount(acc.season + 1);
    });
    this.emit({ event: 'reset', season: next.season });
    this.syncWatch();
    return this.view();
  }

  // ── 내부 ──────────────────────────────────────────────

  /** 지금 시세로 계좌 평가 (원화 환산) */
  /** 배당·분할 반영을 화면에 알림 */
  notifyCorporate(actions: { code: string; kind: 'dividend' | 'split'; value: number; qty: number }[]): void {
    this.emit({ event: 'corporate', actions: actions.map(({ code, kind, value, qty }) => ({ code, kind, value, qty })) });
  }

  /** 지금 시즌 계좌를 지금 시세로 평가 */
  currentValue() {
    return this.valueOf(this.account());
  }

  private async valueOf(acc: AccountRow) {
    const positions = this.repo.positions(acc.id);
    const codes = Object.keys(positions);
    const [quotes, usdKrw] = await Promise.all([
      codes.length ? this.provider.getQuotes(codes) : Promise.resolve([] as Quote[]),
      this.provider.getUsdKrw().catch(() => 1_400),
    ]);
    const ev = evaluatePortfolio({ cash: acc.cash, positions }, Object.fromEntries(quotes.map((q) => [q.code, q])), usdKrw);
    return { ...ev, usdKrw };
  }

  /** 장이 열렸는지: 우리 일정표 + 시세 소스가 알려주는 장 상태 (예상 못 한 휴장 대비) */
  private isOpen(market: Market, quote: Quote): boolean {
    return isMarketOpen(market, this.now()) && quote.marketStatus !== 'closed';
  }

  private async quoteOf(code: string): Promise<Quote> {
    const [quote] = await this.provider.getQuotes([code]);
    if (!quote) throw new TradingError('NO_QUOTE', '시세를 불러오지 못했어요. 잠시 후 다시 시도해주세요', 503);
    return quote;
  }

  private ownOpenOrder(id: string): Order {
    const o = this.repo.order(id);
    if (!o || o.accountId !== this.account().id) throw new TradingError('NOT_FOUND', '주문을 찾을 수 없어요', 404);
    if (o.status !== 'pending' && o.status !== 'reserved') throw new TradingError('NOT_OPEN', '이미 체결됐거나 취소된 주문이에요', 409);
    return o;
  }

  /** 체결 시도. 체결되면 잔고·보유 반영하고 Fill 반환 */
  private execute(orderId: string, quote: Quote, mode: FillMode, stock?: StockInfo, background = false, at = this.now()): Fill | null {
    const result = transaction<{ fill: Fill } | { rejected: Order } | null>(this.repo.db, () => {
      const order = this.repo.order(orderId);
      if (!order || (order.status !== 'pending' && order.status !== 'reserved')) return null;
      const fill = tryFill({ order, quote, marketOpen: true, mode, now: at, config: this.config });
      if (!fill) return null;

      const acc = this.repo.account(order.accountId)!;
      const positions = this.repo.positions(acc.id);
      if (fill.side === 'buy') {
        // 예약 시장가는 장 시작 가격이 예상보다 비쌀 수 있어서 다시 확인
        const others = this.repo.holds(acc.id, order.id)[fill.currency];
        if (fill.amount + fill.commission > acc.cash[fill.currency] - others + 1e-9) {
          this.repo.updateOrder(order.id, { status: 'rejected', reason: '체결 시점에 잔고가 부족해서 취소됐어요' }, at);
          return { rejected: this.repo.order(order.id)! };
        }
      } else if ((positions[fill.code]?.qty ?? 0) < fill.qty) {
        this.repo.updateOrder(order.id, { status: 'rejected', reason: '보유 수량이 부족해서 취소됐어요' }, at);
        return { rejected: this.repo.order(order.id)! };
      }

      const next = applyFill({ cash: acc.cash, positions }, fill);
      this.repo.setCash(acc.id, next.cash);
      this.repo.setPosition(acc.id, fill.code, next.positions[fill.code]);
      this.repo.updateOrder(order.id, { status: 'filled' }, at);
      return { fill: this.repo.insertFill(acc.id, { ...fill, realizedPnl: next.realizedPnl, dayChangeRate: quote.changeRate }) };
    });
    if (!result) return null;
    if ('rejected' in result) {
      this.emit({ event: 'order', order: result.rejected, ...(stock ? { stock } : {}) });
      return null;
    }
    this.emit({ event: 'fill', fill: result.fill, ...(stock ? { stock } : {}), ...(background ? { background } : {}) });
    return result.fill;
  }

  /** 미체결 주문 종목은 화면에 안 보여도 계속 시세 갱신 */
  private syncWatch(): void {
    this.provider.watch('orders', this.openOrders().map((o) => o.code));
  }

  private emit(e: AccountEvent): void {
    for (const l of this.listeners) l(e);
  }
}
