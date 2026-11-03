import { useState } from 'react';
import { Card, SubPage } from '../components/Layout';
import { normalizeServer, saveServer, serverBase, testServer } from '../lib/server';
import { useTheme } from '../lib/theme';

/** 서버 주소 입력 → /api/health로 확인 → 저장 */
function ServerForm() {
  const [text, setText] = useState(serverBase());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const connect = async () => {
    const url = normalizeServer(text);
    setBusy(true);
    setError('');
    try {
      await testServer(url);
      saveServer(url);
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  };

  return (
    <Card className="space-y-3">
      <p className="font-semibold">서버 주소</p>
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => e.key === 'Enter' && void connect()}
        type="url"
        inputMode="url"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder="https://my-stock.duckdns.org"
        className="w-full rounded-xl bg-soft px-4 py-3 outline-none placeholder:text-sub"
      />
      {error && <p className="text-sm text-up">{error}</p>}
      <button disabled={busy || !text.trim()} onClick={() => void connect()} className="w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-50">
        {busy ? '확인 중…' : '연결하기'}
      </button>
      <p className="text-xs text-sub">내가 띄운 STOCK 서버 주소를 넣어주세요. 집 PC라면 http://192.168.0.10:8787 처럼 넣어도 돼요.</p>
    </Card>
  );
}

/** 앱 처음 켰을 때 (서버 주소가 없을 때) */
export function ServerSetupFirst() {
  useTheme();
  return (
    <div className="mx-auto min-h-dvh max-w-[480px] space-y-4 px-4 pt-[calc(env(safe-area-inset-top)+48px)]">
      <div className="px-1">
        <h1 className="text-[24px] font-bold">STOCK 시작하기</h1>
        <p className="mt-1 text-sub">연결할 서버 주소를 알려주세요</p>
      </div>
      <ServerForm />
    </div>
  );
}

/** 더보기 → 서버 주소 */
export function ServerSetup() {
  return (
    <SubPage title="서버 주소">
      <ServerForm />
      <button onClick={() => saveServer('')} className="w-full py-3 text-sm text-sub">
        저장된 주소 지우기
      </button>
    </SubPage>
  );
}
