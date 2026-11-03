import { useState } from 'react';
import { Card, SubPage } from '../components/Layout';
import { LOCAL, isLocalMode, normalizeServer, saveServer, serverBase, testServer } from '../lib/server';
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

/** 서버 없이 쓰기: 시세는 폰이 직접 받고, 계좌는 이 기기에만 저장 */
function LocalCard() {
  const on = isLocalMode();
  return (
    <Card className="space-y-3">
      <p className="font-semibold">서버 없이 쓰기 {on && <span className="ml-1 text-sm text-brand">사용 중</span>}</p>
      <ul className="list-disc space-y-1 pl-5 text-sm text-sub">
        <li>서버·카드 없이 이 폰만으로 써요</li>
        <li>지정가 주문·가격 알림은 앱을 열 때 확인해요 (꺼져 있던 동안 가격이 닿았으면 그때 가격으로 체결)</li>
        <li>계좌는 이 기기에만 저장돼요. 앱을 지우면 같이 지워져요</li>
      </ul>
      {!on && (
        <button onClick={() => saveServer(LOCAL)} className="w-full rounded-xl bg-soft py-3 font-semibold">
          서버 없이 시작하기
        </button>
      )}
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
        <p className="mt-1 text-sub">서버 없이 바로 쓰거나, 내 서버에 연결해요</p>
      </div>
      <LocalCard />
      <ServerForm />
    </div>
  );
}

/** 더보기 → 서버 주소 */
export function ServerSetup() {
  return (
    <SubPage title="서버 주소">
      <LocalCard />
      <ServerForm />
      <button onClick={() => saveServer('')} className="w-full py-3 text-sm text-sub">
        저장된 주소 지우기
      </button>
    </SubPage>
  );
}
