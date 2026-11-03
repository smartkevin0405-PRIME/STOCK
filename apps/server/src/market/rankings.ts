import type { RankingItem, RankingType } from '@stock/shared';

/** 순위 정렬. 거래대금은 원화로 환산해서 비교 */
export function sortRankings(items: RankingItem[], type: RankingType, usdKrw: number, size = 20): RankingItem[] {
  const turnover = (x: RankingItem) => x.quote.price * x.quote.volume * (x.stock.currency === 'USD' ? usdKrw : 1);
  const cmp: Record<RankingType, (a: RankingItem, b: RankingItem) => number> = {
    gainers: (a, b) => b.quote.changeRate - a.quote.changeRate,
    losers: (a, b) => a.quote.changeRate - b.quote.changeRate,
    turnover: (a, b) => turnover(b) - turnover(a),
  };
  return [...items].sort(cmp[type]).slice(0, size);
}
