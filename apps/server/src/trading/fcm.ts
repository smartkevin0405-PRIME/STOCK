import { createSign } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { DatabaseSync } from 'node:sqlite';
import type { PushMessage } from './push';

/** 안드로이드 앱(APK) 푸시: Firebase Cloud Messaging HTTP v1 */

/** Firebase 콘솔 → 서비스 계정 → 새 비공개 키 (JSON) 중 필요한 값 */
export interface ServiceAccount {
  project_id: string;
  client_email: string;
  private_key: string;
  token_uri?: string;
}

/** fetch 대신 끼울 수 있는 HTTP 함수 (테스트용) */
export type HttpPost = (url: string, init: { headers: Record<string, string>; body: string }) => Promise<{ status: number; text(): Promise<string> }>;

/** 토큰 하나로 발송. 실패하면 FcmError */
export type FcmSender = (token: string, msg: PushMessage) => Promise<void>;

export class FcmError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** 앱 삭제·토큰 만료 → DB에서 지워야 함 */
    readonly unregistered: boolean,
  ) {
    super(message);
  }
}

const SCOPE = 'https://www.googleapis.com/auth/firebase.messaging';
const DEFAULT_TOKEN_URI = 'https://oauth2.googleapis.com/token';
/** 앱에서 만드는 알림 채널 (lib/nativePush.ts와 같은 값) */
export const FCM_CHANNEL = 'alerts';

export function loadServiceAccount(file: string): ServiceAccount {
  const json = JSON.parse(readFileSync(file, 'utf8')) as Partial<ServiceAccount>;
  if (!json.project_id || !json.client_email || !json.private_key) throw new Error(`서비스 계정 JSON이 올바르지 않아요: ${file}`);
  return json as ServiceAccount;
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** 구글 OAuth용 JWT (RS256) */
export function signJwt(account: ServiceAccount, nowSec: number): string {
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(
    JSON.stringify({
      iss: account.client_email,
      scope: SCOPE,
      aud: account.token_uri ?? DEFAULT_TOKEN_URI,
      iat: nowSec,
      exp: nowSec + 3_600,
    }),
  );
  const signature = createSign('RSA-SHA256').update(`${header}.${claims}`).sign(account.private_key);
  return `${header}.${claims}.${b64url(signature)}`;
}

const defaultHttp: HttpPost = (url, init) => fetch(url, { method: 'POST', ...init });

/** FCM 발송 함수 만들기. 접근 토큰은 만료 1분 전까지 재사용 */
export function createFcmSender(account: ServiceAccount, http: HttpPost = defaultHttp, now: () => number = Date.now): FcmSender {
  let cached: { token: string; expiresAt: number } | undefined;
  let pending: Promise<string> | undefined;

  const fetchToken = async (): Promise<string> => {
    const res = await http(account.token_uri ?? DEFAULT_TOKEN_URI, {
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion: signJwt(account, Math.floor(now() / 1000)),
      }).toString(),
    });
    const text = await res.text();
    if (res.status !== 200) throw new FcmError(`FCM 인증 실패 (${res.status}): ${text.slice(0, 200)}`, res.status, false);
    const data = JSON.parse(text) as { access_token: string; expires_in?: number };
    cached = { token: data.access_token, expiresAt: now() + (data.expires_in ?? 3_600) * 1000 };
    return data.access_token;
  };

  const accessToken = async (): Promise<string> => {
    if (cached && cached.expiresAt - 60_000 > now()) return cached.token;
    // 동시에 여러 건 보낼 때 토큰 요청은 한 번만
    pending ??= fetchToken().finally(() => (pending = undefined));
    return pending;
  };

  return async (token, msg) => {
    const data: Record<string, string> = {};
    if (msg.url) data.url = msg.url;
    if (msg.tag) data.tag = msg.tag;
    const body = {
      message: {
        token,
        notification: { title: msg.title, body: msg.body },
        data,
        android: {
          priority: 'high',
          ttl: '3600s',
          notification: { channel_id: FCM_CHANNEL, ...(msg.tag ? { tag: msg.tag } : {}) },
        },
      },
    };
    const res = await http(`https://fcm.googleapis.com/v1/projects/${account.project_id}/messages:send`, {
      headers: { Authorization: `Bearer ${await accessToken()}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (res.status === 200) return;
    const text = await res.text();
    if (res.status === 401) cached = undefined;
    // 404 또는 UNREGISTERED = 앱 삭제·토큰 만료
    const unregistered = res.status === 404 || text.includes('UNREGISTERED');
    throw new FcmError(`FCM 발송 실패 (${res.status}): ${text.slice(0, 200)}`, res.status, unregistered);
  };
}

/** FCM 기기 토큰 저장 + 발송 */
export class FcmService {
  constructor(
    private readonly db: DatabaseSync,
    private readonly send: FcmSender,
    private readonly now: () => number = Date.now,
    private readonly userId = 1,
  ) {}

  register(token: string): void {
    this.db
      .prepare(
        `INSERT INTO fcm_tokens (token, user_id, created_at, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT(token) DO UPDATE SET updated_at = excluded.updated_at`,
      )
      .run(token, this.userId, this.now(), this.now());
  }

  unregister(token: string): void {
    this.db.prepare('DELETE FROM fcm_tokens WHERE token = ?').run(token);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM fcm_tokens WHERE user_id = ?').get(this.userId) as { n: number }).n;
  }

  /** 등록된 모든 앱으로. 보낸 개수 반환. 사라진 토큰은 정리 */
  async notify(msg: PushMessage): Promise<number> {
    const rows = this.db.prepare('SELECT token FROM fcm_tokens WHERE user_id = ?').all(this.userId) as { token: string }[];
    let sent = 0;
    await Promise.all(
      rows.map(async ({ token }) => {
        try {
          await this.send(token, msg);
          sent++;
        } catch (e) {
          if (e instanceof FcmError && e.unregistered) this.unregister(token);
          else console.warn(`[fcm] ${(e as Error).message}`);
        }
      }),
    );
    return sent;
  }
}

/** 환경변수 FIREBASE_SERVICE_ACCOUNT(서비스 계정 JSON 파일 경로)가 있으면 FCM 켜기 */
export function fcmFromEnv(db: DatabaseSync, file = process.env.FIREBASE_SERVICE_ACCOUNT): FcmService | undefined {
  if (!file) return undefined;
  return new FcmService(db, createFcmSender(loadServiceAccount(file)));
}
