# 안드로이드 앱 (APK)

웹앱을 Capacitor로 감싼 안드로이드 앱이에요. 화면·기능은 웹과 같아요.
처음 켤 때 **서버 없이 쓰기**(서버·카드 필요 없음)와 **내 서버에 연결** 중에 골라요.

## 1. APK 받기

### 방법 A — GitHub Actions (추천, 설치할 것 없음)

1. GitHub 저장소 → **Actions** → **Android APK** → **Run workflow**
   (`apps/web`·`packages` 바뀐 걸 push해도 자동으로 돌아요)
2. 다 끝나면(5~10분) 실행 화면 아래 **Artifacts → stock-apk** 받기 → 압축 풀면 `app-debug.apk`

선택 설정 (저장소 → Settings → Secrets and variables → Actions):

| 종류 | 이름 | 내용 |
|---|---|---|
| Variables | `VITE_API_BASE` | 서버 주소 (예: `https://my-stock.duckdns.org`). 넣으면 앱이 주소를 묻지 않고 바로 연결 |
| Secrets | `GOOGLE_SERVICES_JSON` | `google-services.json` 파일 내용 전체 (푸시용, 아래 4장) |
| Secrets | `DEBUG_KEYSTORE_BASE64` | 서명 키 (`base64 -w0 ~/.android/debug.keystore` 결과). 없으면 빌드마다 서명이 달라서 새 버전 설치 전에 앱을 지워야 해요 |

### 방법 B — 내 PC에서 빌드

필요한 것: Node.js 22, JDK 21, Android SDK (Android Studio 설치하면 같이 깔림)

```bash
npm install
cd apps/web
npm run apk        # 웹 빌드 → 안드로이드에 복사 → APK 빌드
```

결과: `apps/web/android/app/build/outputs/apk/debug/app-debug.apk`

- 서버 주소를 앱에 박아 넣으려면: `VITE_API_BASE=https://my-stock.duckdns.org npm run apk`
- Android Studio로 열기: `npx cap open android`
- SDK 위치를 못 찾으면 `apps/web/android/local.properties`에 `sdk.dir=/SDK/경로` 한 줄

## 2. 폰에 설치

1. APK 파일을 폰으로 옮기기 (카톡 나에게 보내기, 구글 드라이브, USB 등)
2. 파일 열기 → "출처를 알 수 없는 앱" 허용 (설정 → 보안 또는 앱 → 특수 접근 → 알 수 없는 앱 설치 → 파일을 연 앱 허용)
3. 설치 → 실행

Play 프로텍트가 경고하면 "무시하고 설치"를 누르면 돼요 (직접 만든 앱이라 그래요).

## 3. 서버 없이 쓰기 또는 서버 주소 넣기

처음 켜면 **STOCK 시작하기** 화면이 나와요.

### 서버 없이 쓰기 (가장 간단)

**서버 없이 시작하기**를 누르면 끝이에요. 서버 코드가 앱 안에서 그대로 돌아요.

- 시세: 폰이 네이버·야후에서 직접 받아요
- 계좌·주문·기록: 이 폰 안(SQLite)에만 저장. 앱을 지우면 같이 지워져요
- 지정가 주문: 앱을 열 때 꺼져 있던 동안의 5분봉을 보고, 가격이 닿았으면 그때 가격·시각으로 체결해요
- 가격 알림·체결 알림: 앱이 켜져 있을 때만 (앱이 꺼져 있을 때 오는 푸시는 서버가 있어야 해요)
- 한투 API·AI 바로 리포트는 서버 모드에서만 (AI에게 물어볼 질문 복사는 돼요)

### 내 서버에 연결

- 주소 입력 → **연결하기** → 서버의 `/api/health`로 확인 후 저장
- 예: `https://my-stock.duckdns.org`, 집 PC면 `http://192.168.0.10:8787` (같은 와이파이일 때)
- `https://`를 안 쓰면 자동으로 붙여요. http 서버면 `http://`까지 써주세요
- 나중에 바꾸기: **더보기 → 서버 주소**

서버 쪽은 따로 설정할 것 없어요. 앱(`https://localhost`)에서 오는 요청은 서버가 자동으로 허용해요 (CORS).
다른 주소에서도 API를 부르려면 서버 환경변수 `CORS_ORIGINS`에 쉼표로 넣으면 돼요.

## 4. 푸시 알림 (Firebase)

앱 푸시는 구글 FCM을 써요. 무료예요. 설정 안 하면 푸시만 꺼지고 나머지는 다 돼요
(앱이 켜져 있을 땐 화면 알림으로 와요).

### 4-1. Firebase 프로젝트 만들기

1. <https://console.firebase.google.com> → 프로젝트 추가 (애널리틱스는 꺼도 됨)
2. 프로젝트 개요 → **Android 앱 추가**
   - 패키지 이름: `app.stockmock.android` (꼭 이대로)
   - 나머지는 비워도 됨
3. `google-services.json` 받기

### 4-2. 앱에 넣기 (google-services.json)

- 내 PC 빌드: `apps/web/android/app/google-services.json`에 두고 다시 빌드 (깃에는 안 올라가요)
- GitHub Actions: 파일 내용을 통째로 복사해서 시크릿 `GOOGLE_SERVICES_JSON`에 넣고 다시 실행

이 파일 없이 빌드한 앱은 알림 화면에 "푸시 없이 빌드됐어요"라고 나와요.

### 4-3. 서버에 넣기 (서비스 계정 키)

1. Firebase 콘솔 → ⚙️ 프로젝트 설정 → **서비스 계정** → **새 비공개 키 생성** → JSON 파일 받기
2. 서버 컴퓨터에 올리기 (예: `/home/ubuntu/stock/firebase-key.json`). **깃에 올리면 안 돼요**
3. 서버 환경변수에 파일 경로 지정 후 재시작

```bash
FIREBASE_SERVICE_ACCOUNT=/home/ubuntu/stock/firebase-key.json npm start -w @stock/server
```

### 4-4. 켜기

앱 → **더보기 → 가격 알림 · 폰 알림 → 알림 켜기** → 권한 허용 → **테스트 보내기**

- 앱을 지우거나 알림을 끈 폰은 서버가 알아서 목록에서 빼요
- 알림을 누르면 해당 종목 화면이 열려요

## 문제 해결

| 증상 | 확인할 것 |
|---|---|
| "연결하지 못했어요" | 폰 브라우저로 `서버주소/api/health`가 열리는지. 방화벽·포트 |
| 알림 화면에 "서버에 앱 푸시 설정이 없어요" | 서버의 `FIREBASE_SERVICE_ACCOUNT` 경로, 재시작 했는지 |
| 테스트 알림이 안 옴 | 서버 로그의 `[fcm]` 메시지. 패키지 이름이 `app.stockmock.android`인지, 두 파일이 같은 Firebase 프로젝트인지 |
| 새 APK 설치가 안 됨 ("패키지가 충돌") | 서명이 달라서 그래요. 앱 지우고 설치하거나 `DEBUG_KEYSTORE_BASE64` 설정 |
