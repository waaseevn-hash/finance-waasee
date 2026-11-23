import { useEffect } from 'react';
import { createPortal } from 'react-dom';
import { ChevronLeft, ChevronRight, LoaderCircle, Plus, X } from 'lucide-react';
import { currentMonth, monthLabel, shiftMonth } from '../lib/dates.js';

export const cx = (...a) => a.filter(Boolean).join(' ');

/* ----------------------------- Button ----------------------------- */
const VARIANTS = {
  primary: 'bg-ink-900 text-white hover:bg-ink-800 shadow-sm shadow-ink-900/20',
  secondary: 'bg-white text-slate-700 border border-slate-200 hover:bg-slate-50 hover:border-slate-300',
  ghost: 'text-slate-600 hover:bg-slate-100',
  soft: 'bg-slate-100 text-slate-700 hover:bg-slate-200',
  danger: 'bg-rose-600 text-white hover:bg-rose-700 shadow-sm',
  success: 'bg-jade-600 text-white hover:bg-jade-700 shadow-sm shadow-jade-700/20',
  blue: 'bg-sapphire-600 text-white hover:bg-sapphire-700 shadow-sm shadow-sapphire-700/20',
  jade: 'bg-jade-600 text-white hover:bg-jade-700 shadow-sm shadow-jade-700/20',
  vermilion: 'bg-vermilion-500 text-white hover:bg-vermilion-600 shadow-sm shadow-vermilion-700/20',
  orchid: 'bg-orchid-600 text-white hover:bg-orchid-700 shadow-sm shadow-orchid-700/20',
  amber: 'bg-amber-700 text-white hover:bg-amber-800 shadow-sm shadow-amber-900/20',
  white: 'bg-white/95 text-ink-900 hover:bg-white shadow-sm',
  glass: 'bg-white/15 text-white hover:bg-white/25 ring-1 ring-inset ring-white/25',
  dangerGhost: 'text-rose-600 hover:bg-rose-50',
};
const SIZES = {
  xs: 'h-7 px-2 text-xs gap-1',
  sm: 'h-8 px-2.5 text-xs gap-1.5',
  md: 'h-10 px-3.5 text-sm gap-2',
  lg: 'h-11 px-5 text-sm gap-2',
  icon: 'h-9 w-9',
  iconSm: 'h-8 w-8',
};

export function Button({ variant = 'secondary', size = 'md', icon: Icon, loading = false, className = '', children, disabled, ...rest }) {
  return (
    <button
      type="button"
      {...rest}
      disabled={disabled || loading}
      className={cx(
        'inline-flex items-center justify-center rounded-lg font-medium transition-colors whitespace-nowrap select-none',
        'disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 focus-visible:ring-offset-1',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4 shrink-0" /> : null}
      {children}
    </button>
  );
}

/* ------------------------------ Card ------------------------------ */
export function Card({ className = '', children, ...rest }) {
  return (
    <div {...rest} className={cx('rounded-2xl bg-white border border-slate-200/70 shadow-[0_1px_2px_rgba(15,30,58,0.05),0_8px_24px_-12px_rgba(15,30,58,0.12)]', className)}>
      {children}
    </div>
  );
}

export function CardHeader({ title, subtitle, icon: Icon, iconClass = 'bg-slate-100 text-slate-600', actions, className = '' }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 pb-3', className)}>
      <div className="flex items-center gap-3 min-w-0">
        {Icon && (
          <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', iconClass)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-slate-900 truncate">{title}</h3>
          {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

export const TONES = {
  ink: { grad: 'from-ink-800 to-ink-950', soft: 'bg-ink-900/5', text: 'text-ink-900', icon: 'bg-ink-900 text-white', bar: 'bg-ink-700', ring: 'ring-ink-900/10' },
  jade: { grad: 'from-jade-500 to-jade-700', soft: 'bg-jade-50', text: 'text-jade-700', icon: 'bg-jade-600 text-white', bar: 'bg-jade-500', ring: 'ring-jade-100' },
  sapphire: { grad: 'from-sapphire-500 to-sapphire-700', soft: 'bg-sapphire-50', text: 'text-sapphire-700', icon: 'bg-sapphire-600 text-white', bar: 'bg-sapphire-500', ring: 'ring-sapphire-100' },
  vermilion: { grad: 'from-vermilion-500 to-vermilion-700', soft: 'bg-vermilion-50', text: 'text-vermilion-600', icon: 'bg-vermilion-500 text-white', bar: 'bg-vermilion-500', ring: 'ring-vermilion-100' },
  orchid: { grad: 'from-orchid-500 to-orchid-700', soft: 'bg-orchid-50', text: 'text-orchid-700', icon: 'bg-orchid-600 text-white', bar: 'bg-orchid-500', ring: 'ring-orchid-100' },
  lagoon: { grad: 'from-lagoon-500 to-lagoon-700', soft: 'bg-lagoon-50', text: 'text-lagoon-700', icon: 'bg-lagoon-600 text-white', bar: 'bg-lagoon-500', ring: 'ring-lagoon-100' },
  rose: { grad: 'from-rose-500 to-rose-700', soft: 'bg-rose-50', text: 'text-rose-700', icon: 'bg-rose-600 text-white', bar: 'bg-rose-500', ring: 'ring-rose-100' },
  amber: { grad: 'from-amber-400 to-amber-600', soft: 'bg-amber-50', text: 'text-amber-700', icon: 'bg-amber-500 text-white', bar: 'bg-amber-500', ring: 'ring-amber-100' },
};

export function PageHeader({ title, subtitle, actions, icon: Icon, tone = 'ink' }) {
  const t = TONES[tone] || TONES.ink;
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between mb-5">
      <div className="flex items-center gap-3.5">
        {Icon && (
          <span className={cx('relative grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-gradient-to-br text-white shadow-lg guilloche', t.grad)}>
            <Icon className="h-6 w-6" />
          </span>
        )}
        <div>
          <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-ink-900">{title}</h1>
          {subtitle && <p className="text-sm text-slate-500 mt-0.5">{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * Ô số liệu bấm được. variant "solid": nền màu đậm có hoa văn; "soft": nền trắng, viền màu.
 */
export function StatTile({ tone = 'ink', variant = 'soft', icon: Icon, label, value, sub, footer, onClick, className = '', action = 'Thêm / bớt' }) {
  const t = TONES[tone] || TONES.ink;
  const solid = variant === 'solid';
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag
      type={onClick ? 'button' : undefined}
      onClick={onClick}
      className={cx(
        'group relative flex flex-col text-left rounded-2xl p-4 sm:p-5 transition-all overflow-hidden',
        solid
          ? cx('bg-gradient-to-br text-white guilloche shadow-lg', t.grad)
          : cx('bg-white border border-slate-200/70 shadow-[0_1px_2px_rgba(15,30,58,0.05),0_8px_24px_-12px_rgba(15,30,58,0.12)]'),
        onClick && 'cursor-pointer hover:-translate-y-0.5 hover:shadow-xl focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-sapphire-500',
        className,
      )}
    >
      {!solid && <span className={cx('absolute inset-y-0 left-0 w-1', t.bar)} />}
      <span className="flex items-start justify-between gap-2">
        <span className={cx('text-[13px] font-medium', solid ? 'text-white/85' : 'text-slate-500')}>{label}</span>
        {Icon && (
          <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-xl', solid ? 'bg-white/15 ring-1 ring-inset ring-white/25' : t.icon)}>
            <Icon className="h-[18px] w-[18px]" />
          </span>
        )}
      </span>
      <span className={cx('block mt-1.5 font-display text-2xl font-bold tracking-tight', solid ? 'text-white' : t.text)}>{value}</span>
      {sub && <span className={cx('block mt-1 text-xs', solid ? 'text-white/80' : 'text-slate-500')}>{sub}</span>}
      {footer && <span className={cx('block mt-3 pt-3 border-t text-xs', solid ? 'border-white/20 text-white/90' : 'border-slate-100 text-slate-500')}>{footer}</span>}
      {onClick && (
        <span
          className={cx(
            'mt-3 inline-flex w-fit items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold transition-colors',
            solid ? 'bg-white/15 text-white group-hover:bg-white/25' : cx(t.soft, t.text),
          )}
        >
          <Plus className="h-3.5 w-3.5" /> {action}
        </span>
      )}
    </Tag>
  );
}

/** Bảng trượt từ phải (máy tính) / từ dưới (điện thoại) */
export function Drawer({ open, onClose, title, subtitle, tone = 'ink', icon: Icon, hero, children, footer }) {
  const t = TONES[tone] || TONES.ink;
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape' && !document.querySelector('[data-modal-open]')) onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);
  if (!open) return null;
  return createPortal(
    <div className="fixed inset-0 z-40 flex items-end sm:items-stretch sm:justify-end">
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div role="dialog" aria-modal="true" className="drawer-in relative flex w-full sm:max-w-xl flex-col bg-paper rounded-t-3xl sm:rounded-none sm:rounded-l-3xl shadow-2xl max-h-[94vh] sm:max-h-none overflow-hidden">
        <div className={cx('relative bg-gradient-to-br text-white guilloche px-5 pt-5 pb-5', t.grad)}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              {Icon && (
                <span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-white/15 ring-1 ring-inset ring-white/25">
                  <Icon className="h-5 w-5" />
                </span>
              )}
              <div className="min-w-0">
                <h3 className="text-lg font-bold leading-tight">{title}</h3>
                {subtitle && <p className="text-xs text-white/80 mt-0.5">{subtitle}</p>}
              </div>
            </div>
            <button type="button" onClick={onClose} className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-white/10 hover:bg-white/20" aria-label="Đóng">
              <X className="h-5 w-5" />
            </button>
          </div>
          {hero && <div className="mt-4">{hero}</div>}
        </div>
        <div className="flex-1 overflow-y-auto thin-scroll px-4 sm:px-5 py-4">{children}</div>
        {footer && <div className="border-t border-slate-200 bg-white px-4 sm:px-5 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

/* ----------------------------- Inputs ----------------------------- */
export const inputCls =
  'w-full h-10 rounded-lg border border-slate-200 bg-white px-3 text-sm text-slate-900 placeholder:text-slate-400 ' +
  'focus:outline-none focus:ring-2 focus:ring-sapphire-500/20 focus:border-sapphire-400 disabled:bg-slate-50 disabled:text-slate-500';

export function Field({ label, hint, error, required, children, className = '', as: Tag = 'label' }) {
  return (
    <Tag className={cx('block', className)}>
      {label && (
        <span className="mb-1.5 block text-xs font-medium text-slate-600">
          {label}
          {required && <span className="text-rose-500"> *</span>}
        </span>
      )}
      {children}
      {error ? (
        <span className="mt-1 block text-xs text-rose-600">{error}</span>
      ) : hint ? (
        <span className="mt-1 block text-xs text-slate-500">{hint}</span>
      ) : null}
    </Tag>
  );
}

// Nếu truyền độ rộng riêng (w-auto, w-40…) thì bỏ w-full mặc định để tránh xung đột
const baseCls = (className) => (/(^|\s)!?w-/.test(className) ? inputCls.replace('w-full ', '') : inputCls);

export function Input({ className = '', ...rest }) {
  return <input {...rest} className={cx(baseCls(className), className)} />;
}

export function Textarea({ className = '', rows = 2, ...rest }) {
  return <textarea rows={rows} {...rest} className={cx(inputCls, 'h-auto py-2 resize-y', className)} />;
}

export function Select({ className = '', children, ...rest }) {
  return (
    <select {...rest} className={cx(baseCls(className), 'pr-8 cursor-pointer', className)}>
      {children}
    </select>
  );
}

export function Checkbox({ checked, onChange, className = '', label, disabled, title }) {
  return (
    <label className={cx('inline-flex items-center gap-2 cursor-pointer select-none', disabled && 'opacity-50 cursor-not-allowed', className)} title={title}>
      <input
        type="checkbox"
        checked={!!checked}
        disabled={disabled}
        onChange={(e) => onChange?.(e.target.checked)}
        className="h-[18px] w-[18px] rounded border-slate-300 accent-ink-900 cursor-pointer"
      />
      {label && <span className="text-sm text-slate-700">{label}</span>}
    </label>
  );
}

export function Toggle({ checked, onChange, label, description, tone = 'slate' }) {
  const on = { slate: 'bg-ink-900', blue: 'bg-sapphire-600', green: 'bg-jade-600' }[tone];
  return (
    <button
      type="button"
      role="switch"
      aria-checked={!!checked}
      onClick={() => onChange?.(!checked)}
      className="flex w-full items-center justify-between gap-3 text-left"
    >
      <span className="min-w-0">
        <span className="block text-sm font-medium text-slate-800">{label}</span>
        {description && <span className="block text-xs text-slate-500 mt-0.5">{description}</span>}
      </span>
      <span className={cx('relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors', checked ? on : 'bg-slate-300')}>
        <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-[22px]' : 'translate-x-0.5')} />
      </span>
    </button>
  );
}

export function Segmented({ value, onChange, options, className = '' }) {
  return (
    <div className={cx('inline-flex rounded-lg bg-slate-100 p-1 gap-1', className)}>
      {options.map((o) => (
        <button
          type="button"
          key={o.value}
          onClick={() => onChange(o.value)}
          className={cx(
            'h-8 px-3 rounded-md text-sm font-medium transition-colors whitespace-nowrap',
            value === o.value ? cx('bg-white shadow-sm', o.activeClass || 'text-slate-900') : 'text-slate-500 hover:text-slate-800',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function Tabs({ value, onChange, tabs }) {
  return (
    <div className="flex gap-1 border-b border-slate-200 overflow-x-auto thin-scroll">
      {tabs.map((t) => (
        <button
          type="button"
          key={t.value}
          onClick={() => onChange(t.value)}
          className={cx(
            'relative -mb-px flex items-center gap-2 px-3 sm:px-4 py-2.5 text-sm font-medium whitespace-nowrap border-b-2 transition-colors',
            value === t.value ? cx(t.activeClass || 'border-ink-900 text-ink-900') : 'border-transparent text-slate-500 hover:text-slate-800',
          )}
        >
          {t.icon && <t.icon className={cx('h-4 w-4', t.iconClass)} />}
          {t.label}
          {t.count != null && (
            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[11px] font-semibold text-slate-600">{t.count}</span>
          )}
        </button>
      ))}
    </div>
  );
}

/* ----------------------------- Display ---------------------------- */
const BADGE = {
  slate: 'bg-slate-100 text-slate-700 ring-slate-200',
  green: 'bg-emerald-50 text-emerald-700 ring-emerald-200',
  red: 'bg-rose-50 text-rose-700 ring-rose-200',
  amber: 'bg-amber-50 text-amber-800 ring-amber-200',
  orange: 'bg-orange-50 text-orange-700 ring-orange-200',
  blue: 'bg-blue-50 text-blue-700 ring-blue-200',
  violet: 'bg-violet-50 text-violet-700 ring-violet-200',
  dark: 'bg-slate-900 text-white ring-slate-900',
};

export function Badge({ tone = 'slate', children, className = '', icon: Icon }) {
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap', BADGE[tone], className)}>
      {Icon && <Icon className="h-3 w-3" />}
      {children}
    </span>
  );
}

export function ProgressBar({ value = 0, tone, className = '' }) {
  const v = Math.max(0, Math.min(100, Number(value) || 0));
  const color = tone || (v >= 90 ? 'bg-rose-500' : v >= 75 ? 'bg-amber-500' : 'bg-sapphire-500');
  return (
    <div className={cx('h-2 w-full rounded-full bg-slate-100 overflow-hidden', className)}>
      <div className={cx('h-full rounded-full transition-all', color)} style={{ width: `${v}%` }} />
    </div>
  );
}

export function EmptyState({ icon: Icon, title, description, action, className = '' }) {
  return (
    <div className={cx('flex flex-col items-center justify-center text-center px-6 py-10', className)}>
      {Icon && (
        <span className="mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-slate-100 text-slate-500">
          <Icon className="h-6 w-6" />
        </span>
      )}
      <p className="text-sm font-semibold text-slate-800">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-slate-500">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Spinner({ className = 'h-5 w-5' }) {
  return <LoaderCircle className={cx('animate-spin text-slate-400', className)} />;
}

export function FullScreenLoader({ text = 'Đang tải…' }) {
  return (
    <div className="min-h-screen grid place-items-center bg-slate-50">
      <div className="flex items-center gap-3 text-slate-500 text-sm">
        <Spinner /> {text}
      </div>
    </div>
  );
}

/* ------------------------------ Modal ----------------------------- */
const MODAL_W = { sm: 'sm:max-w-md', md: 'sm:max-w-lg', lg: 'sm:max-w-2xl', xl: 'sm:max-w-4xl', '2xl': 'sm:max-w-6xl' };

export function Modal({ open, onClose, title, subtitle, children, footer, size = 'md', z = 'z-50' }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => {
      if (e.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;
  return createPortal(
    <div data-modal-open="" className={cx('fixed inset-0 flex items-end sm:items-center justify-center sm:p-4', z)}>
      <div className="absolute inset-0 bg-ink-950/50 backdrop-blur-[2px]" onClick={onClose} />
      <div
        role="dialog"
        aria-modal="true"
        className={cx('relative w-full bg-white rounded-t-2xl sm:rounded-2xl shadow-2xl max-h-[92vh] flex flex-col', MODAL_W[size])}
      >
        <div className="flex items-start justify-between gap-3 px-5 pt-4 pb-3 border-b border-slate-100">
          <div className="min-w-0">
            <h3 className="text-base font-bold text-ink-900">{title}</h3>
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          <button type="button" onClick={onClose} className="-mr-1 grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="Đóng">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto thin-scroll">{children}</div>
        {footer && (
          <div className="px-5 py-3 border-t border-slate-100 flex flex-wrap justify-end gap-2 bg-slate-50/70 rounded-b-2xl pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

/* --------------------------- MonthPicker -------------------------- */
export function MonthPicker({ value, onChange, className = '' }) {
  const isCurrent = value === currentMonth();
  return (
    <div className={cx('inline-flex items-center rounded-lg border border-slate-200 bg-white h-10', className)}>
      <button type="button" className="grid h-full w-9 place-items-center text-slate-500 hover:text-slate-900" onClick={() => onChange(shiftMonth(value, -1))} aria-label="Tháng trước">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <button
        type="button"
        onClick={() => onChange(currentMonth())}
        title="Về tháng hiện tại"
        className={cx('px-2 text-sm font-semibold min-w-[120px] text-center', isCurrent ? 'text-slate-900' : 'text-blue-700')}
      >
        {monthLabel(value)}
      </button>
      <button type="button" className="grid h-full w-9 place-items-center text-slate-500 hover:text-slate-900" onClick={() => onChange(shiftMonth(value, 1))} aria-label="Tháng sau">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}

/* ------------------------- Bảng responsive ------------------------ */
export function TableWrap({ children, className = '' }) {
  return <div className={cx('overflow-x-auto thin-scroll', className)}>{children}</div>;
}

export const th = 'px-3 py-2.5 text-left text-[11px] font-semibold uppercase tracking-wide text-slate-500 whitespace-nowrap';
export const td = 'px-3 py-2.5 text-sm text-slate-700 align-middle';
