import type { AlertKind, PriceAlert, Quote, StockInfo } from '@stock/shared';
import type { DatabaseSync } from 'node:sqlite';
import { TradingError } from './service';

const KINDS: AlertKind[] = ['above', 'below', 'rise', 'fall'];
const MAX_ACTIVE = 100;

type Row = Record<string, unknown>;

function toAlert(r: Row): PriceAlert {
  return {
    id: r.id as number,
    code: r.code as string,
    kind: r.kind as AlertKind,
    value: r.value as number,
    active: r.active === 1,
    createdAt: r.created_at as number,
    ...(r.triggered_at != null ? { triggeredAt: r.triggered_at as number } : {}),
    ...(r.triggered_price != null ? { triggeredPrice: r.triggered_price as number } : {}),
  };
}

/** 조건 충족 여부. 상승·하락은 전일 대비 % */
export function alertMet(kind: AlertKind, value: number, quote: Quote): boolean {
  const pct = quote.changeRate * 100;
  switch (kind) {
    case 'above':
      return quote.price >= value;
    case 'below':
      return quote.price <= value;
    case 'rise':
      return pct >= value;
    case 'fall':
      return pct <= -value;
  }
}

/** 75000 → "75,000원", 12.5 (달러) → "$12.5" */
export function moneyText(v: number, stock?: Pick<StockInfo, 'currency'>): string {
  return stock?.currency === 'USD' ? `$${v.toLocaleString('en-US', { maximumFractionDigits: 4 })}` : `${v.toLocaleString('ko-KR')}원`;
}

/** 화면·푸시에 쓸 문장 (예: "75,000원 이상") */
export function describeAlert(a: Pick<PriceAlert, 'kind' | 'value'>, stock?: Pick<StockInfo, 'currency'>): string {
  const money = (v: number) => moneyText(v, stock);
  switch (a.kind) {
    case 'above':
      return `${money(a.value)} 이상`;
    case 'below':
      return `${money(a.value)} 이하`;
    case 'rise':
      return `전일 대비 +${a.value}% 이상`;
    case 'fall':
      return `전일 대비 -${a.value}% 이하`;
  }
}

/**
 * 가격 알림: 조건을 만족하면 한 번 울리고 꺼짐 (다시 켜려면 새로 등록).
 * 이미 만족한 조건으로는 등록 못 함 (바로 울려버리니까)
 */
export class AlertService {
  private readonly listeners = new Set<(a: PriceAlert) => void>();

  constructor(
    private readonly db: DatabaseSync,
    private readonly now: () => number = Date.now,
    private readonly userId = 1,
  ) {}

  onTrigger(l: (a: PriceAlert) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  list(): PriceAlert[] {
    return (
      this.db.prepare('SELECT * FROM alerts WHERE user_id = ? ORDER BY active DESC, created_at DESC LIMIT 300').all(this.userId) as Row[]
    ).map(toAlert);
  }

  activeCodes(): string[] {
    return (this.db.prepare('SELECT DISTINCT code FROM alerts WHERE user_id = ? AND active = 1').all(this.userId) as { code: string }[]).map(
      (r) => r.code,
    );
  }

  create(input: { code: string; kind: AlertKind; value: number }, quote: Quote): PriceAlert {
    const { code, kind, value } = input;
    const pct = kind === 'rise' || kind === 'fall';
    if (!KINDS.includes(kind)) throw new TradingError('BAD_KIND', '알림 조건이 올바르지 않아요');
    if (!(value > 0)) throw new TradingError('BAD_VALUE', pct ? '몇 %인지 입력해주세요' : '가격을 입력해주세요');
    if (pct && value > 100) throw new TradingError('BAD_VALUE', '100% 이하로 입력해주세요');
    if (alertMet(kind, value, quote)) throw new TradingError('ALREADY_MET', `이미 ${describeAlert({ kind, value })} 상태예요`);
    const active = (this.db.prepare('SELECT COUNT(*) AS n FROM alerts WHERE user_id = ? AND active = 1').get(this.userId) as { n: number }).n;
    if (active >= MAX_ACTIVE) throw new TradingError('TOO_MANY', `알림은 ${MAX_ACTIVE}개까지 켜둘 수 있어요`);
    const res = this.db
      .prepare('INSERT INTO alerts (user_id, code, kind, value, active, created_at) VALUES (?, ?, ?, ?, 1, ?)')
      .run(this.userId, code, kind, value, this.now());
    return this.get(Number(res.lastInsertRowid));
  }

  remove(id: number): void {
    const res = this.db.prepare('DELETE FROM alerts WHERE id = ? AND user_id = ?').run(id, this.userId);
    if (res.changes === 0) throw new TradingError('NOT_FOUND', '알림을 찾을 수 없어요', 404);
  }

  /** 새 시세가 올 때마다: 조건 만족한 알림을 끄고 알림 발생 */
  check(quote: Quote): PriceAlert[] {
    const rows = this.db.prepare('SELECT * FROM alerts WHERE user_id = ? AND active = 1 AND code = ?').all(this.userId, quote.code) as Row[];
    const fired: PriceAlert[] = [];
    for (const a of rows.map(toAlert)) {
      if (!alertMet(a.kind, a.value, quote)) continue;
      this.db.prepare('UPDATE alerts SET active = 0, triggered_at = ?, triggered_price = ? WHERE id = ?').run(this.now(), quote.price, a.id);
      const updated = this.get(a.id);
      fired.push(updated);
      for (const l of this.listeners) l(updated);
    }
    return fired;
  }

  private get(id: number): PriceAlert {
    const r = this.db.prepare('SELECT * FROM alerts WHERE id = ?').get(id) as Row | undefined;
    if (!r) throw new TradingError('NOT_FOUND', '알림을 찾을 수 없어요', 404);
    return toAlert(r);
  }
}
