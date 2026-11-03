import { Card, Empty, Page, SectionTitle, Soon } from '../components/Layout';

const COACH = [
  { title: '규칙 기반 코치', desc: '추격매수·손절·물타기·과매매 습관 분석' },
  { title: 'AI에게 물어보기', desc: '내 매매 기록을 질문으로 정리해서 복사' },
  { title: 'AI API 연동', desc: '키를 넣으면 앱 안에서 바로 리포트 (선택)' },
];

export function Journal() {
  return (
    <Page title="일지">
      <Card>
        <SectionTitle right={<Soon milestone="M3" />}>매매일지</SectionTitle>
        <Empty title="아직 매매 기록이 없어요" desc="사고팔 때마다 이유를 남기면 여기에 쌓여요" />
      </Card>
      <Card>
        <SectionTitle right={<Soon milestone="M3" />}>통계 · 수익 캘린더</SectionTitle>
        <p className="text-sm text-sub">승률, 손익비, 최대 낙폭, 코스피·S&P500 대비 성과, 월별 수익 달력</p>
      </Card>
      <Card>
        <SectionTitle right={<Soon milestone="M5" />}>투자 코치</SectionTitle>
        <ul className="space-y-3">
          {COACH.map((c) => (
            <li key={c.title}>
              <p className="font-semibold">{c.title}</p>
              <p className="text-sm text-sub">{c.desc}</p>
            </li>
          ))}
        </ul>
      </Card>
    </Page>
  );
}
