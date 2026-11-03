import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import type { FastifyInstance, FastifyRequest } from 'fastify';

const DAY = 24 * 60 * 60 * 1000;

export interface AuthOptions {
  /** 로그인 비밀번호 (APP_PASSWORD) */
  password: string;
  /** 토큰 서명 키 */
  secret: string;
  now?: () => number;
  /** 토큰 유효 기간 (기본 30일) */
  ttlMs?: number;
  /** 이 시간 안에 maxFails번 틀리면 잠시 막음 */
  windowMs?: number;
  maxFails?: number;
}

export type LoginResult = { ok: true; token: string } | { ok: false; status: 401 | 429; error: string };

const b64 = (buf: Buffer | string) => Buffer.from(buf).toString('base64url');
const sha256 = (s: string) => createHash('sha256').update(s).digest();

/** 비밀번호 로그인 (혼자 쓰는 앱). 토큰 = 발급·만료 시각 + HMAC 서명 */
export class AuthService {
  private readonly passwordHash: Buffer;
  private readonly key: Buffer;
  private readonly now: () => number;
  private readonly ttlMs: number;
  private readonly windowMs: number;
  private readonly maxFails: number;
  /** IP별 실패 시각 */
  private readonly fails = new Map<string, number[]>();

  constructor(opts: AuthOptions) {
    this.passwordHash = sha256(opts.password);
    // 비밀번호를 바꾸면 예전 토큰은 모두 무효
    this.key = createHmac('sha256', opts.secret).update(opts.password).digest();
    this.now = opts.now ?? Date.now;
    this.ttlMs = opts.ttlMs ?? 30 * DAY;
    this.windowMs = opts.windowMs ?? 5 * 60 * 1000;
    this.maxFails = opts.maxFails ?? 5;
  }

  /** APP_PASSWORD가 있을 때만 켜짐. 서명 키는 AUTH_SECRET → 없으면 DATA_DIR/auth-secret */
  static fromEnv(dataDir: string, env: NodeJS.ProcessEnv = process.env): AuthService | undefined {
    const password = env.APP_PASSWORD;
    if (!password) return undefined;
    const secret = env.AUTH_SECRET || loadAuthSecret(join(dataDir, 'auth-secret'));
    return new AuthService({ password, secret });
  }

  login(password: unknown, ip: string): LoginResult {
    const now = this.now();
    const recent = (this.fails.get(ip) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.maxFails) {
      this.fails.set(ip, recent);
      const mins = Math.ceil((this.windowMs - (now - recent[0]!)) / 60_000);
      return { ok: false, status: 429, error: `비밀번호를 너무 많이 틀렸어요. ${mins}분 뒤에 다시 해주세요` };
    }
    const given = typeof password === 'string' ? password.slice(0, 1_000) : '';
    // 길이와 상관없이 같은 시간에 비교
    if (!timingSafeEqual(sha256(given), this.passwordHash)) {
      recent.push(now);
      this.fails.set(ip, recent);
      this.prune(now);
      return { ok: false, status: 401, error: '비밀번호가 틀렸어요' };
    }
    this.fails.delete(ip);
    return { ok: true, token: this.issue() };
  }

  issue(): string {
    const iat = this.now();
    const payload = b64(JSON.stringify({ iat, exp: iat + this.ttlMs }));
    return `${payload}.${this.sign(payload)}`;
  }

  verify(token: string | undefined): boolean {
    if (!token) return false;
    const [payload, sig] = token.split('.');
    if (!payload || !sig) return false;
    const expected = Buffer.from(this.sign(payload));
    const given = Buffer.from(sig);
    if (given.length !== expected.length || !timingSafeEqual(given, expected)) return false;
    try {
      const { exp } = JSON.parse(Buffer.from(payload, 'base64url').toString()) as { exp?: number };
      return typeof exp === 'number' && exp > this.now();
    } catch {
      return false;
    }
  }

  private sign(payload: string): string {
    return createHmac('sha256', this.key).update(payload).digest('base64url');
  }

  /** 오래된 실패 기록 정리 (메모리가 계속 늘지 않게) */
  private prune(now: number) {
    if (this.fails.size < 1_000) return;
    for (const [ip, times] of this.fails) {
      if (times.every((t) => now - t >= this.windowMs)) this.fails.delete(ip);
    }
  }
}

/** 서명 키: 파일에 있으면 읽고, 없으면 새로 만들어 저장 */
export function loadAuthSecret(file: string): string {
  try {
    const s = readFileSync(file, 'utf8').trim();
    if (s) return s;
  } catch {
    // 없으면 새로 만듦
  }
  const secret = randomBytes(32).toString('hex');
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, secret, { mode: 0o600 });
  return secret;
}

const PUBLIC = new Set(['/api/login', '/api/health']);

function tokenOf(req: FastifyRequest, path: string): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim();
  // 브라우저 WebSocket은 헤더를 못 붙여서 주소에 토큰
  if (path === '/ws') return (req.query as { token?: string } | undefined)?.token;
  return undefined;
}

/** /api/login + /api/*·/ws 보호. auth가 없으면 로그인 없이 동작 (로컬 개발) */
export function registerAuth(app: FastifyInstance, auth: AuthService | undefined) {
  app.post<{ Body: { password?: unknown } | null }>('/api/login', async (req, reply) => {
    if (!auth) return { token: '' };
    const result = auth.login(req.body?.password, req.ip);
    if (!result.ok) return reply.code(result.status).send({ error: result.error });
    return { token: result.token };
  });

  if (!auth) return;
  app.addHook('onRequest', async (req, reply) => {
    // 주소와 찾은 라우트 둘 다 확인
    const raw = req.url.split('?')[0]!;
    const path = req.routeOptions.url ?? raw;
    if (!(raw.startsWith('/api/') || path.startsWith('/api/') || path === '/ws') || PUBLIC.has(path)) return;
    if (auth.verify(tokenOf(req, path))) return;
    return reply.code(401).send({ error: '로그인이 필요해요' });
  });
}
