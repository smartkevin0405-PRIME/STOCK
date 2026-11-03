import type { Market } from '@stock/shared';
import { useEffect, useState } from 'react';
import { SearchIcon } from '../components/Icons';
import { Card, Empty, Page, Segmented } from '../components/Layout';
import { StockRow } from '../components/StockRow';
import { api, type RankingType } from '../lib/api';
import { useAsync } from '../lib/useAsync';

export function Discover() {
  const [input, setInput] = useState('');
  const [query, setQuery] = useState('');
  const [ranking, setRanking] = useState<RankingType>('gainers');
  const [market, setMarket] = useState<Market | 'ALL'>('ALL');

  useEffect(() => {
    const t = setTimeout(() => setQuery(input.trim()), 200);
    return () => clearTimeout(t);
  }, [input]);

  const search = useAsync(() => (query ? api.search(query) : Promise.resolve(null)), [query]);
  const ranks = useAsync(() => api.rankings(ranking, market === 'ALL' ? undefined : market), [ranking, market]);

  return (
    <Page title="발견">
      <label className="flex items-center gap-2 rounded-2xl bg-card px-4 py-3">
        <SearchIcon width={20} height={20} className="text-sub" />
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="종목명, 코드, 초성 (예: ㅅㅅㅈㅈ, 애플)"
          className="w-full bg-transparent outline-none placeholder:text-sub"
        />
      </label>

      {query ? (
        <Card className="py-3">
          {search.data?.items.length === 0 && <Empty title="검색 결과가 없어요" />}
          {search.data?.items.map(({ stock, quote }) => <StockRow key={stock.code} stock={stock} quote={quote} />)}
        </Card>
      ) : (
        <Card className="space-y-3 py-4">
          <Segmented
            options={[
              { value: 'gainers', label: '급상승' },
              { value: 'losers', label: '급하락' },
              { value: 'turnover', label: '거래대금' },
            ] as const}
            value={ranking}
            onChange={setRanking}
          />
          <Segmented
            size="sm"
            options={[
              { value: 'ALL', label: '전체' },
              { value: 'KR', label: '국내' },
              { value: 'US', label: '해외' },
            ] as const}
            value={market}
            onChange={setMarket}
          />
          <div>
            {ranks.data?.items.map(({ stock, quote }, i) => <StockRow key={stock.code} stock={stock} quote={quote} rank={i + 1} />)}
          </div>
        </Card>
      )}
    </Page>
  );
}
