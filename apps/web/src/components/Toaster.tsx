import { useToasts } from '../lib/toast';

export function Toaster() {
  const toasts = useToasts();
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-[calc(env(safe-area-inset-bottom)+84px)] z-50 flex flex-col items-center gap-2 px-4">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`max-w-[440px] rounded-2xl px-4 py-3 text-sm font-medium text-white shadow-lg ${t.tone === 'error' ? 'bg-[#f04452]' : 'bg-[#333d4b]'}`}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
