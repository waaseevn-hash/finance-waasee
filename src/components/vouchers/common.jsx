import { ArrowDownLeft, ArrowUpRight, FileClock, FileText } from 'lucide-react';
import { ACCOUNTS, VSTATUS, VTYPE, voucherAmount } from '../../lib/vouchers.js';
import { moneyToWords } from '../../lib/vnwords.js';
import { Badge, Select, cx } from '../ui.jsx';

export const TYPE_ICON = { TU: FileClock, TT: FileText, PT: ArrowDownLeft, PC: ArrowUpRight };
/** Màu nhận diện từng loại chứng từ (giống màu bìa cuốn phiếu) */
export const TYPE_STYLE = {
  TU: { chip: 'bg-amber-50 text-amber-800 ring-amber-200', icon: 'bg-amber-100 text-amber-800', bar: 'bg-amber-500' },
  TT: { chip: 'bg-orchid-50 text-orchid-700 ring-orchid-100', icon: 'bg-orchid-100 text-orchid-700', bar: 'bg-orchid-500' },
  PT: { chip: 'bg-jade-50 text-jade-700 ring-jade-100', icon: 'bg-jade-100 text-jade-700', bar: 'bg-jade-500' },
  PC: { chip: 'bg-vermilion-50 text-vermilion-700 ring-vermilion-100', icon: 'bg-vermilion-100 text-vermilion-700', bar: 'bg-vermilion-500' },
};

export function VTypeChip({ type, auto = false, className = '' }) {
  const Icon = TYPE_ICON[type] || FileText;
  return (
    <span className={cx('inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset whitespace-nowrap', TYPE_STYLE[type]?.chip, className)}>
      <Icon className="h-3 w-3" />
      {type === 'TU' ? 'Tạm ứng' : type === 'TT' ? 'Thanh toán' : VTYPE[type]?.label}
      {auto && <span className="font-normal opacity-80">· tự động</span>}
    </span>
  );
}

export function VStatusBadge({ status }) {
  const s = VSTATUS[status] || VSTATUS.DRAFT;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

export function AmountWords({ value, className = '' }) {
  const n = Math.round(Number(value) || 0);
  if (!n) return null;
  return <p className={cx('text-xs italic text-slate-500', className)}>Bằng chữ: {moneyToWords(n)}</p>;
}

/** Danh sách TK gợi ý theo vai trò trong bút toán */
export const ACCOUNT_SETS = {
  expense: ['642', '641', '627', '152', '153', '156', '8111', '811', '331'],
  pcDebit: ['642', '641', '627', '141', '152', '153', '156', '331', '334', '3388', '8111', '811', '1121'],
  ptCredit: ['141', '131', '138', '511', '711', '3388', '334', '1121'],
};

export function AccountSelect({ value, onChange, set = 'expense', className = '' }) {
  const codes = ACCOUNT_SETS[set] || ACCOUNT_SETS.expense;
  const list = codes.map((c) => ACCOUNTS.find(([x]) => x === c)).filter(Boolean);
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)} className={className}>
      {list.map(([c, n]) => (
        <option key={c} value={c}>
          {c} — {n}
        </option>
      ))}
    </Select>
  );
}

export const vAmount = voucherAmount;
