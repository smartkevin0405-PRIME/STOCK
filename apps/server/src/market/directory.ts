import type { StockInfo } from '@stock/shared';

/** 종목 목록 (검색·종목 정보). M1 후반에 KRX·나스닥 종목 파일로 전체 목록 갱신 */
export class StockDirectory {
  private readonly byCode = new Map<string, StockInfo>();

  constructor(stocks: readonly StockInfo[] = []) {
    this.replace(stocks);
  }

  list(): StockInfo[] {
    return [...this.byCode.values()];
  }

  get(code: string): StockInfo | undefined {
    return this.byCode.get(code) ?? this.byCode.get(code.toUpperCase());
  }

  /** 없는 종목만 추가 (순위 목록에서 처음 보는 종목 등) */
  add(stock: StockInfo): StockInfo {
    const existing = this.get(stock.code);
    if (existing) return existing;
    this.byCode.set(stock.code, stock);
    return stock;
  }

  /** 전체 교체. 기존 별칭(한글명 등)은 유지 */
  replace(stocks: readonly StockInfo[]): void {
    const prev = new Map(this.byCode);
    this.byCode.clear();
    for (const s of stocks) {
      const old = prev.get(s.code);
      const aliases = [...new Set([...(old?.aliases ?? []), ...(s.aliases ?? [])])];
      this.byCode.set(s.code, { ...s, ...(aliases.length ? { aliases } : {}) });
    }
  }
}
