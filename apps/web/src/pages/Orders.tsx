import { useState } from 'react';
import { FillRow } from '../components/FillRow';
import { Card, Empty, Segmented, SubPage } from '../components/Layout';
import { OrderRow } from '../components/OrderRow';
import { useAccount } from '../lib/account';
import { api } from '../lib/api';
import { useAsync } from '../lib/useAsync';

type Tab = 'open' | 'fills' | 'all';

export function Orders() {
  const [tab, setTab] = useState<Tab>('open');
  const acct = useAccount(); // 계좌가 바뀌면(체결·취소) 목록도 다시 불러옴
  const [nonce, setNonce] = useState(0);
  const orders = useAsync(() => (tab === 'fills' ? Promise.resolve(null) : api.orders(tab === 'open' ? 'open' : 'all')), [tab, acct, nonce]);
  const fills = useAsync(() => (tab === 'fills' ? api.fills() : Promise.resolve(null)), [tab, acct]);

  return (
    <SubPage title="주문내역">
      <Segmented
        options={[
          { value: 'open', label: `미체결${acct?.openOrders ? ` ${acct.openOrders}` : ''}` },
          { value: 'fills', label: '체결' },
          { value: 'all', label: '전체 주문' },
        ]}
        value={tab}
        onChange={setTab}
      />
      <Card className="py-1">
        {tab === 'fills' ? (
          fills.data?.fills.length ? (
            fills.data.fills.map((f) => <FillRow key={f.id} fill={f} stock={fills.data!.stocks[f.code]} />)
          ) : (
            <Empty title="체결 내역이 없어요" />
          )
        ) : orders.data?.orders.length ? (
          orders.data.orders.map((o) => <OrderRow key={`${o.id}:${o.updatedAt}`} order={o} stock={orders.data!.stocks[o.code]} onChanged={() => setNonce((n) => n + 1)} />)
        ) : (
          <Empty title={tab === 'open' ? '미체결 주문이 없어요' : '주문 내역이 없어요'} />
        )}
      </Card>
      <p className="px-2 text-xs text-sub">당일 주문이에요. 장 마감까지 체결되지 않으면 자동으로 취소돼요.</p>
    </SubPage>
  );
}
