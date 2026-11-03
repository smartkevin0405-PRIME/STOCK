# 배포 가이드 (Oracle Cloud 무료 VM)

서버 1대에 **앱(서버+웹)** 과 **Caddy(자동 https)** 를 Docker로 같이 올려요.
폰 푸시는 https 주소에서만 동작해서 도메인이 꼭 필요해요 (무료 도메인으로 충분).

```
 폰/PC ──https──▶ Caddy (80·443, 인증서 자동) ──▶ app (8787, 서버 + 웹앱)
                                                    └─ /data 볼륨: 계좌 DB, 푸시 키, 로그인 서명 키
```

## 0. 준비물

| 준비할 것 | 비용 | 비고 |
|---|---|---|
| Oracle Cloud 계정 | 무료 (Always Free) | 가입 때 카드 인증 필요 (결제 안 됨) |
| 도메인 | 무료 | DuckDNS 추천 (아래 3단계) |
| 로그인 비밀번호 | — | 길고 어렵게. 앱은 이 비밀번호 하나로만 들어가요 |

## 1. VM 만들기

1. Oracle Cloud 콘솔 → **Compute → Instances → Create instance**
2. **Image**: Canonical Ubuntu 24.04 (또는 22.04)
3. **Shape** (둘 다 Always Free)
   - 추천: **Ampere A1 (VM.Standard.A1.Flex)** — ARM, 1 OCPU / 6GB 정도면 넉넉해요
   - 대안: **VM.Standard.E2.1.Micro** — 메모리 1GB라 빌드할 때 모자랄 수 있어요 → 아래 "문제 해결"의 스왑 만들기 먼저
4. **Networking**: 공인 IP 자동 할당(Assign a public IPv4 address) 켜기
5. **SSH keys**: 키 파일 내려받기 (또는 내 공개키 붙여넣기)
6. 만들어지면 **Public IP** 메모 → 접속:

```bash
ssh -i 내려받은키.key ubuntu@<공인IP>
```

> 참고: 무료 계정은 CPU를 거의 안 쓰는 인스턴스를 회수할 수 있어요. 오래 쓸 거면 계정을 Pay As You Go로 올려두면 (무료 한도 안에선 여전히 0원) 회수 대상에서 빠져요.

## 2. 포트 80·443 열기

방화벽이 **두 군데** 있어서 둘 다 열어야 해요.

**① Oracle 콘솔 (Security List)**
Networking → Virtual Cloud Networks → 내 VCN → Subnet → Security List → **Add Ingress Rules**

| Source CIDR | Protocol | Destination Port |
|---|---|---|
| 0.0.0.0/0 | TCP | 80 |
| 0.0.0.0/0 | TCP | 443 |
| 0.0.0.0/0 | UDP | 443 (선택, HTTP/3) |

**② VM 안 (Ubuntu iptables)** — Oracle 우분투 이미지는 기본으로 막혀 있어요

```bash
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 80 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p tcp --dport 443 -j ACCEPT
sudo iptables -I INPUT 6 -m state --state NEW -p udp --dport 443 -j ACCEPT
sudo netfilter-persistent save
```

8787 포트는 열지 마세요. 앱은 Caddy를 통해서만 접속돼요.

## 3. 무료 도메인 (DuckDNS)

1. <https://www.duckdns.org> → GitHub·Google 계정으로 로그인
2. 원하는 이름 입력 → **add domain** (예: `mystock` → `mystock.duckdns.org`)
3. **current ip** 칸에 VM 공인 IP 넣고 **update ip**
4. 확인 (VM이나 내 PC에서):

```bash
nslookup mystock.duckdns.org   # VM 공인 IP가 나오면 OK
```

다른 방법: 내 도메인을 사도 돼요 (연 1~2만원, 예: Cloudflare·가비아). DNS에서 A 레코드를 VM IP로 지정하면 끝.

## 4. Docker 설치

```bash
curl -fsSL https://get.docker.com | sudo sh
sudo usermod -aG docker $USER
exit   # 다시 ssh 접속해야 docker 그룹이 적용돼요
```

확인: `docker compose version`

## 5. 코드 받고 설정

```bash
git clone <저장소 주소> stock
cd stock
cp .env.example .env
nano .env
```

`.env`에 넣을 값:

| 변수 | 필수 | 설명 |
|---|---|---|
| `DOMAIN` | ✅ | 3단계 도메인 (예: `mystock.duckdns.org`). `https://` 없이 |
| `APP_PASSWORD` | ✅ | 로그인 비밀번호. 없으면 docker compose가 실행을 거부해요 |
| `VAPID_SUBJECT` | 권장 | 폰 푸시 연락처. `mailto:내메일@example.com` |
| `AUTH_SECRET` | 선택 | 로그인 토큰 서명 키. 비우면 `/data/auth-secret`에 자동 생성 |
| `MARKET_DATA` | 선택 | `live`(기본) / `mock` |

푸시 키(VAPID)는 첫 실행 때 자동으로 만들어 `/data/vapid.json`에 저장돼요.
비공개 저장소라면 `git clone` 때 GitHub 토큰이나 deploy key가 필요해요.

## 6. 실행

```bash
docker compose up -d --build
docker compose logs -f        # Ctrl+C로 빠져나와도 계속 실행돼요
```

- 처음 빌드는 몇 분 걸려요. 전체 종목 목록도 첫 실행 때 30초쯤 받아와요
- Caddy가 인증서를 자동으로 받아요. 로그에 `certificate obtained successfully`가 보이면 OK
- 브라우저에서 `https://mystock.duckdns.org` → 비밀번호 입력

**폰에 설치**
- 안드로이드 크롬: 메뉴 → **홈 화면에 추가**
- 아이폰 Safari: 공유 → **홈 화면에 추가** (아이폰은 이렇게 연 앱에서만 푸시 가능)
- 앱 → 더보기 → 가격 알림 · 폰 알림 → 알림 켜기

## 7. 업데이트

```bash
cd ~/stock
git pull
docker compose up -d --build
docker image prune -f   # 예전 이미지 정리
```

계좌 데이터는 볼륨(`app-data`)에 있어서 업데이트해도 그대로예요.

## 8. 백업

`/data` 안의 파일이 전부예요: `stock.db*`(계좌·주문·일지), `vapid.json`(푸시 키), `auth-secret`(로그인 서명 키), `stocks.json`(종목 목록).

**백업** (앱을 1~2초 멈추고 복사 → DB가 깨지지 않게)

```bash
cd ~/stock
docker compose stop app
docker compose cp app:/data ./backup-$(date +%F)
docker compose start app
```

내 PC로 가져오기:

```bash
scp -i 키.key -r ubuntu@<공인IP>:stock/backup-2026-11-03 .
```

**매일 자동 백업** (새벽 4시, 14일치만 보관) — `crontab -e`에 한 줄:

```
0 4 * * * cd ~/stock && docker compose stop app && docker compose cp app:/data ./backups/$(date +\%F) && docker compose start app; find ~/stock/backups -mindepth 1 -maxdepth 1 -mtime +14 -exec rm -rf {} +
```

(먼저 `mkdir -p ~/stock/backups`)

**복원**

```bash
docker compose stop app
docker compose cp ./backup-2026-11-03/. app:/data/
docker compose run --rm --no-deps -u root app chown -R node:node /data
docker compose start app
```

## 9. 문제 해결

| 증상 | 해결 |
|---|---|
| https 접속 안 됨 / 인증서 오류 | `docker compose logs caddy` 확인. 도메인이 VM IP를 가리키는지(3단계), 80·443이 두 군데 다 열렸는지(2단계) |
| 빌드 중 멈춤 (1GB VM) | 스왑 만들기: `sudo fallocate -l 2G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile && echo '/swapfile none swap sw 0 0' \| sudo tee -a /etc/fstab` |
| "비밀번호를 너무 많이 틀렸어요" | 5분 기다리기 (또는 `docker compose restart app`) |
| 비밀번호 바꾸기 | `.env`의 `APP_PASSWORD` 수정 → `docker compose up -d`. 예전 로그인은 모두 풀려요 |
| 모든 기기 강제 로그아웃 | `AUTH_SECRET`을 바꾸거나, 없다면 `docker compose exec app rm /data/auth-secret` 후 `docker compose restart app` |
| 폰 알림이 안 옴 | https 주소인지, 아이폰은 홈 화면 앱인지, 더보기 → 가격 알림 · 폰 알림에서 "테스트 보내기"로 확인 |

## 10. Docker 없이 실행 (선택)

Node.js 22가 있으면 한 프로세스로 실행할 수 있어요. https는 따로 (Caddy 등) 앞에 둬야 해요.

```bash
npm ci
npm run build                          # 웹앱 → apps/web/dist
APP_PASSWORD=비밀번호 npm start         # 8787 포트에서 서버 + 웹앱
```

앞에 프록시를 둘 때는 `TRUST_PROXY=1`을 같이 주면 로그인 시도 제한이 실제 접속 IP 기준으로 동작해요 (프록시 없이 바로 열 땐 넣지 마세요).
