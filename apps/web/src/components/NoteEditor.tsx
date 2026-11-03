import type { JournalNote } from '@stock/shared';

/** 자주 쓰는 태그 (직접 입력도 가능) */
export const NOTE_TAGS = ['분할매수', '추격매수', '물타기', '손절', '익절', '실적', '뉴스', '차트', '장기투자', '충동'];

/** 매매 이유 메모 + 태그 고르기 */
export function NoteEditor({ value, onChange }: { value: JournalNote; onChange: (v: JournalNote) => void }) {
  const toggle = (tag: string) =>
    onChange({ ...value, tags: value.tags.includes(tag) ? value.tags.filter((t) => t !== tag) : [...value.tags, tag] });
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-1.5">
        {NOTE_TAGS.map((tag) => (
          <button
            key={tag}
            type="button"
            onClick={() => toggle(tag)}
            className={`rounded-full px-2.5 py-1 text-[13px] font-medium ${value.tags.includes(tag) ? 'bg-brand text-white' : 'bg-soft text-sub'}`}
          >
            #{tag}
          </button>
        ))}
      </div>
      <textarea
        value={value.text}
        onChange={(e) => onChange({ ...value, text: e.target.value })}
        placeholder="왜 사고/파나요? (예: 실적 발표 기대, 20일선 지지)"
        rows={2}
        maxLength={2000}
        className="w-full resize-none rounded-xl bg-soft px-3 py-2 text-sm outline-none placeholder:text-sub"
      />
    </div>
  );
}
