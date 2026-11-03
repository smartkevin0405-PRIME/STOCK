import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildApp } from '../src/app';
import { AuthService, loadAuthSecret } from '../src/auth';
import { TestProvider } from './helpers';

const DAY = 24 * 60 * 60 * 1000;

describe('AuthService', () => {
  it('맞는 비밀번호면 토큰, 틀리면 401', () => {
    const auth = new AuthService({ password: 'pw1234', secret: 's' });
    const ok = auth.login('pw1234', '1.1.1.1');
    expect(ok.ok).toBe(true);
    expect(ok.ok && auth.verify(ok.token)).toBe(true);
    expect(auth.login('wrong', '1.1.1.1')).toMatchObject({ ok: false, status: 401 });
    expect(auth.login(undefined, '1.1.1.1')).toMatchObject({ ok: false, status: 401 });
  });

  it('토큰은 30일 뒤 만료', () => {
    let now = 0;
    const auth = new AuthService({ password: 'pw', secret: 's', now: () => now });
    const token = auth.issue();
    now = 29 * DAY;
    expect(auth.verify(token)).toBe(true);
    now = 31 * DAY;
    expect(auth.verify(token)).toBe(false);
  });

  it('위조·다른 키·비밀번호 변경 토큰은 거부', () => {
    const auth = new AuthService({ password: 'pw', secret: 's' });
    const token = auth.issue();
    const [payload, sig] = token.split('.');
    const forged = Buffer.from(JSON.stringify({ iat: 0, exp: Date.now() + 365 * DAY })).toString('base64url');
    expect(auth.verify(`${forged}.${sig}`)).toBe(false);
    expect(auth.verify(`${payload}.x${sig!.slice(1)}`)).toBe(false);
    expect(auth.verify('garbage')).toBe(false);
    expect(auth.verify(undefined)).toBe(false);
    expect(new AuthService({ password: 'pw', secret: 'other' }).verify(token)).toBe(false);
    expect(new AuthService({ password: 'pw2', secret: 's' }).verify(token)).toBe(false);
  });

  it('5분에 5번 틀리면 429, 시간 지나면 풀림', () => {
    let now = 0;
    const auth = new AuthService({ password: 'pw', secret: 's', now: () => now });
    for (let i = 0; i < 5; i++) expect(auth.login('x', 'a')).toMatchObject({ status: 401 });
    // 맞는 비밀번호도 막힘
    expect(auth.login('pw', 'a')).toMatchObject({ ok: false, status: 429 });
    // 다른 IP는 영향 없음
    expect(auth.login('pw', 'b').ok).toBe(true);
    now = 5 * 60 * 1000 + 1;
    expect(auth.login('pw', 'a').ok).toBe(true);
  });

  it('APP_PASSWORD 없으면 꺼짐, 서명 키는 파일에 한 번 만들어 재사용', () => {
    const dir = mkdtempSync(join(tmpdir(), 'auth-'));
    try {
      expect(AuthService.fromEnv(dir, {})).toBeUndefined();
      const a = AuthService.fromEnv(dir, { APP_PASSWORD: 'pw' })!;
      const secret = readFileSync(join(dir, 'auth-secret'), 'utf8');
      expect(secret).toHaveLength(64);
      expect(loadAuthSecret(join(dir, 'auth-secret'))).toBe(secret);
      // 재시작해도 토큰 유지
      expect(AuthService.fromEnv(dir, { APP_PASSWORD: 'pw' })!.verify(a.issue())).toBe(true);
      // AUTH_SECRET이 있으면 그걸 씀
      const b = AuthService.fromEnv(dir, { APP_PASSWORD: 'pw', AUTH_SECRET: 'env-secret' })!;
      expect(b.verify(a.issue())).toBe(false);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe('로그인 켜진 서버', () => {
  let app: Awaited<ReturnType<typeof buildApp>>;
  let token: string;

  beforeAll(async () => {
    app = await buildApp({ provider: new TestProvider(), auth: new AuthService({ password: 'pw', secret: 's' }) });
    await app.ready();
  });
  afterAll(async () => {
    await app.close();
  });

  it('헬스체크는 로그인 없이, auth: true', async () => {
    const res = await app.inject('/api/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, auth: true });
  });

  it('로그인 실패 401, 성공하면 토큰', async () => {
    const bad = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'nope' } });
    expect(bad.statusCode).toBe(401);
    expect(bad.json().error).toBe('비밀번호가 틀렸어요');
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'pw' } });
    expect(res.statusCode).toBe(200);
    token = res.json().token;
    expect(token).toMatch(/^[\w-]+\.[\w-]+$/);
  });

  it('토큰 없으면 401, 있으면 200', async () => {
    const no = await app.inject('/api/quotes?codes=005930');
    expect(no.statusCode).toBe(401);
    expect(no.json()).toEqual({ error: '로그인이 필요해요' });
    expect((await app.inject({ url: '/api/quotes?codes=005930', headers: { authorization: 'Bearer bad.token' } })).statusCode).toBe(401);
    const yes = await app.inject({ url: '/api/quotes?codes=005930', headers: { authorization: `Bearer ${token}` } });
    expect(yes.statusCode).toBe(200);
    expect(yes.json().quotes[0].price).toBe(70_000);
  });

  it('없는 API 주소도 401 (경로 노출 안 함)', async () => {
    expect((await app.inject('/api/nothing')).statusCode).toBe(401);
  });

  it('주소의 토큰은 /ws에서만 받음', async () => {
    expect((await app.inject(`/api/quotes?codes=005930&token=${token}`)).statusCode).toBe(401);
  });

  it('WebSocket: 토큰 없으면 거부, 있으면 연결', async () => {
    await expect(app.injectWS('/ws')).rejects.toThrow(/401/);
    const ws = await app.injectWS(`/ws?token=${encodeURIComponent(token)}`);
    expect(ws.readyState).toBe(ws.OPEN);
    ws.terminate();
  });

  it('여러 번 틀리면 429', async () => {
    let last = 0;
    for (let i = 0; i < 6; i++) {
      last = (await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'x' } })).statusCode;
    }
    expect(last).toBe(429);
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { password: 'pw' } });
    expect(res.statusCode).toBe(429);
    expect(res.json().error).toContain('너무 많이');
  });
});

describe('로그인 꺼진 서버', () => {
  it('APP_PASSWORD 없으면 모든 API 열림', async () => {
    const app = await buildApp({ provider: new TestProvider() });
    expect((await app.inject('/api/health')).json().auth).toBe(false);
    expect((await app.inject('/api/quotes?codes=005930')).statusCode).toBe(200);
    expect((await app.inject({ method: 'POST', url: '/api/login', payload: {} })).json()).toEqual({ token: '' });
    await app.close();
  });
});

describe('웹앱 같이 서비스', () => {
  const dir = mkdtempSync(join(tmpdir(), 'web-'));
  let app: Awaited<ReturnType<typeof buildApp>>;

  beforeAll(async () => {
    writeFileSync(join(dir, 'index.html'), '<!doctype html><title>STOCK</title>');
    mkdirSync(join(dir, 'assets'));
    writeFileSync(join(dir, 'assets', 'app-abc.js'), 'console.log(1)');
    app = await buildApp({ provider: new TestProvider(), auth: new AuthService({ password: 'pw', secret: 's' }), webDir: dir });
  });
  afterAll(async () => {
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  });

  it('/ 는 로그인 없이 index.html, API는 계속 보호', async () => {
    const root = await app.inject('/');
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('<title>STOCK</title>');
    const js = await app.inject('/assets/app-abc.js');
    expect(js.statusCode).toBe(200);
    expect(js.headers['cache-control']).toContain('immutable');
    expect((await app.inject('/api/account')).statusCode).toBe(401);
  });
});
