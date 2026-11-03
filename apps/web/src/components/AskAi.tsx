import type { StockInfo } from '@stock/shared';
import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/api';
import { toast } from '../lib/toast';

type Template = 'weekly' | 'stock' | 'habits';

const TEMPLATES: { id: Template; title: string }[] = [
  { id: 'weekly', title: '이번 주 매매 복기' },
  { id: 'stock', title: '이 종목 왜 손해 봤을까' },
  { id: 'habits', title: '내 매매 습관 분석' },
];

const APPS = [
  { name: 'Claude', url: 'https://claude.ai/new' },
  { name: 'ChatGPT', url: 'https://chatgpt.com/' },
];

async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await apiFetch(path, init);
  const data = (await res.json().catch(() => ({}))) as T & { error?: string };
  if (!res.ok) throw new Error(data.error ?? `요청 실패 (${res.status})`);
  return data;
}

/** 클립보드 복사. 안 되면 false (http 주소 등) */
async function copyText(text: string, fallback: HTMLTextAreaElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    if (!fallback) return false;
    fallback.focus();
    fallback.select();
    try {
      return document.execCommand('copy');
    } catch {
      return false;
    }
  }
}

/**
 * AI에게 물어보기: 내 매매 기록·일지·통계를 질문으로 정리해 복사 → Claude·ChatGPT 앱에 붙여넣기.
 * 서버에 AI API 키가 있으면 "앱에서 바로 받기"도 보임.
 * code를 주면 '이 종목' 질문의 기본 종목으로 씀.
 */
export function AskAi({ code: initialCode }: { code?: string } = {}) {
  const [template, setTemplate] = useState<Template>(initialCode ? 'stock' : 'weekly');
  const [code, setCode] = useState(initialCode ?? '');
  const [stocks, setStocks] = useState<StockInfo[]>([]);
  const [ai, setAi] = useState<{ enabled: boolean; provider: string | null }>({ enabled: false, provider: null });
  const [prompt, setPrompt] = useState<string>();
  const [showPrompt, setShowPrompt] = useState(false);
  const [busy, setBusy] = useState<'copy' | 'ai' | null>(null);
  const [answer, setAnswer] = useState<string>();
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    call<{ enabled: boolean; provider: string | null }>('/api/ai').then(setAi, () => undefined);
    // 매매한 종목만 고를 수 있게
    call<{ stocks: Record<string, StockInfo> }>('/api/fills?limit=500').then(
      (d) => {
        const list = Object.values(d.stocks).sort((a, b) => a.nameKo.localeCompare(b.nameKo, 'ko'));
        setStocks(list);
        setCode((c) => c || list[0]?.code || '');
      },
      () => undefined,
    );
  }, []);

  const needsCode = template === 'stock';
  const ready = !needsCode || Boolean(code);
  const query = `template=${template}${needsCode ? `&code=${encodeURIComponent(code)}` : ''}`;

  const pick = (t: Template) => {
    setTemplate(t);
    setPrompt(undefined);
    setShowPrompt(false);
    setAnswer(undefined);
  };

  const copy = async () => {
    setBusy('copy');
    try {
      const { prompt: text } = await call<{ prompt: string }>(`/api/ai/prompt?${query}`);
      setPrompt(text);
      // 복사 실패 대비: 질문 칸을 먼저 그려 둠
      setShowPrompt(true);
      await new Promise((r) => requestAnimationFrame(r));
      if (await copyText(text, area.current)) {
        toast('질문을 복사했어요. AI 앱에 붙여넣어 주세요');
        setShowPrompt(false);
      } else toast('자동 복사가 안 돼요. 아래 질문을 길게 눌러 복사해 주세요', 'error');
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  const askInApp = async () => {
    setBusy('ai');
    setAnswer(undefined);
    try {
      const { text } = await call<{ text: string }>('/api/ai/report', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ template, ...(needsCode ? { code } : {}) }),
      });
      setAnswer(text);
    } catch (e) {
      toast((e as Error).message, 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="rounded-2xl bg-card p-5">
      <h2 className="text-[17px] font-bold">AI에게 물어보기</h2>
      <p className="mt-0.5 text-sm text-sub">내 매매 기록·메모·통계를 질문 하나로 정리해요</p>

      <div className="no-scrollbar -mx-5 mt-3 flex gap-1.5 overflow-x-auto px-5">
        {TEMPLATES.map((t) => (
          <button
            key={t.id}
            onClick={() => pick(t.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-[13px] font-medium ${template === t.id ? 'bg-ink text-card' : 'bg-soft text-sub'}`}
          >
            {t.title}
          </button>
        ))}
      </div>

      {needsCode &&
        (stocks.length > 0 ? (
          <select
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              setPrompt(undefined);
              setAnswer(undefined);
            }}
            className="mt-3 w-full rounded-xl bg-soft px-3 py-2.5 text-sm font-medium outline-none"
            aria-label="종목 고르기"
          >
            {stocks.map((s) => (
              <option key={s.code} value={s.code}>
                {s.nameKo} ({s.code})
              </option>
            ))}
          </select>
        ) : (
          <p className="mt-3 text-sm text-sub">아직 사고판 종목이 없어요</p>
        ))}

      <button
        disabled={!ready || busy !== null}
        onClick={copy}
        className="mt-3 w-full rounded-xl bg-brand py-3 font-semibold text-white disabled:opacity-40"
      >
        {busy === 'copy' ? '정리하는 중…' : '질문 복사하기'}
      </button>

      <div className="mt-2 flex items-center gap-2 text-[13px] text-sub">
        <span className="flex-1">복사한 질문을 AI 앱에 붙여넣으세요</span>
        {APPS.map((a) => (
          <a key={a.name} href={a.url} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-soft px-2.5 py-1 font-medium text-ink">
            {a.name} 열기
          </a>
        ))}
      </div>

      {prompt && (
        <button onClick={() => setShowPrompt((v) => !v)} className="mt-2 text-[13px] font-medium text-brand">
          {showPrompt ? '질문 접기' : '질문 보기'}
        </button>
      )}
      {prompt && showPrompt && (
        <textarea
          ref={area}
          readOnly
          value={prompt}
          onFocus={(e) => e.currentTarget.select()}
          rows={10}
          className="mt-2 w-full resize-none rounded-xl bg-soft p-3 text-[13px] leading-relaxed outline-none"
        />
      )}

      {ai.enabled && (
        <div className="mt-4 border-t border-line pt-4">
          <button
            disabled={!ready || busy !== null}
            onClick={askInApp}
            className="w-full rounded-xl bg-soft py-3 font-semibold text-ink disabled:opacity-40"
          >
            {busy === 'ai' ? 'AI가 답을 쓰고 있어요…' : '앱에서 바로 받기'}
          </button>
          <p className="mt-1.5 text-center text-xs text-sub">AI API 사용량만큼 비용이 들어요</p>
          {answer && <div className="mt-3 whitespace-pre-wrap rounded-xl bg-soft p-4 text-sm leading-relaxed">{answer}</div>}
        </div>
      )}

      <p className="mt-3 text-xs text-sub">모의투자 기록을 정리한 참고용이에요. 투자 조언이 아니에요.</p>
    </section>
  );
}
