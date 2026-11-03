import { useState, type FormEvent } from 'react';
import { api } from '../lib/api';
import { loggedIn } from '../lib/auth';
import { useTheme } from '../lib/theme';

/** 비밀번호 로그인 (서버에 APP_PASSWORD가 있을 때만) */
export function Login() {
  useTheme();
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!password || busy) return;
    setBusy(true);
    setError('');
    try {
      const { token } = await api.login(password);
      loggedIn(token);
    } catch (err) {
      setError((err as Error).message);
      setPassword('');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-dvh max-w-[480px] flex-col px-6 pb-[calc(env(safe-area-inset-bottom)+24px)] pt-[calc(env(safe-area-inset-top)+72px)]">
      <img src="/icon.svg" alt="" className="mb-6 h-14 w-14 rounded-2xl" />
      <h1 className="text-[26px] font-bold leading-snug">
        비밀번호를
        <br />
        입력해주세요
      </h1>
      <p className="mt-2 text-sm text-sub">STOCK 모의투자는 나만 쓰는 앱이에요.</p>

      <form onSubmit={submit} className="mt-10 flex flex-1 flex-col">
        <input
          type="password"
          autoFocus
          autoComplete="current-password"
          value={password}
          placeholder="비밀번호"
          aria-label="비밀번호"
          onChange={(e) => {
            setPassword(e.target.value);
            setError('');
          }}
          className="w-full rounded-xl bg-card px-4 py-4 text-lg font-semibold outline-none placeholder:font-normal placeholder:text-sub"
        />
        {error && <p className="mt-3 text-sm font-medium text-up">{error}</p>}
        <button
          type="submit"
          disabled={!password || busy}
          className="mt-auto w-full rounded-2xl bg-brand py-4 font-bold text-white disabled:opacity-40"
        >
          {busy ? '확인 중…' : '로그인'}
        </button>
      </form>
    </div>
  );
}
