import type { AccountEvent, Fill, StockInfo } from '@stock/shared';
import { account } from './account';
import { formatPrice } from './format';
import { toast } from './toast';

export function describeFill(fill: Fill, stock?: StockInfo): string {
  const name = stock?.nameKo ?? fill.code;
  return `${name} ${fill.qty.toLocaleString()}주 ${fill.side === 'buy' ? '구매' : '판매'} 체결 · ${formatPrice(fill.price, fill.currency)}`;
}

/** 서버에서 온 계좌 알림 처리: 계좌 갱신 + 필요한 것만 토스트 */
export function handleAccountEvent(e: AccountEvent): void {
  void account.refresh();
  if (e.event === 'fill') {
    toast(describeFill(e.fill, e.stock), 'info', `fill:${e.fill.orderId}`);
  } else if (e.event === 'order' && (e.order.status === 'rejected' || e.order.status === 'cancelled') && e.order.reason && e.order.reason !== '취소했어요') {
    toast(e.order.reason, 'error', `order:${e.order.id}:${e.order.status}`);
  } else if (e.event === 'corporate') {
    for (const a of e.actions) {
      toast(
        a.kind === 'dividend'
          ? `💰 ${a.code} 배당금 ${a.value.toLocaleString()} 입금 (${a.qty.toLocaleString()}주, 세후)`
          : `✂️ ${a.code} 액면분할 1:${a.value} 반영 → ${a.qty.toLocaleString()}주`,
      );
    }
  }
}
