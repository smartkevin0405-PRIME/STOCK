import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { Card, Empty, SectionTitle, SubPage } from '../components/Layout';
import { NativePushCard } from '../components/NativePushCard';
import { describeAlert } from '../lib/alerts';
import { api } from '../lib/api';
import { formatDateTime, formatPrice } from '../lib/format';
import { disablePush, enablePush, pushState, type PushState } from '../lib/push';
import { isNative } from '../lib/server';
import { toast } from '../lib/toast';
import { useAsync } from '../lib/useAsync';

const STATE_TEXT: Record<PushState, string> = {
  on: '이 기기에서 알림을 받고 있어요',
  off: '꺼져 있어요',
  denied: '브라우저에서 알림이 차단돼 있어요. 사이트 설정에서 허용해주세요',
  unsupported: '이 브라우저는 푸시 알림을 지원하지 않아요',
  'needs-install': '아이폰은 공유 버튼 → "홈 화면에 추가"로 설치한 뒤 켤 수 있어요',
  insecure: '푸시 알림은 https 주소에서만 돼요 (배포 후 사용 가능, 앱이 켜져 있을 땐 화면 알림으로 와요)',
};

export function Alerts() {
  const [nonce, setNonce] = useState(0);
  const { data } = useAsync(() => api.alerts(), [nonce]);
  const [state, setState] = useState<PushState>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!isNative()) void pushState().then(setState);
  }, []);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setState(await pushState());
      setBusy(false);
    }
  };

  const active = data?.alerts.filter((a) => a.active) ?? [];
  const fired = data?.alerts.filter((a) => !a.active) ?? [];

  return (
    <SubPage title="가격 알림">
      {/* 안드로이드 앱은 FCM, 웹은 웹 푸시 */}
      {isNative() ? <NativePushCard /> : <Card className="space-y-3">
        <SectionTitle>폰 알림</SectionTitle>
        <p className="text-sm text-sub">{state ? STATE_TEXT[state] : '확인 중…'}</p>
        {state === 'off' && (
          <button disabled={busy} onClick={() => run(enablePush, '알림을 켰어요')} className="w-full rounded-xl bg-brand py-3 font-semibold text-white">
            알림 켜기
          </button>
        )}
        {state === 'on' && (
          <div className="flex gap-2">
            <button disabled={busy} onClick={() => run(() => api.pushTest(), '테스트 알림을 보냈어요')} className="flex-1 rounded-xl bg-soft py-3 font-semibold">
              테스트 보내기
            </button>
            <button disabled={busy} onClick={() => run(disablePush, '알림을 껐어요')} className="flex-1 rounded-xl bg-soft py-3 font-semibold text-sub">
              끄기
            </button>
          </div>
        )}
        <p className="text-xs text-sub">가격 알림과, 걸어둔 주문이 나중에 체결될 때 알려드려요.</p>
      </Card>}

      <Card className="py-3">
        <SectionTitle>켜져 있는 알림 {active.length > 0 && <span className="text-sub">{active.length}</span>}</SectionTitle>
        {active.length === 0 ? (
          <Empty title="켜둔 알림이 없어요" desc="종목 화면 위쪽 🔔 버튼으로 추가해요" />
        ) : (
          active.map((a) => {
            const stock = data?.stocks[a.code];
            return (
              <div key={a.id} className="flex items-center justify-between border-b border-line py-3 last:border-0">
                <Link to={`/stock/${a.code}`} className="min-w-0">
                  <p className="truncate font-semibold">{stock?.nameKo ?? a.code}</p>
                  <p className="text-[13px] text-sub">{describeAlert(a, stock)}</p>
                </Link>
                <button
                  onClick={async () => {
                    await api.deleteAlert(a.id).catch((e: Error) => toast(e.message, 'error'));
                    setNonce((n) => n + 1);
                  }}
                  className="shrink-0 rounded-lg bg-soft px-3 py-1.5 text-sm font-semibold text-sub"
                >
                  끄기
                </button>
              </div>
            );
          })
        )}
      </Card>

      {fired.length > 0 && (
        <Card className="py-3">
          <SectionTitle>울린 알림</SectionTitle>
          {fired.map((a) => {
            const stock = data?.stocks[a.code];
            return (
              <div key={a.id} className="border-b border-line py-2.5 text-sm last:border-0">
                <p className="font-medium">
                  {stock?.nameKo ?? a.code} · {describeAlert(a, stock)}
                </p>
                <p className="text-xs text-sub">
                  {a.triggeredAt ? formatDateTime(a.triggeredAt) : ''}
                  {a.triggeredPrice !== undefined && stock ? ` · ${formatPrice(a.triggeredPrice, stock.currency)}에 도달` : ''}
                </p>
              </div>
            );
          })}
        </Card>
      )}
    </SubPage>
  );
}
