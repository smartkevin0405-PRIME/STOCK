import { createVerify, generateKeyPairSync } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { MockProvider } from '../src/market/mock';
import { AlertService } from '../src/trading/alerts';
import { openDb } from '../src/trading/db';
import { FcmError, FcmService, createFcmSender, type HttpPost, type ServiceAccount } from '../src/trading/fcm';
import { PushService } from '../src/trading/push';

const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const account: ServiceAccount = {
  project_id: 'demo-proj',
  client_email: 'push@demo-proj.iam.gserviceaccount.com',
  private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
};
const TOKEN_A = 'device-token-aaaaaaaaaaaaaaaa';
const TOKEN_B = 'device-token-bbbbbbbbbbbbbbbb';

/** 가짜 구글 서버: 요청을 기록하고, 토큰별로 응답을 정함 */
function fakeGoogle(fail: Record<string, { status: number; body: string }> = {}) {
  const calls: { url: string; headers: Record<string, string>; body: string }[] = [];
  const http: HttpPost = async (url, init) => {
    calls.push({ url, ...init });
    if (url.includes('oauth2')) return { status: 200, text: async () => JSON.stringify({ access_token: 'at-1', expires_in: 3600 }) };
    const token = (JSON.parse(init.body) as { message: { token: string } }).message.token;
    const r = fail[token] ?? { status: 200, body: '{"name":"projects/demo-proj/messages/1"}' };
    return { status: r.status, text: async () => r.body };
  };
  return { http, calls };
}

describe('FCM 발송', () => {
  it('JWT 서명 → 접근 토큰 → 메시지 발송, 토큰은 재사용', async () => {
    let now = Date.parse('2026-11-03T00:00:00Z');
    const { http, calls } = fakeGoogle();
    const send = createFcmSender(account, http, () => now);
    await Promise.all([send(TOKEN_A, { title: '삼성전자 가격 알림', body: '75,000원 이상 도달', url: '/#/stock/005930', tag: 'alert-1' }), send(TOKEN_B, { title: 't', body: 'b' })]);

    const auth = calls.filter((c) => c.url.includes('oauth2'));
    expect(auth).toHaveLength(1);
    const assertion = new URLSearchParams(auth[0]!.body).get('assertion')!;
    const [h, c, sig] = assertion.split('.');
    expect(createVerify('RSA-SHA256').update(`${h}.${c}`).verify(publicKey, Buffer.from(sig!, 'base64url'))).toBe(true);
    const claims = JSON.parse(Buffer.from(c!, 'base64url').toString()) as Record<string, unknown>;
    expect(claims).toMatchObject({ iss: account.client_email, scope: 'https://www.googleapis.com/auth/firebase.messaging', aud: 'https://oauth2.googleapis.com/token' });

    const msg = calls.find((x) => x.url.includes('fcm.googleapis.com'))!;
    expect(msg.url).toBe('https://fcm.googleapis.com/v1/projects/demo-proj/messages:send');
    expect(msg.headers.Authorization).toBe('Bearer at-1');
    expect(JSON.parse(msg.body).message).toMatchObject({
      token: TOKEN_A,
      notification: { title: '삼성전자 가격 알림', body: '75,000원 이상 도달' },
      data: { url: '/#/stock/005930', tag: 'alert-1' },
      android: { notification: { channel_id: 'alerts', tag: 'alert-1' } },
    });

    // 만료 1분 전이 지나면 새로 받음
    now += 3_550_000;
    await send(TOKEN_A, { title: 't', body: 'b' });
    expect(calls.filter((x) => x.url.includes('oauth2'))).toHaveLength(2);
  });

  it('404·UNREGISTERED는 지워야 할 토큰으로 표시', async () => {
    const { http } = fakeGoogle({
      [TOKEN_A]: { status: 404, body: '{"error":{"status":"NOT_FOUND"}}' },
      [TOKEN_B]: { status: 400, body: '{"error":{"details":[{"errorCode":"UNREGISTERED"}]}}' },
    });
    const send = createFcmSender(account, http);
    for (const t of [TOKEN_A, TOKEN_B]) {
      const err = await send(t, { title: 't', body: 'b' }).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(FcmError);
      expect((err as FcmError).unregistered).toBe(true);
    }
  });
});

describe('FCM 토큰 + PushService', () => {
  const db = openDb(':memory:');
  const sent: string[] = [];
  const push = new PushService(db, 'pk', async () => {
    sent.push('web');
  });
  const fcm = new FcmService(db, async (token) => {
    if (token === TOKEN_B) throw new FcmError('gone', 404, true);
    if (token.startsWith('flaky')) throw new FcmError('busy', 503, false);
    sent.push(token);
  });
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    const provider = new MockProvider();
    app = await buildApp({ provider, alerts: new AlertService(db), push });
  });
  afterAll(async () => {
    await app.close();
  });

  it('FCM 설정 없으면 503', async () => {
    expect((await app.inject('/api/push/fcm')).json()).toEqual({ enabled: false, devices: 0 });
    const res = await app.inject({ method: 'POST', url: '/api/push/fcm', payload: { token: TOKEN_A } });
    expect(res.statusCode).toBe(503);
  });

  it('토큰 등록 → 웹 푸시와 같이 발송 → 사라진 토큰 정리', async () => {
    push.fcm = fcm;
    push.subscribe({ endpoint: 'https://push.example/1', keys: { p256dh: 'k', auth: 'a' } });
    expect((await app.inject({ method: 'POST', url: '/api/push/fcm', payload: { token: 'short' } })).statusCode).toBe(400);
    for (const token of [TOKEN_A, TOKEN_B, TOKEN_A, 'flaky-token-cccccccccccccc']) {
      const res = await app.inject({ method: 'POST', url: '/api/push/fcm', payload: { token } });
      expect(res.statusCode).toBe(201);
    }
    expect((await app.inject('/api/push/fcm')).json()).toEqual({ enabled: true, devices: 3 });

    expect(await push.notify({ title: 't', body: 'b' })).toBe(2);
    expect(sent.sort()).toEqual([TOKEN_A, 'web']);
    // 404 토큰만 지우고, 일시 오류는 남김
    expect(fcm.count()).toBe(2);

    const res = await app.inject({ method: 'POST', url: '/api/push/fcm/unregister', payload: { token: TOKEN_A } });
    expect(res.json()).toEqual({ devices: 1 });
  });

  it('앱(https://localhost)에서 오는 요청은 CORS 허용', async () => {
    const pre = await app.inject({ method: 'OPTIONS', url: '/api/push/fcm', headers: { origin: 'https://localhost', 'access-control-request-method': 'POST' } });
    expect(pre.statusCode).toBe(204);
    expect(pre.headers['access-control-allow-origin']).toBe('https://localhost');
    expect(pre.headers['access-control-allow-headers']).toContain('Authorization');
    const get = await app.inject({ url: '/api/health', headers: { origin: 'https://localhost' } });
    expect(get.headers['access-control-allow-origin']).toBe('https://localhost');
    const other = await app.inject({ url: '/api/health', headers: { origin: 'https://evil.example' } });
    expect(other.headers['access-control-allow-origin']).toBeUndefined();
  });
});
