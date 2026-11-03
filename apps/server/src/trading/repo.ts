import type { Cash, Currency, Fill, FxTrade, Order, OrderStatus, Position } from '@stock/shared';
import type { DatabaseSync } from 'node:sqlite';

export interface AccountRow {
  id: number;
  season: number;
  seedKrw: number;
  cash: Cash;
  createdAt: number;
  closedAt?: number;
  finalValueKrw?: number;
}

type Row = Record<string, unknown>;

const OPEN: OrderStatus[] = ['pending', 'reserved'];

function toAccount(r: Row): AccountRow {
  return {
    id: r.id as number,
    season: r.season as number,
    seedKrw: r.seed_krw as number,
    cash: { KRW: r.cash_krw as number, USD: r.cash_usd as number },
    createdAt: r.created_at as number,
    ...(r.closed_at != null ? { closedAt: r.closed_at as number } : {}),
    ...(r.final_value_krw != null ? { finalValueKrw: r.final_value_krw as number } : {}),
  };
}

function toOrder(r: Row): Order {
  return {
    id: r.id as string,
    code: r.code as string,
    market: r.market as Order['market'],
    side: r.side as Order['side'],
    type: r.type as Order['type'],
    qty: r.qty as number,
    ...(r.limit_price != null ? { limitPrice: r.limit_price as number } : {}),
    status: r.status as OrderStatus,
    holdAmount: r.hold_amount as number,
    ...(r.reason != null ? { reason: r.reason as string } : {}),
    createdAt: r.created_at as number,
    updatedAt: r.updated_at as number,
    ...(r.expires_at != null ? { expiresAt: r.expires_at as number } : {}),
  };
}

function toFill(r: Row): Fill {
  return {
    id: r.id as number,
    orderId: r.order_id as string,
    code: r.code as string,
    side: r.side as Fill['side'],
    price: r.price as number,
    qty: r.qty as number,
    amount: r.amount as number,
    commission: r.commission as number,
    tax: r.tax as number,
    currency: r.currency as Currency,
    realizedPnl: r.realized_pnl as number,
    executedAt: r.executed_at as number,
  };
}

/** 계좌·주문·체결 저장소 (SQL은 여기에만) */
export class TradingRepo {
  constructor(readonly db: DatabaseSync) {}

  activeAccount(userId = 1): AccountRow | undefined {
    const r = this.db.prepare('SELECT * FROM accounts WHERE user_id = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1').get(userId) as Row | undefined;
    return r ? toAccount(r) : undefined;
  }

  createAccount(season: number, seedKrw: number, now: number, userId = 1): AccountRow {
    const res = this.db
      .prepare('INSERT INTO accounts (user_id, season, seed_krw, cash_krw, cash_usd, created_at) VALUES (?, ?, ?, ?, 0, ?)')
      .run(userId, season, seedKrw, seedKrw, now);
    return this.account(Number(res.lastInsertRowid))!;
  }

  account(id: number): AccountRow | undefined {
    const r = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(id) as Row | undefined;
    return r ? toAccount(r) : undefined;
  }

  accounts(userId = 1): AccountRow[] {
    return (this.db.prepare('SELECT * FROM accounts WHERE user_id = ? ORDER BY season DESC').all(userId) as Row[]).map(toAccount);
  }

  closeAccount(id: number, now: number, finalValueKrw: number): void {
    this.db.prepare('UPDATE accounts SET closed_at = ?, final_value_krw = ? WHERE id = ?').run(now, finalValueKrw, id);
  }

  setCash(id: number, cash: Cash): void {
    this.db.prepare('UPDATE accounts SET cash_krw = ?, cash_usd = ? WHERE id = ?').run(cash.KRW, cash.USD, id);
  }

  positions(accountId: number): Record<string, Position> {
    const rows = this.db.prepare('SELECT * FROM positions WHERE account_id = ? ORDER BY code').all(accountId) as Row[];
    return Object.fromEntries(
      rows.map((r) => [r.code as string, { code: r.code as string, qty: r.qty as number, avgPrice: r.avg_price as number, currency: r.currency as Currency }]),
    );
  }

  /** 보유 수량이 0이면 삭제 */
  setPosition(accountId: number, code: string, p: Position | undefined): void {
    if (!p || p.qty === 0) {
      this.db.prepare('DELETE FROM positions WHERE account_id = ? AND code = ?').run(accountId, code);
      return;
    }
    this.db
      .prepare(
        `INSERT INTO positions (account_id, code, qty, avg_price, currency) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(account_id, code) DO UPDATE SET qty = excluded.qty, avg_price = excluded.avg_price`,
      )
      .run(accountId, code, p.qty, p.avgPrice, p.currency);
  }

  insertOrder(accountId: number, o: Order): void {
    this.db
      .prepare(
        `INSERT INTO orders (id, account_id, code, market, side, type, qty, limit_price, status, hold_amount, reason, created_at, updated_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(o.id, accountId, o.code, o.market, o.side, o.type, o.qty, o.limitPrice ?? null, o.status, o.holdAmount ?? 0, o.reason ?? null, o.createdAt, o.updatedAt ?? o.createdAt, o.expiresAt ?? null);
  }

  order(id: string): (Order & { accountId: number }) | undefined {
    const r = this.db.prepare('SELECT * FROM orders WHERE id = ?').get(id) as Row | undefined;
    return r ? { ...toOrder(r), accountId: r.account_id as number } : undefined;
  }

  updateOrder(id: string, patch: Partial<Pick<Order, 'status' | 'qty' | 'limitPrice' | 'holdAmount' | 'reason'>>, now: number): void {
    const cur = this.order(id);
    if (!cur) return;
    const next = { ...cur, ...patch };
    this.db
      .prepare('UPDATE orders SET status = ?, qty = ?, limit_price = ?, hold_amount = ?, reason = ?, updated_at = ? WHERE id = ?')
      .run(next.status, next.qty, next.limitPrice ?? null, next.status === 'pending' || next.status === 'reserved' ? (next.holdAmount ?? 0) : 0, next.reason ?? null, now, id);
  }

  openOrders(accountId: number): Order[] {
    return (
      this.db.prepare(`SELECT * FROM orders WHERE account_id = ? AND status IN (${OPEN.map(() => '?').join(',')}) ORDER BY created_at`).all(accountId, ...OPEN) as Row[]
    ).map(toOrder);
  }

  orders(accountId: number, limit = 100): Order[] {
    return (this.db.prepare('SELECT * FROM orders WHERE account_id = ? ORDER BY created_at DESC LIMIT ?').all(accountId, limit) as Row[]).map(toOrder);
  }

  /** 미체결 매수에 묶인 돈 (통화별). except: 정정할 때 자기 자신은 빼고 계산 */
  holds(accountId: number, exceptOrderId?: string): Cash {
    const out: Cash = { KRW: 0, USD: 0 };
    for (const o of this.openOrders(accountId)) {
      if (o.side !== 'buy' || o.id === exceptOrderId) continue;
      out[o.market === 'KR' ? 'KRW' : 'USD'] += o.holdAmount ?? 0;
    }
    return out;
  }

  /** 종목별 미체결 매도 수량 */
  pendingSellQty(accountId: number, exceptOrderId?: string): Record<string, number> {
    const out: Record<string, number> = {};
    for (const o of this.openOrders(accountId)) {
      if (o.side === 'sell' && o.id !== exceptOrderId) out[o.code] = (out[o.code] ?? 0) + o.qty;
    }
    return out;
  }

  insertFill(accountId: number, f: Fill): Fill {
    const res = this.db
      .prepare(
        `INSERT INTO fills (order_id, account_id, code, side, price, qty, amount, commission, tax, currency, realized_pnl, executed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(f.orderId, accountId, f.code, f.side, f.price, f.qty, f.amount, f.commission, f.tax, f.currency, f.realizedPnl ?? 0, f.executedAt);
    return { ...f, id: Number(res.lastInsertRowid) };
  }

  fills(accountId: number, limit = 100, code?: string): Fill[] {
    const rows = code
      ? this.db.prepare('SELECT * FROM fills WHERE account_id = ? AND code = ? ORDER BY executed_at DESC, id DESC LIMIT ?').all(accountId, code, limit)
      : this.db.prepare('SELECT * FROM fills WHERE account_id = ? ORDER BY executed_at DESC, id DESC LIMIT ?').all(accountId, limit);
    return (rows as Row[]).map(toFill);
  }

  fillCount(accountId: number): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM fills WHERE account_id = ?').get(accountId) as { n: number }).n;
  }

  realizedPnl(accountId: number): Cash {
    const rows = this.db.prepare('SELECT currency, SUM(realized_pnl) AS pnl FROM fills WHERE account_id = ? GROUP BY currency').all(accountId) as Row[];
    const out: Cash = { KRW: 0, USD: 0 };
    for (const r of rows) out[r.currency as Currency] = (r.pnl as number) ?? 0;
    return out;
  }

  insertFx(accountId: number, t: Omit<FxTrade, 'id'>): FxTrade {
    const res = this.db
      .prepare('INSERT INTO fx_trades (account_id, from_ccy, to_ccy, rate, pay, receive, executed_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .run(accountId, t.from, t.to, t.rate, t.pay, t.receive, t.executedAt);
    return { ...t, id: Number(res.lastInsertRowid) };
  }

  fxTrades(accountId: number, limit = 50): FxTrade[] {
    const rows = this.db.prepare('SELECT * FROM fx_trades WHERE account_id = ? ORDER BY executed_at DESC, id DESC LIMIT ?').all(accountId, limit) as Row[];
    return rows.map((r) => ({
      id: r.id as number,
      from: r.from_ccy as Currency,
      to: r.to_ccy as Currency,
      rate: r.rate as number,
      pay: r.pay as number,
      receive: r.receive as number,
      executedAt: r.executed_at as number,
    }));
  }
}
