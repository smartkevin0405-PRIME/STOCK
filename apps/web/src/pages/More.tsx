import { Card, Page, Segmented, Soon } from '../components/Layout';
import { ChevronIcon } from '../components/Icons';
import { api } from '../lib/api';
import { useTheme, type ThemeSetting } from '../lib/theme';
import { useAsync } from '../lib/useAsync';

const MENU = [
  { label: '환전', milestone: 'M2' },
  { label: '계좌 리셋 · 시즌 기록', milestone: 'M2' },
  { label: '가격 알림', milestone: 'M3' },
  { label: '챌린지 · 업적', milestone: 'M5' },
  { label: '타임머신 리플레이', milestone: 'M5' },
];

export function More() {
  const { setting, setSetting } = useTheme();
  const health = useAsync(() => api.health(), []);

  return (
    <Page title="더보기">
      <Card className="py-2">
        {MENU.map((m) => (
          <div key={m.label} className="flex items-center justify-between py-3">
            <span className="font-medium">{m.label}</span>
            <span className="flex items-center gap-1 text-sub">
              <Soon milestone={m.milestone} />
              <ChevronIcon width={18} height={18} />
            </span>
          </div>
        ))}
      </Card>

      <Card className="space-y-4">
        <div>
          <p className="mb-2 font-semibold">화면 테마</p>
          <Segmented<ThemeSetting>
            options={[
              { value: 'system', label: '시스템' },
              { value: 'light', label: '라이트' },
              { value: 'dark', label: '다크' },
            ]}
            value={setting}
            onChange={setSetting}
          />
        </div>
        <div className="flex items-center justify-between text-sm">
          <span className="font-semibold">시세 소스</span>
          <span className="text-sub">
            {health.data?.provider === 'mock' ? '가짜 시세 (개발용)' : (health.data?.provider ?? '…')}
          </span>
        </div>
        <p className="text-xs text-sub">야후 파이낸스 연결은 M1, 한국투자증권 API 키 연결은 선택 기능이에요.</p>
      </Card>

      <p className="px-2 text-center text-xs text-sub">모의투자 앱이에요. 실제 돈이 오가지 않고, 투자 조언이 아니에요.</p>
    </Page>
  );
}
