import { randomUUID } from 'node:crypto';
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
import { transaction } from './db';
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
      id: randomUUID(),
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

  /** 미체결 주문 처리: 만료 취소 → 시세 확인 → 체결 */
  async processOpenOrders(): Promise<void> {
    if (this.processing) return;
    this.processing = true;
    try {
      const now = this.now();
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
      this.processing = false;
      this.syncWatch();
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
  private execute(orderId: string, quote: Quote, mode: FillMode, stock?: StockInfo, background = false): Fill | null {
    const result = transaction<{ fill: Fill } | { rejected: Order } | null>(this.repo.db, () => {
      const order = this.repo.order(orderId);
      if (!order || (order.status !== 'pending' && order.status !== 'reserved')) return null;
      const fill = tryFill({ order, quote, marketOpen: true, mode, now: this.now(), config: this.config });
      if (!fill) return null;

      const acc = this.repo.account(order.accountId)!;
      const positions = this.repo.positions(acc.id);
      if (fill.side === 'buy') {
        // 예약 시장가는 장 시작 가격이 예상보다 비쌀 수 있어서 다시 확인
        const others = this.repo.holds(acc.id, order.id)[fill.currency];
        if (fill.amount + fill.commission > acc.cash[fill.currency] - others + 1e-9) {
          this.repo.updateOrder(order.id, { status: 'rejected', reason: '체결 시점에 잔고가 부족해서 취소됐어요' }, this.now());
          return { rejected: this.repo.order(order.id)! };
        }
      } else if ((positions[fill.code]?.qty ?? 0) < fill.qty) {
        this.repo.updateOrder(order.id, { status: 'rejected', reason: '보유 수량이 부족해서 취소됐어요' }, this.now());
        return { rejected: this.repo.order(order.id)! };
      }

      const next = applyFill({ cash: acc.cash, positions }, fill);
      this.repo.setCash(acc.id, next.cash);
      this.repo.setPosition(acc.id, fill.code, next.positions[fill.code]);
      this.repo.updateOrder(order.id, { status: 'filled' }, this.now());
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
