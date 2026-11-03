# STOCK

한국·미국 실제 시세로 실전처럼 연습하는 주식 모의투자 앱 (웹 → 안드로이드 APK).

- 기획서: [docs/PLAN.md](docs/PLAN.md)
- 안드로이드 앱(APK)·앱 푸시: [docs/APK.md](docs/APK.md) — 서버 없이 앱만으로도 쓸 수 있어요
- 서버 배포: [docs/DEPLOY.md](docs/DEPLOY.md)
- 진행 상황: **기획서 로드맵(M0~M5 + 선택 기능) 전부 구현**. 실제 서버 배포·폰 설치·키가 필요한 기능 확인은 남음

## 실행

Node.js 22 이상 필요.

```bash
npm install
npm run dev      # 서버(8787) + 웹(5173) 같이 실행 → http://localhost:5173
npm test         # 매매 규칙 엔진 + 서버 테스트
npm run typecheck
npm run build && npm start   # 배포용: 서버가 빌드된 웹앱까지 같이 서비스 (8787 하나로)
```

서버에 올리는 방법(Oracle Cloud 무료 VM + Docker + 자동 https): [docs/DEPLOY.md](docs/DEPLOY.md)

환경변수 (전부 선택, 없어도 동작):

| 변수 | 기본값 | 설명 |
|---|---|---|
| `MARKET_DATA` | `live` | `live`: 네이버 → 야후 실제 시세 / `mock`: 가짜 시세 (인터넷 없이 개발) |
| `PORT` | `8787` | 서버 포트 |
| `DATA_DIR` | `apps/server/data` | 계좌 DB(`stock.db`)와 전체 종목 목록 저장 위치 (종목 목록은 첫 실행 때 30초쯤 걸려 받아옴) |
| `VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY` | 자동 생성 | 폰 푸시용 키. 없으면 처음 실행 때 만들어 `DATA_DIR/vapid.json`에 저장 |
| `VAPID_SUBJECT` | `mailto:admin@example.com` | 푸시 서비스에 알리는 연락처. 배포할 때 본인 주소로 |
| `FIREBASE_SERVICE_ACCOUNT` | 없음 | 안드로이드 앱 푸시(FCM)용 서비스 계정 JSON 파일 경로. 없으면 앱 푸시만 꺼짐 |
| `CORS_ORIGINS` | 없음 | 앱(`https://localhost`) 말고 API를 더 허용할 주소 (쉼표로 구분) |
| `APP_PASSWORD` | 없음 (로그인 끔) | 로그인 비밀번호. 배포할 땐 꼭 설정 |
| `AUTH_SECRET` | 자동 생성 | 로그인 토큰 서명 키. 없으면 `DATA_DIR/auth-secret`에 만들어 저장 |
| `TRUST_PROXY` | 없음 | Caddy 같은 프록시 뒤에서 돌릴 때 `1` (로그인 시도 제한이 실제 IP 기준으로) |
| `WEB_DIR` | `apps/web/dist` | 서버가 같이 서비스할 웹 빌드 폴더 |
| `KIS_APP_KEY` / `KIS_APP_SECRET` | 없음 | (선택) 한국투자증권 Open API. 넣으면 실시간 시세·호가창. 시세 조회만 하고 주문은 절대 안 함 |
| `KIS_ENV` | `real` | `real` 실전 / `paper` 모의투자 키 |
| `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` | 없음 | (선택, 유료) 넣으면 코치 탭에서 AI 리포트를 앱 안에서 바로 받음 |
| `AI_PROVIDER` / `AI_MODEL` | 자동 | 둘 다 키가 있을 때 고를 공급자, 모델 바꾸기 |
| `AI_FALLBACK` | 켜짐 | Claude가 답을 거절하면 다른 모델로 넘기기. `off`로 끔 |

폰 푸시는 https 주소에서만 동작해요 (배포 후). 아이폰은 Safari에서 "홈 화면에 추가"한 앱에서만 켤 수 있어요.

네이버·야후 시세는 비공식이라 개인 연습용으로만 쓰세요.

## 구조

```
apps/web        웹앱 (React + Vite + Tailwind, 차트: Lightweight Charts) + android/ (Capacitor)
apps/server     API 서버 (Fastify + node:sqlite)
                  market/   시세: (한투) → 네이버 → 야후 자동 전환, 가짜 시세(Mock)
                  trading/  주문·체결·환전·리셋, 일지, 관심 그룹, 알림·푸시, 통계·코치, 업적, 배당·분할
                  replay/   타임머신 리플레이
                  ai/       AI에게 물어보기 질문 만들기, (선택) AI API
packages/core   매매 규칙: 호가단위·가격제한폭·수수료·세금·장 시간·체결·환전·검색·통계·코치·리플레이
packages/shared 공용 타입
```

## 기능 한눈에

- **시세:** 국내·미국 실시간 시세, 약 11,000종목 검색(초성·한글명), 분봉~월봉 차트, 이동평균·볼린저밴드·RSI, 순위
- **매매:** 시장가·지정가, 수수료·세금·슬리피지, 장 시간·휴장일, 예약주문, 당일 주문 자동 취소, 정정·취소, 환전, 배당·액면분할 반영
- **관리:** 총자산·오늘 수익·환율 손익, 관심종목 그룹, 가격 알림 + 폰 푸시, 매매일지(메모·태그), 시즌 기록·리셋
- **분석:** 승률·손익비·최대 낙폭·보유기간, 자산 추이 vs 코스피·S&P500, 월별 수익 캘린더, 미국주식 양도세 예상
- **차별화:** 규칙 기반 코치, AI에게 물어보기(복사), 챌린지·업적, 타임머신 리플레이
- **배포:** 비밀번호 로그인, Docker + Caddy(https), 안드로이드 APK(GitHub Actions 자동 빌드), FCM 앱 푸시
