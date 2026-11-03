import type { FastifyInstance } from 'fastify';

/**
 * 서버 없이 쓸 때: 서버의 라우트 등록 코드를 그대로 받아서 앱 안에서 처리하는 작은 라우터.
 * 서버 라우트가 쓰는 Fastify 기능만 흉내 냄 (get/post/put/patch/delete, 오류 처리, onResponse·onClose 훅)
 */

interface Req {
  method: string;
  url: string;
  params: Record<string, string>;
  query: Record<string, string>;
  body: unknown;
  headers: Record<string, string>;
}

class Reply {
  statusCode = 200;
  sent = false;
  payload: unknown;
  readonly headers: Record<string, string> = {};
  code(n: number) {
    this.statusCode = n;
    return this;
  }
  status(n: number) {
    return this.code(n);
  }
  header(k: string, v: string) {
    this.headers[k.toLowerCase()] = v;
    return this;
  }
  send(p?: unknown) {
    this.payload = p;
    this.sent = true;
    return this;
  }
}

type Handler = (req: Req, reply: Reply) => unknown;
type ErrorHandler = (err: Error, req: Req, reply: Reply) => unknown;

interface Route {
  method: string;
  re: RegExp;
  keys: string[];
  handler: Handler;
}

export class LocalRouter {
  private routes: Route[] = [];
  private errorHandler: ErrorHandler | undefined;
  private onResponse: ((req: Req, reply: Reply) => unknown)[] = [];
  private onClose: (() => unknown)[] = [];
  readonly log = { error: (e: unknown) => console.error(e), info: () => undefined, warn: () => undefined };

  private add(method: string, path: string, a: unknown, b?: unknown) {
    const handler = (typeof a === 'function' ? a : b) as Handler;
    const keys: string[] = [];
    const re = new RegExp(
      '^' +
        path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/:(\w+)/g, (_m, k: string) => {
          keys.push(k);
          return '([^/]+)';
        }) +
        '$',
    );
    this.routes.push({ method, re, keys, handler });
  }

  get = (path: string, a: unknown, b?: unknown) => this.add('GET', path, a, b);
  post = (path: string, a: unknown, b?: unknown) => this.add('POST', path, a, b);
  put = (path: string, a: unknown, b?: unknown) => this.add('PUT', path, a, b);
  patch = (path: string, a: unknown, b?: unknown) => this.add('PATCH', path, a, b);
  delete = (path: string, a: unknown, b?: unknown) => this.add('DELETE', path, a, b);

  setErrorHandler(h: ErrorHandler) {
    this.errorHandler = h;
  }

  addHook(name: string, fn: (...args: never[]) => unknown) {
    if (name === 'onResponse') this.onResponse.push(fn as (req: Req, reply: Reply) => unknown);
    else if (name === 'onClose') this.onClose.push(fn as () => unknown);
  }

  async close() {
    for (const fn of this.onClose) await fn();
  }

  /** 서버 라우트 등록 함수에 넘길 때 (타입만 맞춤) */
  asFastify(): FastifyInstance {
    return this as unknown as FastifyInstance;
  }

  /** fetch 대신: 요청 → 응답 */
  async handle(path: string, init: RequestInit = {}): Promise<Response> {
    const method = (init.method ?? 'GET').toUpperCase();
    const url = new URL(path, 'http://local');
    const query = Object.fromEntries(url.searchParams);
    let body: unknown;
    if (typeof init.body === 'string' && init.body) {
      try {
        body = JSON.parse(init.body);
      } catch {
        body = init.body;
      }
    }
    const reply = new Reply();
    const req: Req = { method, url: url.pathname + url.search, params: {}, query, body, headers: {} };

    const route = this.routes.find((r) => r.method === method && r.re.test(url.pathname));
    if (!route) {
      reply.code(404).send({ error: '서버 없이 쓰는 모드에서는 지원하지 않는 기능이에요' });
    } else {
      const m = route.re.exec(url.pathname)!;
      route.keys.forEach((k, i) => (req.params[k] = decodeURIComponent(m[i + 1]!)));
      try {
        const result = await route.handler(req, reply);
        if (!reply.sent) reply.send(result);
      } catch (e) {
        reply.sent = false;
        if (this.errorHandler) await this.errorHandler(e as Error, req, reply);
        if (!reply.sent) reply.code(500).send({ error: (e as Error).message });
      }
    }
    for (const fn of this.onResponse) void Promise.resolve(fn(req, reply)).catch(() => undefined);

    const payload = reply.payload;
    const text = payload === undefined || payload === null ? '' : typeof payload === 'string' ? payload : JSON.stringify(payload);
    const isJson = payload !== undefined && typeof payload !== 'string';
    return new Response(reply.statusCode === 204 ? null : text, {
      status: reply.statusCode,
      headers: { 'content-type': isJson ? 'application/json' : 'text/plain; charset=utf-8', ...reply.headers },
    });
  }
}
