import type { StockInfo } from '@stock/shared';
import type { StockDirectory } from './directory';

/** 글 하나를 읽고 쓰는 저장소 (없으면 read가 null) */
export interface TextStorage {
  read(): Promise<string | null>;
  write(text: string): Promise<void>;
}

interface Saved {
  updatedAt: number;
  stocks: StockInfo[];
}

export interface DirectoryStoreOptions {
  directory: StockDirectory;
  /** 받아둔 목록을 저장할 곳 (재시작 때 바로 사용). 서버는 파일, 앱은 기기 저장소 */
  storage: TextStorage;
  fetchAll: () => Promise<StockInfo[]>;
  /** 이보다 오래되면 새로 받음 */
  maxAgeMs?: number;
  /** 이보다 적게 받으면 뭔가 잘못된 걸로 보고 무시 */
  minCount?: number;
  log?: (msg: string) => void;
  now?: () => number;
}

/** 전체 종목 목록: 파일에서 읽고, 하루 지나면 네이버에서 새로 받음 */
export class DirectoryStore {
  private updatedAt = 0;
  private refreshing: Promise<void> | undefined;
  private timer: ReturnType<typeof setInterval> | undefined;

  constructor(private readonly o: DirectoryStoreOptions) {}

  async load(): Promise<void> {
    try {
      const text = await this.o.storage.read();
      if (!text) return;
      const saved = JSON.parse(text) as Saved;
      if (Array.isArray(saved.stocks) && saved.stocks.length >= (this.o.minCount ?? 1)) {
        this.o.directory.replace(saved.stocks);
        this.updatedAt = saved.updatedAt;
        this.o.log?.(`종목 목록 ${saved.stocks.length}개 불러옴 (파일)`);
      }
    } catch {
      // 파일 없으면 기본 목록으로 시작
    }
  }

  isStale(): boolean {
    return (this.o.now ?? Date.now)() - this.updatedAt > (this.o.maxAgeMs ?? 24 * 3_600_000);
  }

  refresh(): Promise<void> {
    this.refreshing ??= (async () => {
      try {
        const stocks = await this.o.fetchAll();
        if (stocks.length < (this.o.minCount ?? 1)) throw new Error(`종목이 너무 적어요 (${stocks.length}개)`);
        this.o.directory.replace(stocks);
        this.updatedAt = (this.o.now ?? Date.now)();
        await this.o.storage.write(JSON.stringify({ updatedAt: this.updatedAt, stocks } satisfies Saved));
        this.o.log?.(`종목 목록 ${stocks.length}개 갱신`);
      } finally {
        this.refreshing = undefined;
      }
    })();
    return this.refreshing;
  }

  /** 파일 읽고, 오래됐으면 백그라운드로 갱신. 1시간마다 확인 */
  async start(): Promise<void> {
    await this.load();
    const check = () => {
      if (this.isStale()) this.refresh().catch((e: Error) => this.o.log?.(`종목 목록 갱신 실패: ${e.message}`));
    };
    check();
    this.timer = setInterval(check, 3_600_000);
  }

  stop(): void {
    clearInterval(this.timer);
  }
}
