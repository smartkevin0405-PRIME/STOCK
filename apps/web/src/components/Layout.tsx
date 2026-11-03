import type { ReactNode } from 'react';
import { NavLink, useNavigate } from 'react-router';
import { BackIcon, BookIcon, HeartIcon, HomeIcon, MenuIcon, SearchIcon } from './Icons';

const TABS = [
  { to: '/', label: '홈', Icon: HomeIcon },
  { to: '/watchlist', label: '관심', Icon: HeartIcon },
  { to: '/discover', label: '발견', Icon: SearchIcon },
  { to: '/journal', label: '일지', Icon: BookIcon },
  { to: '/more', label: '더보기', Icon: MenuIcon },
];

export function TabBar() {
  return (
    <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-card/95 backdrop-blur pb-[env(safe-area-inset-bottom)]">
      <div className="mx-auto flex max-w-[480px]">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === '/'}
            className={({ isActive }) =>
              `flex flex-1 flex-col items-center gap-0.5 py-2 text-[11px] ${isActive ? 'text-ink' : 'text-sub'}`
            }
          >
            <Icon width={22} height={22} />
            {label}
          </NavLink>
        ))}
      </div>
    </nav>
  );
}

/** 탭 화면 공통 틀 */
export function Page({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  return (
    <div className="mx-auto min-h-dvh max-w-[480px] pb-24">
      <header className="sticky top-0 z-10 flex items-center justify-between bg-bg/95 px-5 pb-2 pt-[calc(env(safe-area-inset-top)+14px)] backdrop-blur">
        <h1 className="text-[22px] font-bold">{title}</h1>
        {right}
      </header>
      <main className="space-y-3 px-4">{children}</main>
    </div>
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-2xl bg-card p-5 ${className}`}>{children}</section>;
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between">
      <h2 className="text-[17px] font-bold">{children}</h2>
      {right}
    </div>
  );
}

export function Empty({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-1 py-8 text-center">
      <p className="font-semibold">{title}</p>
      {desc && <p className="text-sm text-sub">{desc}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/** 아직 안 만든 기능 표시 */
export function Soon({ milestone }: { milestone: string }) {
  return <span className="rounded-md bg-soft px-1.5 py-0.5 text-[11px] font-medium text-sub">{milestone}</span>;
}

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  size = 'md',
}: {
  options: readonly { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  size?: 'sm' | 'md';
}) {
  return (
    <div className="flex gap-1 rounded-xl bg-soft p-1">
      {options.map((o) => (
        <button
          key={o.value}
          onClick={() => onChange(o.value)}
          className={`flex-1 rounded-lg font-semibold transition ${size === 'sm' ? 'py-1 text-[13px]' : 'py-2 text-sm'} ${
            value === o.value ? 'bg-card text-ink shadow-sm' : 'text-sub'
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/** 뒤로가기 있는 하위 화면 틀 */
export function SubPage({ title, right, children }: { title: string; right?: ReactNode; children: ReactNode }) {
  const navigate = useNavigate();
  return (
    <div className="mx-auto min-h-dvh max-w-[480px] pb-16">
      <header className="sticky top-0 z-10 flex items-center gap-1 bg-bg/95 px-2 pb-2 pt-[calc(env(safe-area-inset-top)+10px)] backdrop-blur">
        <button onClick={() => navigate(-1)} className="p-2" aria-label="뒤로">
          <BackIcon />
        </button>
        <h1 className="flex-1 text-lg font-bold">{title}</h1>
        {right}
      </header>
      <main className="space-y-3 px-4">{children}</main>
    </div>
  );
}
