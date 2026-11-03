import { DEFAULT_CONFIG } from '@stock/core';
import { Link } from 'react-router';
import { Card, Segmented, SectionTitle, SubPage } from '../components/Layout';
import { api, apiFetch } from '../lib/api';
import { authRequired } from '../lib/auth';
import { sourceName, useDataStatus } from '../lib/status';
import { useTheme, type ThemeSetting } from '../lib/theme';
import { useAsync } from '../lib/useAsync';

const pct = (v: number) => `${Math.round(v * 100_000) / 1000}%`;

/** 설정: 테마, 시세 소스, 연결된 기능(키 상태), 매매 규칙 값 */
export function Settings() {
  const { setting, setSetting } = useTheme();
  const status = useDataStatus();
  const ai = useAsync(async () => {
    const res = await apiFetch('/api/ai');
    return res.ok ? ((await res.json()) as { enabled: boolean }) : { enabled: false };
  }, []);
  const push = useAsync(() => api.pushInfo(), []);
  const fcm = useAsync(() => api.fcmInfo().catch(() => ({ enabled: false, devices: 0 })), []);
  const rules = useAsync(() => api.settings(), []);

  const kis = status?.KR.source === 'kis' || status?.US.source === 'kis';
  const features: [string, boolean | undefined, string][] = [
    ['로그인', authRequired(), '서버에 APP_PASSWORD를 넣으면 켜져요'],
    ['한국투자증권 API (실시간·호가)', status ? kis : undefined, 'KIS_APP_KEY / KIS_APP_SECRET'],
    ['AI 리포트 (앱에서 바로 받기)', ai.data?.enabled, 'ANTHROPIC_API_KEY 또는 GEMINI_API_KEY'],
    ['웹 푸시', push.data?.enabled, '자동 (https 주소에서 동작)'],
    ['안드로이드 앱 푸시 (FCM)', fcm.data?.enabled, 'FIREBASE_SERVICE_ACCOUNT'],
  ];

  const c = DEFAULT_CONFIG;
  const rows: [string, string][] = [
    ['국내 매매 수수료', pct(c.krCommissionRate)],
    ['미국 매매 수수료', pct(c.usCommissionRate)],
    ['국내 매도 세금', pct(c.krSellTaxRate)],
    ['시장가 슬리피지', pct(c.slippageRate)],
    ['환전 스프레드', pct(c.fxSpreadRate)],
    ['국내 가격제한폭', `±${pct(c.krPriceLimitRate)}`],
  ];

  return (
    <SubPage title="설정">
      <Card>
        <SectionTitle>화면 테마</SectionTitle>
        <Segmented<ThemeSetting>
          options={[
            { value: 'system', label: '시스템' },
            { value: 'light', label: '라이트' },
            { value: 'dark', label: '다크' },
          ]}
          value={setting}
          onChange={setSetting}
        />
      </Card>

      <Card>
        <SectionTitle>시세 소스</SectionTitle>
        <div className="space-y-1.5 text-sm">
          {(['KR', 'US'] as const).map((m) => (
            <div key={m} className="flex justify-between">
              <span className="text-sub">{m === 'KR' ? '국내' : '미국'}</span>
              <span>{status ? sourceName(status[m]) : '…'}</span>
            </div>
          ))}
        </div>
        <p className="mt-2 text-xs text-sub">네이버 실시간 시세를 먼저 쓰고, 막히면 야후(국내 20분 지연)로 자동 전환돼요.</p>
      </Card>

      <Card>
        <SectionTitle>연결된 기능</SectionTitle>
        <ul className="space-y-2.5">
          {features.map(([name, on, how]) => (
            <li key={name} className="flex items-start justify-between gap-3 text-sm">
              <div>
                <p className="font-medium">{name}</p>
                {!on && <p className="text-xs text-sub">{how}</p>}
              </div>
              <span className={`shrink-0 rounded-md px-1.5 py-0.5 text-xs font-semibold ${on ? 'bg-brand/10 text-brand' : 'bg-soft text-sub'}`}>
                {on === undefined ? '…' : on ? '켜짐' : '꺼짐'}
              </span>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-xs text-sub">키는 서버 환경변수로만 넣어요. 앱이나 깃에는 저장하지 않아요.</p>
      </Card>

      <Card>
        <SectionTitle>매매 규칙</SectionTitle>
        <dl className="space-y-1.5 text-sm">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between">
              <dt className="text-sub">{k}</dt>
              <dd className="font-medium">{v}</dd>
            </div>
          ))}
          <div className="flex justify-between">
            <dt className="text-sub">내 손절 원칙</dt>
            <dd className="font-medium">
              {rules.data?.stopLossRate != null ? pct(rules.data.stopLossRate) : '없음'}{' '}
              <Link to="/journal" className="ml-1 text-brand">
                바꾸기
              </Link>
            </dd>
          </div>
        </dl>
        <p className="mt-2 text-xs text-sub">손절 원칙은 일지 › 코치에서 정해요. 주문은 당일 주문이라 장 마감까지 안 되면 자동 취소돼요.</p>
      </Card>
    </SubPage>
  );
}
