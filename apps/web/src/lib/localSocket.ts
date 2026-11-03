import { isLocalMock } from './server';

/**
 * 서버 없이 쓸 때 WebSocket 대신 쓰는 앱 안 연결 (live.ts가 쓰는 부분만 같은 모양).
 * 서버 코드는 처음 연결할 때 불러옴
 */
export class LocalSocket {
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  private client: { receive(raw: string): void; close(): void } | undefined;

  constructor() {
    void import('../local/backend')
      .then(async (b) => {
        b.startLocal(isLocalMock());
        this.client = await b.localConnect((m) => {
          if (this.readyState === 1) this.onmessage?.({ data: JSON.stringify(m) });
        });
        if (this.readyState !== 0) return this.client.close();
        this.readyState = 1;
        this.onopen?.();
      })
      .catch((e: unknown) => {
        console.error(e);
        this.close();
      });
  }

  send(raw: string) {
    this.client?.receive(raw);
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.client?.close();
    // 실제 WebSocket처럼 닫힘 알림은 나중에
    setTimeout(() => this.onclose?.(), 0);
  }
}
