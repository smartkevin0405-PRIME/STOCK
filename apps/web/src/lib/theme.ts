import { useEffect, useSyncExternalStore } from 'react';
import { useStored } from './storage';

export type ThemeSetting = 'system' | 'light' | 'dark';

const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : undefined;

function useSystemDark(): boolean {
  return useSyncExternalStore(
    (l) => {
      media?.addEventListener('change', l);
      return () => media?.removeEventListener('change', l);
    },
    () => media?.matches ?? false,
  );
}

/** 테마 설정 + 실제 적용된 다크 여부 */
export function useTheme() {
  const [setting, setSetting] = useStored<ThemeSetting>('theme', 'system');
  const systemDark = useSystemDark();
  const dark = setting === 'dark' || (setting === 'system' && systemDark);

  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
  }, [dark]);

  return { setting, setSetting, dark };
}
