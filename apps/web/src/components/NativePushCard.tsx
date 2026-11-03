import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { disableNativePush, enableNativePush, nativePushState, type NativePushState } from '../lib/native';
import { toast } from '../lib/toast';
import { Card, SectionTitle } from './Layout';

const STATE_TEXT: Record<NativePushState, string> = {
  on: '이 폰에서 알림을 받고 있어요',
  off: '꺼져 있어요',
  denied: '알림이 차단돼 있어요. 폰 설정 → 앱 → STOCK → 알림에서 허용해주세요',
  'no-firebase': '이 앱은 푸시 없이 빌드됐어요 (google-services.json 필요, docs/APK.md 참고). 앱이 켜져 있을 땐 화면 알림으로 와요',
  'server-off': '서버에 앱 푸시(Firebase) 설정이 없어요. 서버에 FIREBASE_SERVICE_ACCOUNT를 넣어주세요 (docs/APK.md 참고)',
};

/** 안드로이드 앱에서 보이는 폰 알림 카드 (FCM) */
export function NativePushCard() {
  const [state, setState] = useState<NativePushState>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    void nativePushState().then(setState);
  }, []);

  const run = async (fn: () => Promise<unknown>, done: string) => {
    setBusy(true);
    try {
      await fn();
      toast(done);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setState(await nativePushState());
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <SectionTitle>폰 알림</SectionTitle>
      <p className="text-sm text-sub">{state ? STATE_TEXT[state] : '확인 중…'}</p>
      {state === 'off' && (
        <button disabled={busy} onClick={() => run(enableNativePush, '알림을 켰어요')} className="w-full rounded-xl bg-brand py-3 font-semibold text-white">
          알림 켜기
        </button>
      )}
      {state === 'on' && (
        <div className="flex gap-2">
          <button disabled={busy} onClick={() => run(() => api.pushTest(), '테스트 알림을 보냈어요')} className="flex-1 rounded-xl bg-soft py-3 font-semibold">
            테스트 보내기
          </button>
          <button disabled={busy} onClick={() => run(disableNativePush, '알림을 껐어요')} className="flex-1 rounded-xl bg-soft py-3 font-semibold text-sub">
            끄기
          </button>
        </div>
      )}
      <p className="text-xs text-sub">가격 알림과, 걸어둔 주문이 나중에 체결될 때 알려드려요.</p>
    </Card>
  );
}
