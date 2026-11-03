import { Link } from 'react-router';
import { Card, Empty, Page, Soon } from '../components/Layout';
import { StockRow } from '../components/StockRow';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';
import { useWatchlist } from '../lib/watchlist';

export function Watchlist() {
  const { codes } = useWatchlist();
  const { data } = useAsync(() => Promise.all(codes.map((c) => api.stock(c).catch(() => null))), [codes.join(',')]);
  const items = (data ?? []).filter((x) => x !== null);

  return (
    <Page title="관심" right={<Soon milestone="그룹·알림 M3" />}>
      <Card className="py-3">
        {codes.length === 0 ? (
          <Empty
            title="관심 종목이 없어요"
            desc="종목 화면에서 ☆를 눌러 추가하세요"
            action={<Link to="/discover" className="text-sm font-semibold text-brand">종목 찾기</Link>}
          />
        ) : (
          items.map(({ stock, quote }) => <StockRow key={stock.code} stock={stock} quote={quote} />)
        )}
      </Card>
    </Page>
  );
}
