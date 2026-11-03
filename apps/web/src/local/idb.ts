// 로컬 DB 바이트를 IndexedDB에 저장. 막혀 있으면(사생활 보호 모드 등) 메모리에만 둠

const STORE = 'files';

export type ByteStore = {
  load(): Promise<Uint8Array | null>;
  save(bytes: Uint8Array): Promise<void>;
};

function openIdb(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(dbName, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error('IndexedDB blocked'));
  });
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** 메모리에만 두는 저장소 (앱을 닫으면 사라짐) */
export function memoryStore(): ByteStore {
  let saved: Uint8Array | null = null;
  return {
    async load() {
      return saved;
    },
    async save(bytes) {
      saved = bytes;
    },
  };
}

/** IndexedDB 한 칸(name)에 DB 파일 통째로 저장. IndexedDB를 못 쓰면 메모리로 대신함 */
export function idbStore(name: string, dbName = 'stock-local'): ByteStore {
  const fallback = memoryStore();
  let idb: Promise<IDBDatabase | null> | undefined;
  const conn = () =>
    (idb ??= (async () => {
      try {
        if (typeof indexedDB === 'undefined') return null;
        return await openIdb(dbName);
      } catch (e) {
        console.warn('IndexedDB를 못 써서 메모리에만 저장해요', e);
        return null;
      }
    })());

  return {
    async load() {
      const db = await conn();
      if (!db) return fallback.load();
      try {
        const v = await request(db.transaction(STORE, 'readonly').objectStore(STORE).get(name));
        return v instanceof Uint8Array ? v : v instanceof ArrayBuffer ? new Uint8Array(v) : null;
      } catch (e) {
        console.warn('IndexedDB 읽기 실패', e);
        return fallback.load();
      }
    },
    async save(bytes) {
      const db = await conn();
      if (!db) return fallback.save(bytes);
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put(bytes, name);
        await new Promise<void>((resolve, reject) => {
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
          tx.onabort = () => reject(tx.error ?? new Error('IndexedDB aborted'));
        });
      } catch (e) {
        console.warn('IndexedDB 저장 실패, 메모리에 둠', e);
        await fallback.save(bytes);
      }
    },
  };
}
