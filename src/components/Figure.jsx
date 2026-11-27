import { Money } from './Money.jsx';
import { cx } from './ui.jsx';

/** Một con số tổng hợp: nhãn nhỏ · số lớn (điện thoại rút gọn "1,25 tỷ") · dòng phụ */
export function Figure({ label, value, sub, tone = 'text-ink-900', align = 'left', sign = false }) {
  return (
    <div className={cx('min-w-0', align === 'right' && 'text-right')}>
      <p className="text-[11px] sm:text-xs font-medium text-slate-500 truncate">{label}</p>
      <p className={cx('mt-0.5 font-display text-lg sm:text-2xl font-bold tabular-nums leading-tight', tone)}>
        <span className="sm:hidden">
          {sign && value > 0 ? '+' : ''}
          <Money value={value} compact />
        </span>
        <span className="hidden sm:inline">
          <Money value={value} sign={sign} />
        </span>
      </p>
      {sub && <p className="text-[11px] sm:text-xs text-slate-500 truncate">{sub}</p>}
    </div>
  );
}

/** Ô số liệu phụ (có thể bấm để chuyển tới danh sách tương ứng) */
export function MiniStat({ label, value, sub, tone = 'text-ink-900', onClick }) {
  const Tag = onClick ? 'button' : 'div';
  return (
    <Tag type={onClick ? 'button' : undefined} onClick={onClick} className={cx('bg-white px-4 py-3 text-left min-w-0', onClick && 'hover:bg-slate-50 transition-colors')}>
      <span className="block text-[11px] font-medium text-slate-500 truncate">{label}</span>
      <span className={cx('mt-0.5 block text-[15px] font-semibold tabular-nums truncate', tone)}>{value}</span>
      {sub && <span className="block text-[11px] text-slate-500 truncate">{sub}</span>}
    </Tag>
  );
}
