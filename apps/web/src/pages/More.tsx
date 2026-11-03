import { Card, Page, Segmented, Soon } from '../components/Layout';
import { ChevronIcon } from '../components/Icons';
import { useTheme, type ThemeSetting } from '../lib/theme';
import { sourceName, useDataStatus } from '../lib/status';

const MENU = [
  { label: '환전', milestone: 'M2' },
  { label: '계좌 리셋 · 시즌 기록', milestone: 'M2' },
  { label: '가격 알림', milestone: 'M3' },
  { label: '챌린지 · 업적', milestone: 'M5' },
  { label: '타임머신 리플레이', milestone: 'M5' },
];

export function More() {
  const { setting, setSetting } = useTheme();
  const dataStatus = useDataStatus();

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
        <div className="space-y-1.5 text-sm">
          <p className="font-semibold">시세 소스</p>
          {(['KR', 'US'] as const).map((m) => (
            <div key={m} className="flex justify-between">
              <span className="text-sub">{m === 'KR' ? '국내' : '미국'}</span>
              <span>{dataStatus ? sourceName(dataStatus[m]) : '…'}</span>
            </div>
          ))}
        </div>
        <p className="text-xs text-sub">국내는 네이버 실시간 시세를 쓰고, 막히면 야후(20분 지연)로 자동 전환돼요.</p>
      </Card>

      <p className="px-2 text-center text-xs text-sub">모의투자 앱이에요. 실제 돈이 오가지 않고, 투자 조언이 아니에요.</p>
    </Page>
  );
}
