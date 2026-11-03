import { Link } from 'react-router';
import { ChevronIcon } from '../components/Icons';
import { Card, Page } from '../components/Layout';
import { authRequired, logout } from '../lib/auth';
import { live } from '../lib/live';
import { isNative } from '../lib/server';

const MENU: { label: string; to: string }[] = [
  { label: '주문내역', to: '/orders' },
  { label: '환전', to: '/fx' },
  { label: '시즌 기록 · 계좌 리셋', to: '/seasons' },
  { label: '가격 알림 · 폰 알림', to: '/alerts' },
  { label: '챌린지 · 업적', to: '/achievements' },
  { label: '타임머신 리플레이', to: '/replay' },
  { label: '설정', to: '/settings' },
  // 안드로이드 앱에서만: 연결할 서버 바꾸기
  ...(isNative() ? [{ label: '서버 주소', to: '/server' }] : []),
];

export function More() {
  return (
    <Page title="더보기">
      <Card className="py-2">
        {MENU.map((m) => (
          <Link key={m.label} to={m.to} className="flex items-center justify-between py-3">
            <span className="font-medium">{m.label}</span>
            <ChevronIcon width={18} height={18} className="text-sub" />
          </Link>
        ))}
      </Card>

      {authRequired() && (
        <Card className="py-2">
          <button
            className="w-full py-3 text-left font-medium text-sub"
            onClick={() => {
              logout();
              live.reconnect();
            }}
          >
            로그아웃
          </button>
        </Card>
      )}

      <p className="px-2 text-center text-xs text-sub">모의투자 앱이에요. 실제 돈이 오가지 않고, 투자 조언이 아니에요.</p>
    </Page>
  );
}
