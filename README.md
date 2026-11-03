# STOCK

한국·미국 실제 시세로 실전처럼 연습하는 주식 모의투자 앱 (웹 → 안드로이드 APK).

- 기획서: [docs/PLAN.md](docs/PLAN.md)
- 진행 상황: **M0 뼈대 완료** (가짜 시세로 동작) → 다음은 M1 (야후 실제 시세)

## 실행

Node.js 22 이상 필요.

```bash
npm install
npm run dev      # 서버(8787) + 웹(5173) 같이 실행 → http://localhost:5173
npm test         # 매매 규칙 엔진 + 서버 테스트
npm run typecheck
```

## 구조

```
apps/web        웹앱 (React + Vite + Tailwind, 차트: Lightweight Charts)
apps/server     API 서버 (Fastify) — 시세 소스 교체 가능, 지금은 가짜 시세(Mock)
packages/core   매매 규칙: 호가단위·가격제한폭·수수료·세금·장 시간·체결·환전·검색
packages/shared 공용 타입
```
