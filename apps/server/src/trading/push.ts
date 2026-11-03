import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import webpush from 'web-push';
import type { FcmService } from './fcm';

export interface PushMessage {
  title: string;
  body: string;
  /** 알림 누르면 열 화면 (예: /#/stock/005930) */
  url?: string;
  /** 같은 tag 알림은 하나로 합쳐짐 */
  tag?: string;
}

export interface PushSubscriptionJson {
  endpoint: string;
  keys: { p256dh: string; auth: string };
}

/** 실제 발송 (테스트에선 가짜로 바꿔 끼움) */
export type PushSender = (sub: PushSubscriptionJson, payload: string) => Promise<void>;

export interface VapidKeys {
  publicKey: string;
  privateKey: string;
}

/** VAPID 키: 환경변수 → 없으면 파일 → 없으면 새로 만들어 파일에 저장 */
export function loadVapidKeys(file: string): VapidKeys {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey } = process.env;
  if (publicKey && privateKey) return { publicKey, privateKey };
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as VapidKeys;
  } catch {
    const keys = webpush.generateVAPIDKeys();
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(keys));
    return keys;
  }
}

/** 폰 푸시: 구독 저장 + 모든 기기로 발송, 만료된 구독은 정리 */
export class PushService {
  /** 안드로이드 앱(FCM). 서비스 계정이 있을 때만 */
  fcm?: FcmService;

  constructor(
    private readonly db: DatabaseSync,
    readonly publicKey: string,
    private readonly send: PushSender,
    private readonly now: () => number = Date.now,
    private readonly userId = 1,
  ) {}

  static webPushSender(keys: VapidKeys, subject: string): PushSender {
    webpush.setVapidDetails(subject, keys.publicKey, keys.privateKey);
    return async (sub, payload) => {
      await webpush.sendNotification(sub, payload, { TTL: 3_600 });
    };
  }

  subscribe(sub: PushSubscriptionJson): void {
    this.db
      .prepare(
        `INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(endpoint) DO UPDATE SET p256dh = excluded.p256dh, auth = excluded.auth`,
      )
      .run(sub.endpoint, this.userId, sub.keys.p256dh, sub.keys.auth, this.now());
  }

  unsubscribe(endpoint: string): void {
    this.db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(endpoint);
  }

  count(): number {
    return (this.db.prepare('SELECT COUNT(*) AS n FROM push_subscriptions WHERE user_id = ?').get(this.userId) as { n: number }).n;
  }

  /** 등록된 모든 기기로. 보낸 개수 반환 */
  async notify(msg: PushMessage): Promise<number> {
    const rows = this.db.prepare('SELECT * FROM push_subscriptions WHERE user_id = ?').all(this.userId) as {
      endpoint: string;
      p256dh: string;
      auth: string;
    }[];
    const payload = JSON.stringify(msg);
    let sent = 0;
    await Promise.all(
      rows.map(async (r) => {
        try {
          await this.send({ endpoint: r.endpoint, keys: { p256dh: r.p256dh, auth: r.auth } }, payload);
          sent++;
        } catch (e) {
          // 404·410 = 앱 삭제·권한 해제 등으로 사라진 구독
          const status = (e as { statusCode?: number }).statusCode;
          if (status === 404 || status === 410) this.unsubscribe(r.endpoint);
        }
      }),
    );
    return sent + ((await this.fcm?.notify(msg)) ?? 0);
  }
}
