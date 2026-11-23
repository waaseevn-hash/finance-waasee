/**
 * BẢNG ĐIỀU PHỐI THÁNG — giao diện "Tối giản – Phân tầng – 10 giây"
 *   Tầng 1: thanh tổng hợp dính trên cùng (Nguồn khả dụng · Tổng dự chi · Số dư sau chi · Chốt / Xuất)
 *   Tầng 2: dải nguồn tiền vào thu gọn được (Két · Phải thu tháng này · Hạn mức vay)
 *   Tầng 3: bảng ưu tiên nhóm P1 / P2 / P3, đúng 6 cột, ngăn kéo chi tiết bên phải
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { collection, getDocs, query, where } from 'firebase/firestore';
import {
  BadgeCheck,
  ChevronDown,
  ChevronRight,
  CircleArrowDown,
  EllipsisVertical,
  FileSpreadsheet,
  GripVertical,
  Landmark,
  ListPlus,
  Lock,
  PanelRightOpen,
  Plus,
  Printer,
  ReceiptText,
  RotateCcw,
  ArrowDownWideNarrow,
  Stamp,
  Trash2,
  Vault,
} from 'lucide-react';
import { db } from '../../lib/firebase.js';
import { C } from '../../lib/db.js';
import { daysBetween, fmtDate } from '../../lib/dates.js';
import { fmtVND } from '../../lib/format.js';
import { CERTAINTY, PAY_METHOD, PRIORITY } from '../../lib/constants.js';
import { VTYPE, cashEffect } from '../../lib/vouchers.js';
import { Money, MoneyInput } from '../Money.jsx';
import { Badge, Button, Checkbox, Drawer, EmptyState, Textarea, Toggle, cx } from '../ui.jsx';
import { SupplierInfo } from '../forms/supplierForms.jsx';
import { openVoucher } from '../forms/cashForms.jsx';
import { VStatusBadge } from '../vouchers/common.jsx';

/* ------------------------------------------------------------------ */
/*  Tầng 1 — thanh tổng hợp                                            */
/* ------------------------------------------------------------------ */
function Metric({ label, value, tone, dot, sub }) {
  return (
    <div className="min-w-0 px-3 sm:px-4 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 whitespace-nowrap">
        <span className={cx('h-2 w-2 rounded-full', dot)} />
        {label}
      </p>
      <p className={cx('mt-0.5 font-display text-[17px] sm:text-xl font-bold tabular-nums leading-tight truncate', tone)}>
        <span className="sm:hidden">
          <Money value={value} compact />
        </span>
        <span className="hidden sm:inline">
          <Money value={value} />
        </span>
      </p>
      {sub && <p className="hidden sm:block text-[11px] leading-snug text-slate-500 truncate">{sub}</p>}
    </div>
  );
}

/** Nút Chốt / Xuất cho điện thoại (không dính, nằm dưới tiêu đề trang) */
export function PlanActionsMobile({ onLock, onPdf, onExcel, exporting }) {
  return (
    <div className="md:hidden flex w-full gap-2">
      <Button variant="orchid" size="sm" icon={Lock} onClick={onLock} className="flex-1">
        Chốt kế hoạch tháng
      </Button>
      <Button size="sm" icon={Printer} onClick={onPdf} loading={exporting}>
        PDF
      </Button>
      <Button size="sm" icon={FileSpreadsheet} onClick={onExcel}>
        Excel
      </Button>
    </div>
  );
}

export function PlanTopBar({ plan, onLock, onPdf, onExcel, exporting }) {
  const after = plan.balanceAvailable;
  const short = after < 0;
  let sub;
  if (plan.uncovered > 0) sub = <span className="text-rose-700 font-medium">vượt cả hạn mức {fmtVND(plan.uncovered)}</span>;
  else if (!plan.includeCredit && plan.suggestedDraw > 0) sub = <span className="text-sapphire-700 font-medium">→ cần rút {fmtVND(plan.suggestedDraw)} từ hạn mức</span>;
  else if (plan.includeCredit && plan.suggestedDraw > 0) sub = <span className="text-amber-700">trong đó dùng hạn mức {fmtVND(plan.suggestedDraw)}</span>;
  else sub = 'đủ tiền, không cần vay thêm';
  return (
    <div className="sticky top-14 sm:top-16 z-[15] -mx-4 sm:-mx-6 px-4 sm:px-6 py-2 bg-paper/85 backdrop-blur supports-[backdrop-filter]:bg-paper/70">
      <div className="flex flex-col md:flex-row md:items-stretch rounded-2xl bg-white border border-slate-200/80 shadow-[0_8px_24px_-14px_rgba(15,30,58,0.35)]">
        <div className="grid grid-cols-3 flex-1 divide-x divide-slate-100">
          <Metric label="Nguồn tiền khả dụng" value={plan.available} tone="text-sapphire-700" dot="bg-sapphire-500" sub={plan.includeCredit ? 'gồm hạn mức vay còn trống' : 'két + tiền gửi + phải thu đã chọn'} />
          <Metric label="Tổng dự chi" value={plan.payTotal} tone="text-vermilion-600" dot="bg-vermilion-500" sub={`${plan.selectedCount} khoản · P1 ${fmtVND(plan.byPriority.P1)}`} />
          <Metric label="Số dư sau chi" value={after} tone={short || plan.balance < 0 ? 'text-rose-600' : 'text-jade-700'} dot={short || plan.balance < 0 ? 'bg-rose-500' : 'bg-jade-500'} sub={sub} />
        </div>
        <p className="sm:hidden border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500 truncate">{sub}</p>
        <div className="hidden md:flex items-center gap-2 border-l border-slate-100 px-3 py-2">
          <Button variant="orchid" size="sm" icon={Lock} onClick={onLock}>
            Chốt kế hoạch tháng
          </Button>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden" role="group" aria-label="Xuất báo cáo">
            <button type="button" onClick={onPdf} disabled={exporting} className="inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Printer className="h-4 w-4" /> PDF
            </button>
            <button type="button" onClick={onExcel} className="inline-flex h-8 items-center gap-1.5 border-l border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
              <FileSpreadsheet className="h-4 w-4" /> Excel
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  Tầng 2 — dải nguồn tiền vào                                        */
/* ------------------------------------------------------------------ */
function StripCard({ icon: Icon, iconCls, title, children }) {
  return (
    <div className="rounded-xl border border-slate-200 bg-white p-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-slate-600">
        <span className={cx('grid h-6 w-6 place-items-center rounded-md', iconCls)}>
          <Icon className="h-3.5 w-3.5" />
        </span>
        {title}
      </p>
      <div className="mt-2">{children}</div>
    </div>
  );
}

export function CashInStrip({ plan, cashBal, deposits, credit, draft, arRows, edit, setAr, quick, onExtraAr }) {
  // Điện thoại: thu gọn sẵn để bảng ưu tiên lên ngay màn hình đầu
  const [open, setOpen] = useState(() => typeof window === 'undefined' || window.innerWidth >= 768);
  const [arOpen, setArOpen] = useState(false);
  const sel = arRows.filter((r) => r.selected);
  return (
    <section className="mt-3">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 rounded-lg px-1 py-1.5 text-left text-sm font-semibold text-ink-900"
        aria-expanded={open}
      >
        {open ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronRight className="h-4 w-4 text-slate-400" />}
        Nguồn tiền vào
        {!open && (
          <span className="ml-1 truncate text-xs font-normal text-slate-500">
            Két {fmtVND(plan.cashUsable)} · Phải thu {sel.length}/{arRows.length} = {fmtVND(plan.arIn)} · Hạn mức {fmtVND(credit)}
            {plan.includeCredit ? ' (đã gộp)' : ''}
          </span>
        )}
      </button>
      {open && (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <StripCard icon={Vault} iconCls="bg-jade-50 text-jade-700" title="Tiền mặt trong két">
              <div className="flex items-baseline justify-between gap-2">
                <Money value={cashBal} className="font-display text-lg font-bold text-ink-900" />
                <button type="button" onClick={() => quick.open('cash')} className="text-[11px] font-semibold text-jade-700 hover:underline">
                  Thu / chi két
                </button>
              </div>
              <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
                <span className="shrink-0">Giữ lại dự phòng</span>
                <span className="flex-1">
                  <MoneyInput value={draft.reserve} onChange={(v) => edit((d) => ({ ...d, reserve: v }))} showHint={false} className="!h-8 text-xs" aria-label="Quỹ dự phòng giữ lại trong két" />
                </span>
              </label>
              <label className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-600">
                <span className="flex items-center gap-2">
                  <input type="checkbox" className="h-4 w-4 accent-ink-900" checked={draft.includeDeposits} onChange={(e) => edit((d) => ({ ...d, includeDeposits: e.target.checked }))} />
                  Cộng tiền gửi NH
                </span>
                <Money value={deposits} className="font-medium text-slate-700" />
              </label>
              <p className="mt-2 flex justify-between border-t border-slate-100 pt-2 text-xs">
                <span className="text-slate-500">Két + tiền gửi khả dụng</span>
                <Money value={plan.haveTotal} className={cx('font-semibold', plan.haveTotal < 0 ? 'text-rose-600' : 'text-jade-700')} />
              </p>
            </StripCard>

            <StripCard icon={CircleArrowDown} iconCls="bg-lagoon-50 text-lagoon-700" title="Công nợ phải thu tháng này">
              <p className="text-sm text-slate-600">
                Đã chọn <b className="text-ink-900">{sel.length}/{arRows.length}</b> khoản
              </p>
              <Money value={plan.arIn} className="font-display text-lg font-bold text-lagoon-700" />
              <Button size="xs" variant="soft" className="mt-2 w-full" icon={arOpen ? ChevronDown : ChevronRight} onClick={() => setArOpen((o) => !o)} aria-expanded={arOpen}>
                {arOpen ? 'Thu gọn danh sách' : 'Mở danh sách để chọn'}
              </Button>
            </StripCard>

            <StripCard icon={Landmark} iconCls="bg-sapphire-50 text-sapphire-700" title="Hạn mức vay NH còn trống">
              <div className="flex items-baseline justify-between gap-2">
                <Money value={credit} className="font-display text-lg font-bold text-sapphire-700" />
                <button type="button" onClick={() => quick.open('credit')} className="text-[11px] font-semibold text-sapphire-700 hover:underline">
                  Khoản vay
                </button>
              </div>
              <div className="mt-2">
                <Toggle
                  tone="blue"
                  checked={!!draft.includeCredit}
                  onChange={(v) => edit((d) => ({ ...d, includeCredit: v }))}
                  label={<span className="text-xs">Tính gộp vào nguồn khả dụng</span>}
                  description={<span className="text-[11px]">Tắt: chỉ báo số cần rút khi thiếu</span>}
                />
              </div>
            </StripCard>
          </div>

          {arOpen && (
            <div className="mt-3 rounded-xl border border-slate-200 bg-white">
              <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 border-b border-slate-100">
                <p className="text-xs font-semibold text-slate-600">Tick khoản chắc chắn thu được để cộng vào nguồn tiền</p>
                <span className="flex gap-1">
                  <Button size="xs" variant="ghost" icon={Plus} onClick={() => quick.open('ar')}>
                    Thu tiền / thêm
                  </Button>
                  <Button size="xs" variant="ghost" icon={ListPlus} onClick={onExtraAr}>
                    Đưa khoản khác vào
                  </Button>
                </span>
              </div>
              {arRows.length === 0 ? (
                <p className="px-3 py-4 text-center text-xs text-slate-500">Không có khoản phải thu nào đến hạn trong tháng.</p>
              ) : (
                <ul className="divide-y divide-slate-100 max-h-[360px] overflow-y-auto thin-scroll">
                  {arRows.map((r) => (
                    <li key={r.key} className={cx('grid grid-cols-[24px_minmax(0,1fr)_150px] sm:grid-cols-[24px_minmax(0,1fr)_120px_170px] items-center gap-2 px-3 py-2', !r.selected && 'bg-slate-50/70')}>
                      <Checkbox checked={r.selected} onChange={(v) => setAr(r.key, { sel: v })} title="Đưa vào tính toán" />
                      <span className="min-w-0">
                        <span className={cx('block text-sm font-medium truncate', r.selected ? 'text-ink-900' : 'text-slate-400')}>{r.partner}</span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          <Badge tone={CERTAINTY[r.certainty]?.tone}>{CERTAINTY[r.certainty]?.label}</Badge>
                          {r.extra && (
                            <button type="button" className="text-[11px] text-rose-600 hover:underline" onClick={() => edit((d) => ({ ...d, extraAr: d.extraAr.filter((id) => id !== r.refId) }))}>
                              Bỏ
                            </button>
                          )}
                        </span>
                      </span>
                      <span className="hidden sm:block text-xs text-slate-500">{r.dueDate ? fmtDate(r.dueDate) : 'Chưa có hạn'}</span>
                      <MoneyInput value={r.amount} onChange={(v) => setAr(r.key, { amount: v === r.outstanding ? null : v })} showHint={false} className="!h-8" disabled={!r.selected} aria-label={`Số tiền thu ${r.partner}`} />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Tầng 3 — bảng ưu tiên                                              */
/* ------------------------------------------------------------------ */
export const KIND_TAG = {
  AP: { label: 'Công nợ NCC', cls: 'bg-vermilion-50 text-vermilion-700 ring-vermilion-100' },
  LOAN: { label: 'Đáo hạn NH', cls: 'bg-sapphire-50 text-sapphire-700 ring-sapphire-100' },
  INTEREST: { label: 'Lãi vay NH', cls: 'bg-sapphire-50 text-sapphire-700 ring-sapphire-100' },
  INTERNAL: { label: 'Chi nội bộ', cls: 'bg-amber-50 text-amber-800 ring-amber-200' },
  CUSTOM: { label: 'Chi cố định', cls: 'bg-orchid-50 text-orchid-700 ring-orchid-100' },
};

const GROUP_STYLE = {
  P1: { border: 'border-l-rose-500', chip: 'bg-rose-600 text-white', title: 'Bắt buộc trả' },
  P2: { border: 'border-l-orange-500', chip: 'bg-orange-500 text-white', title: 'Quan trọng' },
  P3: { border: 'border-l-slate-400', chip: 'bg-slate-500 text-white', title: 'Có thể giãn' },
};

export const FILTERS = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'SELECTED', label: 'Đang chọn chi' },
  { value: 'P1', label: 'Nhóm P1' },
  { value: 'BANK', label: 'Đáo hạn NH' },
  { value: 'INTERNAL', label: 'Chi nội bộ' },
];

export function matchFilter(r, f) {
  if (f === 'SELECTED') return r.selected;
  if (f === 'P1') return r.priority === 'P1';
  if (f === 'BANK') return r.kind === 'LOAN' || r.kind === 'INTEREST';
  if (f === 'INTERNAL') return r.kind === 'INTERNAL';
  return true;
}

const COLS = 'lg:grid-cols-[60px_minmax(0,1.5fr)_150px_130px_minmax(250px,1fr)_100px]';

function DueCell({ dueDate }) {
  if (!dueDate) return <span className="text-xs text-slate-400">Trong tháng</span>;
  const days = daysBetween(new Date().toISOString().slice(0, 10), dueDate);
  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <span className="text-sm tabular-nums text-slate-700">{fmtDate(dueDate)}</span>
      <Badge tone={days < 0 ? 'red' : days <= 7 ? 'amber' : 'slate'}>{days < 0 ? `Quá hạn ${-days} ngày` : days === 0 ? 'Hôm nay' : `Còn ${days} ngày`}</Badge>
    </span>
  );
}

function PrioritySelect({ row, onPriority }) {
  return (
    <select
      value={row.priority}
      onChange={(e) => onPriority(row.key, e.target.value)}
      disabled={row.kind === 'INTERNAL'}
      className={cx(
        'h-8 shrink-0 rounded-lg border-0 pl-2 pr-7 text-xs font-bold cursor-pointer focus:ring-2 focus:ring-slate-300 disabled:cursor-default',
        row.priority === 'P1' ? 'bg-rose-50 text-rose-700' : row.priority === 'P2' ? 'bg-orange-50 text-orange-700' : 'bg-slate-100 text-slate-600',
      )}
      aria-label="Mức ưu tiên"
    >
      {['P1', 'P2', 'P3'].map((p) => (
        <option key={p} value={p}>
          {p}
        </option>
      ))}
    </select>
  );
}

function PlanRow({ row, onToggle, onAmount, onQuick, onPriority, onOpen, rowRef, style, dragging, handleProps, canDrag }) {
  const locked = row.locked || row.kind === 'INTERNAL';
  const tag = KIND_TAG[row.kind] || KIND_TAG.CUSTOM;
  const over = row.amount > row.outstanding && row.kind !== 'CUSTOM';
  return (
    <li
      ref={rowRef}
      style={style}
      className={cx(
        'group relative grid grid-cols-[60px_minmax(0,1fr)_36px] gap-x-2 gap-y-2 items-center px-2 sm:px-3 py-2.5 bg-white border-b border-slate-100 last:border-0',
        COLS,
        !row.selected && 'bg-slate-50/80',
        row.overflow && 'bg-sapphire-50/50',
        dragging && 'shadow-xl ring-1 ring-orchid-200 rounded-xl z-10',
      )}
    >
      {/* 1. kéo-thả + chọn */}
      <div className="flex items-center gap-1 row-span-2 lg:row-span-1 self-start lg:self-center">
        <button
          type="button"
          {...(canDrag ? handleProps : {})}
          disabled={!canDrag}
          style={{ touchAction: 'none' }}
          className="grid h-8 w-6 place-items-center rounded text-slate-300 hover:text-slate-600 cursor-grab active:cursor-grabbing disabled:cursor-default disabled:opacity-40"
          title={canDrag ? 'Kéo để đổi thứ tự (hoặc chọn rồi bấm ↑ ↓)' : 'Bỏ bộ lọc để kéo đổi thứ tự'}
          aria-label="Kéo để đổi thứ tự"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <Checkbox checked={row.selected} onChange={(v) => onToggle(row.key, v)} disabled={row.locked} title={row.locked ? 'Đã duyệt chi — muốn bỏ thì hủy duyệt chi' : 'Chọn chi đợt này'} />
      </div>

      {/* 2. đối tác + nhãn */}
      <div className="min-w-0">
        <p className={cx('text-sm font-semibold truncate', row.selected ? 'text-ink-900' : 'text-slate-400')}>{row.kind === 'CUSTOM' || row.kind === 'INTERNAL' ? row.label : row.partner}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-1.5">
          <span className={cx('inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-semibold ring-1 ring-inset', tag.cls)}>{row.kind === 'CUSTOM' ? row.category || tag.label : tag.label}</span>
          {row.approval && (
            <Badge tone="green" icon={BadgeCheck}>
              Đã duyệt chi
            </Badge>
          )}
          <span className="text-xs text-slate-500 truncate max-w-[260px]">{row.kind === 'CUSTOM' ? '' : row.kind === 'INTERNAL' ? row.partner : row.label}</span>
        </p>
      </div>

      {/* 6 (điện thoại): mở chi tiết */}
      <button type="button" onClick={() => onOpen(row)} className="lg:hidden grid h-9 w-9 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-ink-900 self-start" aria-label="Xem chi tiết">
        <PanelRightOpen className="h-4 w-4" />
      </button>

      {/* 3. hạn */}
      <div className="col-start-2 col-span-2 lg:col-auto flex items-center justify-between gap-2 lg:block">
        <DueCell dueDate={row.dueDate} />
        {/* 4 (điện thoại) */}
        <span className="lg:hidden text-xs text-slate-500">
          Còn <Money value={row.outstanding} />
        </span>
      </div>

      {/* 4. còn phải trả */}
      <div className="hidden lg:block text-right">
        <Money value={row.outstanding} className="text-sm text-slate-500" />
      </div>

      {/* 5. dự chi đợt này */}
      <div className="col-span-3 lg:col-auto pl-[64px] lg:pl-0">
        <div className="flex items-center gap-1.5">
          <div className="flex-1 min-w-0">
            <MoneyInput value={row.amount} onChange={(v) => onAmount(row.key, v)} showHint={false} className="!h-9" disabled={!row.selected || locked} aria-label={`Dự chi đợt này — ${row.partner || row.label}`} />
          </div>
          {!locked && row.selected && (
            <span className="flex gap-0.5 lg:opacity-0 lg:group-hover:opacity-100 lg:focus-within:opacity-100 transition-opacity">
              {[50, 100].map((pct) => (
                <button
                  key={pct}
                  type="button"
                  onClick={() => onQuick(row, pct)}
                  className="h-7 rounded-md border border-slate-200 px-1.5 text-[11px] font-semibold text-slate-600 hover:border-ink-900 hover:text-ink-900"
                  title={`Chi ${pct}% số còn phải trả`}
                >
                  {pct}%
                </button>
              ))}
            </span>
          )}
          <span className="lg:hidden">
            <PrioritySelect row={row} onPriority={onPriority} />
          </span>
        </div>
        {over && <p className="mt-0.5 text-[11px] text-amber-700">Lớn hơn số còn phải trả</p>}
        {row.crossing && <p className="mt-0.5 text-[11px] font-medium text-sapphire-700">Từ khoản này trở đi phải dùng tiền vay</p>}
      </div>

      {/* 6. ưu tiên + mở chi tiết */}
      <div className="hidden lg:flex items-center gap-1.5 justify-end">
        <PrioritySelect row={row} onPriority={onPriority} />
        <button type="button" onClick={() => onOpen(row)} className="grid h-8 w-8 place-items-center rounded-lg text-slate-400 hover:bg-slate-100 hover:text-ink-900" title="Ghi chú, lịch sử thanh toán, chứng từ" aria-label="Xem chi tiết">
          <PanelRightOpen className="h-4 w-4" />
        </button>
      </div>
    </li>
  );
}

function PriorityGroup({ p, rows, total, selectedCount, collapsed, onCollapse, sortable, canDrag, handlers }) {
  const st = GROUP_STYLE[p];
  return (
    <div className={cx('border-l-4 bg-white', st.border)}>
      <button type="button" onClick={onCollapse} className="flex w-full items-center gap-2 px-3 py-2 bg-slate-50/80 border-b border-slate-100 text-left" aria-expanded={!collapsed}>
        {collapsed ? <ChevronRight className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
        <span className={cx('rounded-md px-1.5 py-0.5 text-[11px] font-bold', st.chip)}>{p}</span>
        <span className="text-sm font-semibold text-ink-900">{st.title}</span>
        <span className="hidden sm:inline text-xs text-slate-500">
          {selectedCount}/{rows.length} khoản chọn chi
        </span>
        <span className="ml-auto text-right">
          <span className="block text-[10px] text-slate-500 leading-none">Tạm tính</span>
          <Money value={total} className="text-sm font-bold text-ink-900" />
        </span>
      </button>
      {!collapsed &&
        (rows.length === 0 ? (
          <p className="px-4 py-3 text-xs text-slate-400">Không có khoản nào.</p>
        ) : (
          <ul>
            {rows.map((r, i) => (
              <PlanRow
                key={r.key}
                row={r}
                {...handlers}
                canDrag={canDrag}
                rowRef={sortable.setRef(r.key)}
                style={sortable.styleFor(r.key, i)}
                dragging={sortable.draggingKey === r.key}
                handleProps={sortable.handleProps(r.key)}
              />
            ))}
          </ul>
        ))}
    </div>
  );
}

function MoreMenu({ items }) {
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
      <Button size="sm" variant="ghost" icon={EllipsisVertical} onClick={() => setOpen((o) => !o)} aria-label="Thêm thao tác" aria-expanded={open}>
        <span className="hidden sm:inline">Khác</span>
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-60 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
          {items.map((it) => (
            <button
              key={it.label}
              type="button"
              onClick={() => {
                setOpen(false);
                it.onClick();
              }}
              className={cx('flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm hover:bg-slate-50', it.danger ? 'text-rose-600' : 'text-slate-700')}
            >
              <it.icon className="h-4 w-4 shrink-0" />
              {it.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * @param groups  { P1: rows[], P2: rows[], P3: rows[] } (đã lọc)
 * @param sortables { P1, P2, P3 } trả về từ useSortableList
 */
export function PriorityTable({ plan, groups, filter, setFilter, sortables, handlers, onAddFixed, onExtraAp, onSort, onReset }) {
  const [collapsed, setCollapsed] = useState({});
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.value, plan.rows.filter((r) => matchFilter(r, f.value)).length])), [plan.rows]);
  const visibleGroups = filter === 'P1' ? ['P1'] : ['P1', 'P2', 'P3'];
  const total = plan.rows.length;
  return (
    <section className="mt-4 rounded-2xl bg-white border border-slate-200/70 shadow-[0_1px_2px_rgba(15,30,58,0.05),0_8px_24px_-12px_rgba(15,30,58,0.12)] overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 px-3 sm:px-4 py-3 border-b border-slate-100">
        <div className="flex gap-1 overflow-x-auto thin-scroll -mx-1 px-1" role="tablist" aria-label="Lọc khoản chi">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cx(
                'h-8 shrink-0 rounded-full px-3 text-xs font-semibold transition-colors',
                filter === f.value ? 'bg-ink-900 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
              )}
            >
              {f.label}
              <span className={cx('ml-1.5 tabular-nums', filter === f.value ? 'text-white/70' : 'text-slate-400')}>{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1.5">
          <Button size="sm" variant="orchid" icon={Plus} onClick={onAddFixed}>
            Thêm khoản chi cố định
          </Button>
          <MoreMenu
            items={[
              { label: 'Thêm công nợ chưa đến hạn', icon: ListPlus, onClick: onExtraAp },
              { label: 'Sắp xếp lại theo ưu tiên & hạn', icon: ArrowDownWideNarrow, onClick: onSort },
              { label: 'Làm lại bảng tháng này', icon: RotateCcw, onClick: onReset, danger: true },
            ]}
          />
        </div>
      </div>

      <div className={cx('hidden lg:grid gap-x-2 px-3 py-2 bg-white border-b border-slate-100 text-[11px] font-semibold uppercase tracking-wide text-slate-500 pl-[19px]', COLS)}>
        <span>Chọn</span>
        <span>Đối tác / khoản chi</span>
        <span>Hạn thanh toán</span>
        <span className="text-right">Còn phải trả</span>
        <span>Dự chi đợt này</span>
        <span className="text-right">Ưu tiên</span>
      </div>

      {total === 0 ? (
        <EmptyState icon={BadgeCheck} title="Chưa có khoản phải trả nào trong tháng" description="Thêm Lương, Thuế/BHXH, chi phí vận hành… bằng nút “Thêm khoản chi cố định”." />
      ) : (
        <div className="divide-y divide-slate-200">
          {visibleGroups.map((p) => {
            const rows = groups[p];
            const all = plan.rows.filter((r) => r.priority === p);
            return (
              <PriorityGroup
                key={p}
                p={p}
                rows={rows}
                total={all.filter((r) => r.selected).reduce((s, r) => s + (Number(r.amount) || 0), 0)}
                selectedCount={all.filter((r) => r.selected).length}
                collapsed={!!collapsed[p]}
                onCollapse={() => setCollapsed((c) => ({ ...c, [p]: !c[p] }))}
                sortable={sortables[p]}
                canDrag={filter === 'ALL' || filter === 'P1'}
                handlers={handlers}
              />
            );
          })}
        </div>
      )}
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Ngăn kéo chi tiết một khoản chi                                    */
/* ------------------------------------------------------------------ */
function Info({ label, children }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-800 min-w-0">{children}</span>
    </div>
  );
}

export function RowDrawer({ row, onClose, data, note, onNote, onApprove, onRemove, supplier, internal }) {
  const [history, setHistory] = useState(null);
  const [text, setText] = useState(note || '');
  useEffect(() => setText(note || ''), [note, row?.key]);
  useEffect(() => {
    setHistory(null);
    if (!row || row.kind !== 'AP') return undefined;
    let alive = true;
    getDocs(query(collection(db, C.payments), where('parentId', '==', row.refId)))
      .then((s) => alive && setHistory(s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => p.kind === 'AP').sort((a, b) => (b.date || '').localeCompare(a.date || ''))))
      .catch(() => alive && setHistory([]));
    return () => {
      alive = false;
    };
  }, [row]);
  if (!row) return null;
  const debt = row.kind === 'AP' ? data.ap.find((x) => x.id === row.refId) : null;
  const loan = row.kind === 'LOAN' ? data.loans.find((x) => x.id === row.refId) : null;
  const approvals = row.kind === 'AP' ? (data.approvals || []).filter((a) => a.payableId === row.refId).sort((a, b) => (b.approvedOn || '').localeCompare(a.approvedOn || '')) : [];
  const tone = row.kind === 'AP' ? 'vermilion' : row.kind === 'INTERNAL' ? 'amber' : row.kind === 'CUSTOM' ? 'orchid' : 'sapphire';
  const saveNote = () => {
    if ((text || '') !== (note || '')) onNote(row.key, text.trim().slice(0, 1000));
  };
  return (
    <Drawer
      open
      onClose={() => {
        saveNote();
        onClose();
      }}
      tone={tone}
      icon={row.kind === 'INTERNAL' ? ReceiptText : row.kind === 'AP' ? Stamp : row.kind === 'CUSTOM' ? Vault : Landmark}
      title={row.kind === 'CUSTOM' || row.kind === 'INTERNAL' ? row.label : row.partner}
      subtitle={`${KIND_TAG[row.kind]?.label || ''} · ${row.priority}${row.dueDate ? ` · hạn ${fmtDate(row.dueDate)}` : ''}`}
      hero={
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-white/75">Dự chi đợt này</p>
            <p className="font-display text-2xl font-bold tabular-nums">{row.selected ? fmtVND(row.amount) : 'Tạm hoãn'}</p>
          </div>
          <div>
            <p className="text-[11px] text-white/75">Còn phải trả</p>
            <p className="font-display text-2xl font-bold tabular-nums">{fmtVND(row.outstanding)}</p>
          </div>
        </div>
      }
      footer={
        <div className="flex flex-wrap justify-end gap-2">
          {(row.kind === 'CUSTOM' || row.extra) && (
            <Button
              variant="dangerGhost"
              icon={Trash2}
              onClick={() => {
                onRemove(row);
                onClose();
              }}
            >
              Bỏ khỏi bảng
            </Button>
          )}
          {row.kind === 'AP' && onApprove && (
            <Button variant={row.approval ? 'secondary' : 'vermilion'} icon={Stamp} onClick={() => onApprove(row)}>
              {row.approval ? 'Sửa duyệt chi' : 'Duyệt chi'}
            </Button>
          )}
          <Button
            variant="primary"
            onClick={() => {
              saveNote();
              onClose();
            }}
          >
            Xong
          </Button>
        </div>
      }
    >
      <div className="divide-y divide-slate-100">
        {row.kind === 'AP' && (
          <div className="pb-3">
            <SupplierInfo supplier={supplier || { name: row.partner }} />
            <Info label="Nội dung">{row.label}</Info>
            {debt && (
              <>
                <Info label="Tổng công nợ">
                  <Money value={debt.total} />
                </Info>
                <Info label="Đã trả">
                  <Money value={debt.paid} />
                </Info>
              </>
            )}
            {debt?.note && <Info label="Ghi chú công nợ">{debt.note}</Info>}
          </div>
        )}
        {row.kind === 'LOAN' && loan && (
          <div className="pb-3">
            <Info label="Khế ước">{loan.contractNo}</Info>
            <Info label="Giải ngân">{fmtDate(loan.disbursedDate)}</Info>
            <Info label="Đáo hạn">{fmtDate(loan.maturityDate)}</Info>
            <Info label="Lãi suất">{loan.interestRate}%/năm</Info>
          </div>
        )}
        {row.kind === 'INTEREST' && <p className="pb-3 text-sm text-slate-600">Lãi vay ước tính theo số ngày thực tế của các khế ước đang vay tại {row.partner}.</p>}
        {row.kind === 'CUSTOM' && <p className="pb-3 text-sm text-slate-600">Khoản chi cố định nhóm “{row.category}”. Sửa số tiền ngay trên bảng; xóa bằng nút “Bỏ khỏi bảng”.</p>}

        {row.kind === 'INTERNAL' && internal && (
          <div className="pb-3 space-y-3">
            <p className="text-sm text-slate-600">
              Chứng từ đã duyệt, chờ kết xuất: chi <b>{fmtVND(internal.pendingOut)}</b>
              {internal.pendingIn > 0 && <>, thu hoàn ứng / phiếu thu {fmtVND(internal.pendingIn)}</>}. Phần đã kết chuyển trong tháng (<b>{fmtVND(internal.postedOut)}</b>) đã trừ vào tồn két nên không cộng lại.
            </p>
            <VoucherList title="Chờ kết xuất (tính vào dự chi)" list={internal.pending} />
            <VoucherList title="Đã kết chuyển trong tháng" list={internal.posted} muted />
          </div>
        )}

        <div className="py-3">
          <p className="text-sm font-semibold text-ink-900 mb-1.5">Ghi chú kế hoạch</p>
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={saveNote} placeholder="VD: Đã hẹn NCC chuyển 50% trước ngày 25" />
        </div>

        {row.kind === 'AP' && (
          <div className="py-3">
            <p className="text-sm font-semibold text-ink-900 mb-1.5">Lịch sử thanh toán & duyệt chi</p>
            {history === null ? (
              <p className="text-xs text-slate-400">Đang tải…</p>
            ) : history.length === 0 && approvals.length === 0 ? (
              <p className="text-xs text-slate-500">Chưa có lần thanh toán nào.</p>
            ) : (
              <ul className="space-y-1.5 text-sm">
                {approvals.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5">
                    <span className="text-xs">
                      Duyệt chi {a.mode === 'PART' ? '1 phần' : 'hết'} · {fmtDate(a.approvedOn)} ·{' '}
                      <span className={a.status === 'DONE' ? 'text-jade-700' : a.status === 'OPEN' ? 'text-amber-700' : 'text-slate-400'}>
                        {a.status === 'DONE' ? 'đã chuyển tiền' : a.status === 'OPEN' ? 'chờ chuyển' : 'đã hủy'}
                      </span>
                    </span>
                    <Money value={a.amount} className="text-xs font-semibold" />
                  </li>
                ))}
                {history.map((p) => (
                  <li key={p.id} className="flex items-center justify-between gap-2 px-2.5 py-1">
                    <span className="text-xs text-slate-600">
                      {fmtDate(p.date)} · {PAY_METHOD[p.method] || p.method}
                      {p.note ? ` · ${p.note}` : ''}
                    </span>
                    <Money value={p.amount} className="text-xs font-semibold text-jade-700" />
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Drawer>
  );
}

function VoucherList({ title, list, muted }) {
  if (!list.length) return null;
  return (
    <div>
      <p className="text-xs font-semibold text-slate-500 mb-1">{title}</p>
      <ul className={cx('rounded-xl border border-slate-200 divide-y divide-slate-100', muted && 'opacity-80')}>
        {list.map((v) => {
          const e = cashEffect(v);
          return (
            <li key={v.id}>
              <button type="button" onClick={() => openVoucher(v.id)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-ink-900 truncate">
                    {v.no} · {v.person}
                  </span>
                  <span className="block text-xs text-slate-500 truncate">
                    {VTYPE[v.type]?.short} · {v.reason}
                  </span>
                </span>
                <span className="text-right">
                  <Money value={e.out || e.in} className={cx('block text-sm font-semibold', e.out ? 'text-vermilion-700' : 'text-jade-700')} />
                  <VStatusBadge status={v.status} />
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

export { PRIORITY };
