import { useEffect, useRef, useState } from 'react';
import {
  CalendarRange,
  ChevronDown,
  Eye,
  EyeOff,
  HandCoins,
  Landmark,
  LayoutDashboard,
  LogOut,
  ShieldCheck,
  Vault,
} from 'lucide-react';
import { APP_CONFIG } from '../firebase-config.js';
import { LOGO, useCompanyName } from '../lib/brand.js';
import { useAuth } from '../context/AuthContext.jsx';
import { usePrivacy } from '../context/PrivacyContext.jsx';
import { ROLE_LABEL, ROUTES, can } from '../lib/roles.js';
import { Badge, cx } from './ui.jsx';

export const ROUTE_ICON = {
  dashboard: LayoutDashboard,
  cash: Vault,
  bank: Landmark,
  partners: HandCoins,
  planner: CalendarRange,
  admin: ShieldCheck,
};

function Avatar({ me, size = 'h-8 w-8' }) {
  const initial = (me?.name || '?').trim().charAt(0).toUpperCase();
  return me?.avatarUrl ? (
    <img src={me.avatarUrl} alt="" className={cx(size, 'rounded-full object-cover')} />
  ) : (
    <span className={cx(size, 'grid place-items-center rounded-full bg-gradient-to-br from-sapphire-500 to-orchid-600 text-white text-sm font-semibold')}>{initial}</span>
  );
}

function UserMenu() {
  const { me, member, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  useEffect(() => {
    const h = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);
  return (
    <div className="relative" ref={ref}>
      <button type="button" onClick={() => setOpen((o) => !o)} className="flex items-center gap-2 rounded-full sm:rounded-lg sm:pl-1 sm:pr-2 sm:py-1 hover:bg-slate-100">
        <Avatar me={me} />
        <span className="hidden md:block text-left leading-tight">
          <span className="block text-sm font-medium text-slate-800 max-w-[160px] truncate">{me?.name || 'Bạn'}</span>
          <span className="block text-[11px] text-slate-500">{ROLE_LABEL[member?.role]}</span>
        </span>
        <ChevronDown className="hidden md:block h-4 w-4 text-slate-400" />
      </button>
      {open && (
        <div className="absolute right-0 mt-2 w-64 rounded-xl border border-slate-200 bg-white p-3 shadow-xl z-50">
          <p className="text-sm font-semibold text-slate-900 truncate">{me?.name || 'Bạn'}</p>
          <p className="text-xs text-slate-500 truncate">{me?.email}</p>
          <Badge tone="dark" className="mt-2">{ROLE_LABEL[member?.role]}</Badge>
          <button
            type="button"
            onClick={signOut}
            className="mt-3 flex w-full items-center justify-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
          >
            <LogOut className="h-4 w-4" /> Đăng xuất
          </button>
        </div>
      )}
    </div>
  );
}

function PrivacyButton() {
  const { hidden, toggle } = usePrivacy();
  return (
    <button
      type="button"
      onClick={toggle}
      title={hidden ? 'Đang ẩn số tiền — bấm để hiện' : 'Chế độ riêng tư — bấm để ẩn mọi số tiền'}
      className={cx(
        'flex items-center gap-2 h-9 rounded-lg px-2.5 text-sm font-medium transition-colors',
        hidden ? 'bg-ink-900 text-white' : 'text-slate-600 hover:bg-slate-100',
      )}
    >
      {hidden ? <EyeOff className="h-[18px] w-[18px]" /> : <Eye className="h-[18px] w-[18px]" />}
      <span className="hidden sm:inline">{hidden ? 'Đang ẩn số' : 'Riêng tư'}</span>
    </button>
  );
}

export const ROUTE_TONE = {
  dashboard: 'lagoon',
  cash: 'jade',
  bank: 'sapphire',
  partners: 'vermilion',
  planner: 'orchid',
  admin: 'ink',
};
const NAV_DOT = {
  lagoon: 'bg-lagoon-400',
  jade: 'bg-jade-400',
  sapphire: 'bg-sapphire-400',
  vermilion: 'bg-vermilion-400',
  orchid: 'bg-orchid-400',
  ink: 'bg-slate-300',
};
const NAV_ICON = {
  lagoon: 'text-lagoon-400',
  jade: 'text-jade-400',
  sapphire: 'text-sapphire-400',
  vermilion: 'text-vermilion-400',
  orchid: 'text-orchid-400',
  ink: 'text-slate-300',
};
const MOBILE_ACTIVE = {
  lagoon: 'bg-lagoon-600',
  jade: 'bg-jade-600',
  sapphire: 'bg-sapphire-600',
  vermilion: 'bg-vermilion-500',
  orchid: 'bg-orchid-600',
  ink: 'bg-ink-900',
};

export function Layout({ route, navigate, children }) {
  const { role } = useAuth();
  const companyName = useCompanyName();
  const items = ROUTES.filter((r) => can(role, r.perm));

  return (
    <div className="min-h-screen">
      {/* Thanh điều hướng máy tính */}
      <aside className="hidden lg:flex fixed inset-y-0 left-0 z-30 w-64 flex-col bg-gradient-to-b from-ink-900 via-ink-950 to-ink-950 text-white">
        <div className="absolute inset-0 guilloche opacity-60 pointer-events-none" />
        <div className="relative flex items-center gap-3 px-5 h-20">
          <img src={LOGO} alt="" className="h-10 w-10 rounded-xl ring-1 ring-white/15" />
          <div className="leading-tight min-w-0">
            <p className="font-display text-[15px] font-bold truncate">{APP_CONFIG.appName}</p>
            <p className="text-xs text-white/60 truncate">{companyName}</p>
          </div>
        </div>
        <nav className="relative flex-1 px-3 py-2 space-y-1">
          {items.map((r) => {
            const Icon = ROUTE_ICON[r.key];
            const tone = ROUTE_TONE[r.key];
            const active = route === r.key;
            return (
              <button
                type="button"
                key={r.key}
                onClick={() => navigate(r.key)}
                className={cx(
                  'relative flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors',
                  active ? 'bg-white/10 text-white' : 'text-white/65 hover:bg-white/5 hover:text-white',
                )}
              >
                {active && <span className={cx('absolute left-0 top-2 bottom-2 w-1 rounded-r-full', NAV_DOT[tone])} />}
                <Icon className={cx('h-[18px] w-[18px]', active ? NAV_ICON[tone] : '')} />
                {r.label}
              </button>
            );
          })}
        </nav>
        <div className="relative mx-3 mb-4 rounded-xl bg-white/5 px-4 py-3 text-[11px] text-white/55 leading-relaxed ring-1 ring-inset ring-white/10">
          Dữ liệu tối mật · Chỉ người được Chủ doanh nghiệp mời mới xem được.
        </div>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 h-14 sm:h-16 border-b border-slate-200/70 bg-white/80 backdrop-blur">
          <div className="mx-auto flex h-full max-w-[1600px] items-center justify-between gap-3 px-4 sm:px-6">
            <div className="flex items-center gap-2.5 min-w-0 lg:hidden">
              <img src={LOGO} alt="" className="h-8 w-8 rounded-lg" />
              <div className="leading-tight min-w-0">
                <p className="font-display text-sm font-bold text-ink-900 truncate">{APP_CONFIG.appName}</p>
                <p className="text-[11px] text-slate-500 truncate">{companyName}</p>
              </div>
            </div>
            <p className="hidden lg:block text-sm text-slate-500 first-letter:uppercase">
              {new Date().toLocaleDateString('vi-VN', { weekday: 'long', day: '2-digit', month: '2-digit', year: 'numeric' })}
            </p>
            <div className="flex items-center gap-1 sm:gap-2">
              <PrivacyButton />
              <UserMenu />
            </div>
          </div>
        </header>

        <main className="mx-auto max-w-[1600px] px-4 sm:px-6 py-5 sm:py-7 pb-28 lg:pb-10">{children}</main>
      </div>

      {/* Thanh điều hướng điện thoại */}
      <nav
        className="grid lg:hidden fixed bottom-0 inset-x-0 z-30 border-t border-slate-200 bg-white/95 backdrop-blur pb-[env(safe-area-inset-bottom)]"
        style={{ gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}
      >
        {items.map((r) => {
          const Icon = ROUTE_ICON[r.key];
          const active = route === r.key;
          return (
            <button
              type="button"
              key={r.key}
              onClick={() => navigate(r.key)}
              className={cx('flex h-16 flex-col items-center justify-center gap-1 text-[10.5px] font-medium', active ? 'text-ink-900' : 'text-slate-400')}
            >
              <span className={cx('grid h-7 w-11 place-items-center rounded-full transition-colors', active && cx(MOBILE_ACTIVE[ROUTE_TONE[r.key]], 'text-white'))}>
                <Icon className="h-[18px] w-[18px]" />
              </span>
              {r.short}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
