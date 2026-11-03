# STOCK

한국·미국 실제 시세로 실전처럼 연습하는 주식 모의투자 앱 (웹 → 안드로이드 APK).

- 기획서: [docs/PLAN.md](docs/PLAN.md)
- 진행 상황: **M2 완료** (실제 시세로 주문·체결·환전·리셋) → 다음은 M3 (관심종목·알림·매매일지·통계)

## 실행

Node.js 22 이상 필요.

```bash
npm install
npm run dev      # 서버(8787) + 웹(5173) 같이 실행 → http://localhost:5173
npm test         # 매매 규칙 엔진 + 서버 테스트
npm run typecheck
```

시세 소스는 환경변수로 바꿀 수 있어요.

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MARKET_DATA` | `live` | `live`: 네이버 → 야후 실제 시세 / `mock`: 가짜 시세 (인터넷 없이 개발) |
| `PORT` | `8787` | 서버 포트 |
| `DATA_DIR` | `apps/server/data` | 계좌 DB(`stock.db`)와 전체 종목 목록 저장 위치 (종목 목록은 첫 실행 때 30초쯤 걸려 받아옴) |

네이버·야후 시세는 비공식이라 개인 연습용으로만 쓰세요.

## 구조

```
apps/web        웹앱 (React + Vite + Tailwind, 차트: Lightweight Charts)
apps/server     API 서버 (Fastify) — 시세 소스: 네이버 → 야후 자동 전환, 가짜 시세(Mock)
packages/core   매매 규칙: 호가단위·가격제한폭·수수료·세금·장 시간·체결·환전·검색
packages/shared 공용 타입
```
