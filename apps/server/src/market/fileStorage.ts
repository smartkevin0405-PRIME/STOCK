import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { TextStorage } from './directoryStore';

/** 파일 하나에 읽고 쓰기 (서버용) */
export function fileStorage(file: string): TextStorage {
  return {
    read: () => readFile(file, 'utf8').catch(() => null),
    write: async (text) => {
      await mkdir(dirname(file), { recursive: true });
      await writeFile(file, text);
    },
  };
}
