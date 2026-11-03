import type { DataStatus, SourceStatus } from '@stock/shared';
import { useEffect, useState } from 'react';
import { api } from './api';

const NAMES: Record<string, string> = { naver: '네이버', yahoo: '야후 파이낸스', mock: '가짜 시세' };

export function sourceName(s: SourceStatus): string {
  const name = NAMES[s.source] ?? s.source;
  if (!s.ok) return `${name} (연결 끊김)`;
  return s.delayMinutes > 0 ? `${name} (${s.delayMinutes}분 지연)` : `${name} (실시간)`;
}

/** 홈 상단 뱃지 문구 */
export function statusLabel(s: DataStatus | undefined): string {
  if (!s) return '연결 중';
  if (s.provider === 'mock') return '가짜 시세';
  if (!s.KR.ok && !s.US.ok) return '시세 연결 끊김';
  const delayed = [
    s.KR.delayMinutes > 0 ? `국내 ${s.KR.delayMinutes}분 지연` : null,
    s.US.delayMinutes > 0 ? `미국 ${s.US.delayMinutes}분 지연` : null,
  ].filter(Boolean);
  return delayed.length ? delayed.join(' · ') : '실시간';
}

/** 시세 소스 상태 (30초마다 갱신) */
export function useDataStatus(): DataStatus | undefined {
  const [status, setStatus] = useState<DataStatus>();
  useEffect(() => {
    let alive = true;
    const load = () => api.health().then((s) => alive && setStatus(s), () => undefined);
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);
  return status;
}
