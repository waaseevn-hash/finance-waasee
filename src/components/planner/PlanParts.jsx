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
  Check,
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
import { fmtNum, fmtVND } from '../../lib/format.js';
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
function Metric({ label, short, value, tone, dot, sub }) {
  return (
    <div className="min-w-0 px-3 sm:px-4 py-2">
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-slate-500 whitespace-nowrap">
        <span className={cx('h-2 w-2 shrink-0 rounded-full', dot)} />
        <span className="sm:hidden">{short}</span>
        <span className="hidden sm:inline">{label}</span>
      </p>
      <p className={cx('mt-0.5 font-display text-[17px] sm:text-lg xl:text-xl font-bold tabular-nums leading-tight truncate', tone)}>
        <span className="sm:hidden">
          <Money value={value} compact />
        </span>
        <span className="hidden sm:inline">
          <Money value={value} unit={false} />
          <span className="ml-1 text-sm font-medium text-slate-400">đ</span>
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
          <Metric label="Nguồn tiền khả dụng" short="Có thể dùng" value={plan.available} tone="text-sapphire-700" dot="bg-sapphire-500" sub={plan.includeCredit ? 'gồm hạn mức vay còn trống' : 'két + tiền gửi + phải thu đã chọn'} />
          <Metric label="Tổng dự chi" short="Dự chi" value={plan.payTotal} tone="text-vermilion-600" dot="bg-vermilion-500" sub={`${plan.selectedCount} khoản · P1 ${fmtVND(plan.byPriority.P1)}`} />
          <Metric label="Số dư sau chi" short="Sau chi" value={after} tone={short || plan.balance < 0 ? 'text-rose-600' : 'text-jade-700'} dot={short || plan.balance < 0 ? 'bg-rose-500' : 'bg-jade-500'} sub={sub} />
        </div>
        <p className="sm:hidden border-t border-slate-100 px-3 py-1.5 text-[11px] text-slate-500 truncate">{sub}</p>
        <div className="hidden md:flex items-center gap-2 border-l border-slate-100 px-3 py-2">
          <Button variant="orchid" size="sm" icon={Lock} onClick={onLock} title="Chốt kế hoạch tháng">
            <span className="xl:hidden">Chốt tháng</span>
            <span className="hidden xl:inline">Chốt kế hoạch tháng</span>
          </Button>
          <div className="inline-flex rounded-lg border border-slate-200 overflow-hidden" role="group" aria-label="Xuất báo cáo">
            <button type="button" onClick={onPdf} disabled={exporting} title="Xuất PDF" className="inline-flex h-8 items-center gap-1.5 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <Printer className="h-4 w-4" /> <span className="hidden xl:inline">PDF</span>
            </button>
            <button type="button" onClick={onExcel} title="Xuất Excel" className="inline-flex h-8 items-center gap-1.5 border-l border-slate-200 px-2.5 text-xs font-medium text-slate-700 hover:bg-slate-50">
              <FileSpreadsheet className="h-4 w-4" /> <span className="hidden xl:inline">Excel</span>
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
  AP: { label: 'Công nợ NCC' },
  LOAN: { label: 'Đáo hạn NH' },
  INTEREST: { label: 'Lãi vay NH' },
  INTERNAL: { label: 'Chi nội bộ' },
  CUSTOM: { label: 'Chi cố định' },
};

const GROUP_STYLE = {
  P1: { dot: 'bg-rose-500', title: 'Bắt buộc trả', seg: 'bg-rose-600 text-white' },
  P2: { dot: 'bg-orange-400', title: 'Quan trọng', seg: 'bg-orange-500 text-white' },
  P3: { dot: 'bg-slate-300', title: 'Có thể giãn', seg: 'bg-slate-600 text-white' },
};

export const FILTERS = [
  { value: 'ALL', label: 'Tất cả' },
  { value: 'SELECTED', label: 'Đang chi' },
  { value: 'P1', label: 'P1' },
  { value: 'BANK', label: 'Ngân hàng' },
  { value: 'INTERNAL', label: 'Nội bộ' },
];

export function matchFilter(r, f) {
  if (f === 'SELECTED') return r.selected;
  if (f === 'P1') return r.priority === 'P1';
  if (f === 'BANK') return r.kind === 'LOAN' || r.kind === 'INTEREST';
  if (f === 'INTERNAL') return r.kind === 'INTERNAL';
  return true;
}

const todayIso = () => new Date().toISOString().slice(0, 10);
const num = (v) => Math.round(Number(v) || 0);
const rowTitle = (r) => (r.kind === 'CUSTOM' || r.kind === 'INTERNAL' ? r.label : r.partner);

/** Dòng phụ: loại · trạng thái duyệt · hạn — chỉ những gì có nghĩa */
function rowMeta(r) {
  const parts = [];
  parts.push({ text: r.kind === 'CUSTOM' ? r.category || KIND_TAG.CUSTOM.label : KIND_TAG[r.kind]?.label || '' });
  if (r.approval) parts.push({ text: 'Đã duyệt chi', cls: 'text-jade-700 font-medium' });
  if (r.dueDate) {
    const d = daysBetween(todayIso(), r.dueDate);
    if (d < 0) parts.push({ text: `quá hạn ${-d} ngày`, cls: 'text-rose-600 font-medium' });
    else if (d <= 7) parts.push({ text: d === 0 ? 'hạn hôm nay' : `còn ${d} ngày`, cls: 'text-amber-700' });
  }
  const note = r.kind === 'AP' ? (r.label && r.label !== 'Công nợ phải trả' ? r.label : '') : r.kind === 'INTERNAL' ? r.partner : r.kind === 'CUSTOM' ? '' : r.label;
  if (note) parts.push({ text: note, cls: 'hidden md:inline' });
  return parts;
}

function Meta({ row }) {
  return (
    <p className="mt-0.5 text-xs text-slate-500 truncate">
      {rowMeta(row).map((p, i) => (
        <span key={i} className={p.cls}>
          {i > 0 && <span className="mx-1 text-slate-300">·</span>}
          {p.text}
        </span>
      ))}
    </p>
  );
}

function PayMark({ row, onToggle }) {
  if (row.locked)
    return (
      <span className="grid h-5 w-5 place-items-center rounded-full bg-jade-600 text-white" title="Đã duyệt chi — luôn nằm trong đợt chi. Muốn bỏ thì hủy duyệt chi.">
        <Check className="h-3 w-3" strokeWidth={3} />
      </span>
    );
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={!!row.selected}
      onClick={(e) => {
        e.stopPropagation();
        onToggle(row.key, !row.selected);
      }}
      className={cx(
        'grid h-5 w-5 place-items-center rounded-full border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-sapphire-400',
        row.selected ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-300 bg-white text-transparent hover:border-slate-500',
      )}
      title={row.selected ? 'Đang chi — bấm để tạm hoãn' : 'Tạm hoãn — bấm để chi đợt này'}
      aria-label={`Chi đợt này: ${rowTitle(row)}`}
    >
      <Check className="h-3 w-3" strokeWidth={3} />
    </button>
  );
}

/* Lưới cột máy tính: chọn | khoản chi | hạn | còn phải trả | chi đợt này | mở */
const COLS = 'md:grid-cols-[24px_minmax(0,1fr)_96px_132px_156px_24px]';

function PlanRow({ row, onToggle, onAmount, onOpen, rowRef, style, dragging, handleProps, canDrag }) {
  const editable = row.selected && !row.locked && row.kind !== 'INTERNAL';
  const partial = row.selected && num(row.amount) < num(row.outstanding);
  const open = () => onOpen(row);
  return (
    <li
      ref={rowRef}
      style={style}
      onClick={(e) => {
        // Điện thoại: chạm cả dòng để mở chi tiết; máy tính: chỉ mở khi bấm vào tên
        if (window.matchMedia('(min-width: 768px)').matches) return;
        if (e.target.closest('input,button,label')) return;
        open();
      }}
      className={cx(
        'group relative grid grid-cols-[24px_minmax(0,1fr)_auto] items-center gap-x-3 px-4 md:pl-8 md:pr-4 py-3 bg-white cursor-pointer md:cursor-default',
        COLS,
        dragging && 'shadow-lg ring-1 ring-slate-200 rounded-lg z-10',
      )}
    >
      {canDrag && (
        <button
          type="button"
          {...handleProps}
          style={{ touchAction: 'none' }}
          className="absolute left-1.5 top-1/2 -translate-y-1/2 hidden md:grid h-7 w-5 place-items-center rounded text-slate-300 opacity-0 group-hover:opacity-100 focus:opacity-100 hover:text-slate-600 cursor-grab active:cursor-grabbing"
          aria-label="Kéo để đổi thứ tự"
          title="Kéo để đổi thứ tự trong nhóm"
        >
          <GripVertical className="h-4 w-4" />
        </button>
      )}

      <PayMark row={row} onToggle={onToggle} />

      <button type="button" onClick={open} className="min-w-0 text-left md:cursor-pointer">
        <span className={cx('block truncate text-[15px] font-semibold leading-snug', row.selected ? 'text-ink-900' : 'text-slate-400')}>{rowTitle(row)}</span>
        <Meta row={row} />
      </button>

      {/* Điện thoại: chỉ một con số bên phải */}
      <div className="md:hidden text-right">
        {row.selected ? (
          <>
            <Money value={row.amount} unit={false} className="block text-[15px] font-semibold text-ink-900" />
            {partial && (
              <span className="block text-[11px] text-slate-400">
                / <Money value={row.outstanding} compact />
              </span>
            )}
          </>
        ) : (
          <span className="text-sm text-slate-400">Hoãn</span>
        )}
      </div>

      {/* Máy tính */}
      <span className="hidden md:block text-sm tabular-nums text-slate-500">
        {row.dueDate ? fmtDate(row.dueDate) : <span className="text-slate-300">—</span>}
      </span>
      <Money value={row.outstanding} unit={false} className="hidden md:block text-right text-sm text-slate-400" />
      <div className="hidden md:block">
        {editable ? (
          <MoneyInput
            value={row.amount}
            onChange={(v) => onAmount(row.key, v)}
            unit={false}
            showHint={false}
            className="!h-9 !border-transparent !bg-transparent font-semibold text-ink-900 hover:!border-slate-200 focus:!border-sapphire-400 focus:!bg-white"
            aria-label={`Chi đợt này — ${rowTitle(row)}`}
          />
        ) : (
          <span className={cx('block pr-3 text-right text-sm', row.selected ? 'font-semibold text-ink-900' : 'text-slate-400')}>
            {row.selected ? <Money value={row.amount} unit={false} /> : 'Hoãn'}
          </span>
        )}
      </div>
      <button type="button" onClick={open} className="hidden md:grid h-7 w-6 place-items-center rounded text-slate-300 hover:text-ink-900" aria-label="Xem chi tiết">
        <ChevronRight className="h-4 w-4" />
      </button>
    </li>
  );
}

function CreditLine() {
  return (
    <li className="flex items-center gap-3 px-4 md:pl-8 py-1.5 bg-white" aria-label="Từ đây phải dùng hạn mức vay">
      <span className="h-px flex-1 border-t border-dashed border-sapphire-300" />
      <span className="text-[11px] font-medium text-sapphire-700 whitespace-nowrap">Từ đây phải dùng hạn mức vay</span>
      <span className="h-px flex-1 border-t border-dashed border-sapphire-300" />
    </li>
  );
}

function PriorityGroup({ p, rows, total, count, collapsed, onCollapse, sortable, canDrag, handlers }) {
  const st = GROUP_STYLE[p];
  return (
    <div>
      <button type="button" onClick={onCollapse} className="flex w-full items-center gap-2.5 px-4 md:pl-8 py-2.5 bg-slate-50 text-left" aria-expanded={!collapsed}>
        <span className={cx('h-2.5 w-2.5 rounded-full', st.dot)} />
        <span className="text-sm font-semibold text-ink-900">
          {p} <span className="font-normal text-slate-500">· {st.title}</span>
        </span>
        <span className="text-xs text-slate-400">{count} khoản</span>
        <Money value={total} unit={false} className="ml-auto text-sm font-semibold text-ink-900" />
        <ChevronDown className={cx('h-4 w-4 text-slate-400 transition-transform', collapsed && '-rotate-90')} />
      </button>
      {!collapsed && rows.length > 0 && (
        <ul className="divide-y divide-slate-100">
          {rows.map((r, i) => [
            r.crossing ? <CreditLine key={`${r.key}-credit`} /> : null,
            <PlanRow
              key={r.key}
              row={r}
              {...handlers}
              canDrag={canDrag}
              rowRef={sortable.setRef(r.key)}
              style={sortable.styleFor(r.key, i)}
              dragging={sortable.draggingKey === r.key}
              handleProps={sortable.handleProps(r.key)}
            />,
          ])}
        </ul>
      )}
      {!collapsed && rows.length === 0 && <p className="px-4 md:pl-8 py-3 text-xs text-slate-400">Không có khoản nào.</p>}
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
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="grid h-8 w-8 place-items-center rounded-lg text-slate-500 hover:bg-slate-100 hover:text-ink-900"
        aria-label="Thêm thao tác"
        aria-expanded={open}
      >
        <EllipsisVertical className="h-4 w-4" />
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 w-64 rounded-xl border border-slate-200 bg-white p-1 shadow-xl">
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
  const visibleGroups = (filter === 'P1' ? ['P1'] : ['P1', 'P2', 'P3']).filter((p) => groups[p].length > 0 || filter === 'ALL');
  return (
    <section className="mt-4 rounded-2xl bg-white border border-slate-200/80 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2.5 border-b border-slate-100">
        <div className="flex flex-1 min-w-0 gap-1 overflow-x-auto thin-scroll" role="tablist" aria-label="Lọc khoản chi">
          {FILTERS.map((f) => (
            <button
              key={f.value}
              type="button"
              role="tab"
              aria-selected={filter === f.value}
              onClick={() => setFilter(f.value)}
              className={cx(
                'h-8 shrink-0 rounded-lg px-2.5 text-[13px] font-medium transition-colors',
                filter === f.value ? 'bg-ink-900 text-white' : 'text-slate-600 hover:bg-slate-100',
              )}
            >
              {f.label}
              <span className={cx('ml-1 tabular-nums text-xs', filter === f.value ? 'text-white/60' : 'text-slate-400')}>{counts[f.value]}</span>
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={onAddFixed}
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 px-2.5 text-[13px] font-medium text-ink-900 hover:bg-slate-50"
        >
          <Plus className="h-4 w-4" />
          <span className="hidden sm:inline">Thêm khoản chi</span>
        </button>
        <MoreMenu
          items={[
            { label: 'Thêm khoản chi cố định', icon: Plus, onClick: onAddFixed },
            { label: 'Thêm công nợ chưa đến hạn', icon: ListPlus, onClick: onExtraAp },
            { label: 'Sắp xếp lại theo ưu tiên & hạn', icon: ArrowDownWideNarrow, onClick: onSort },
            { label: 'Làm lại bảng tháng này', icon: RotateCcw, onClick: onReset, danger: true },
          ]}
        />
      </div>

      <div className={cx('hidden md:grid gap-x-3 pl-8 pr-4 py-2 text-xs text-slate-400 border-b border-slate-100', COLS)}>
        <span />
        <span>Khoản chi</span>
        <span>Hạn</span>
        <span className="text-right">Còn phải trả</span>
        <span className="text-right pr-3">Chi đợt này</span>
        <span />
      </div>

      {plan.rows.length === 0 ? (
        <EmptyState icon={BadgeCheck} title="Chưa có khoản phải trả nào trong tháng" description="Thêm lương, thuế / BHXH, chi phí vận hành… bằng nút “Thêm khoản chi”." />
      ) : visibleGroups.length === 0 ? (
        <p className="px-4 py-6 text-center text-sm text-slate-500">Không có khoản nào khớp bộ lọc.</p>
      ) : (
        <div className="divide-y divide-slate-100">
          {visibleGroups.map((p) => {
            const all = plan.rows.filter((r) => r.priority === p);
            const sel = all.filter((r) => r.selected);
            return (
              <PriorityGroup
                key={p}
                p={p}
                rows={groups[p]}
                total={sel.reduce((s, r) => s + num(r.amount), 0)}
                count={all.length}
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
      <p className="px-4 md:pl-8 py-2.5 text-[11px] text-slate-400 border-t border-slate-100">Số tiền tính bằng đồng. Bấm vào một khoản để đổi số tiền chi, mức ưu tiên, ghi chú.</p>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/*  Ngăn chi tiết một khoản chi (điện thoại: trượt lên từ dưới)        */
/* ------------------------------------------------------------------ */
function Info({ label, children }) {
  return (
    <div className="flex justify-between gap-3 py-1.5 text-sm">
      <span className="text-slate-500">{label}</span>
      <span className="text-right text-slate-800 min-w-0">{children}</span>
    </div>
  );
}

function Block({ title, children }) {
  return (
    <section className="py-4 first:pt-0">
      {title && <p className="mb-2 text-sm font-semibold text-ink-900">{title}</p>}
      {children}
    </section>
  );
}

export function RowDrawer({ row, onClose, data, note, onNote, onApprove, onRemove, supplier, internal, onToggle, onAmount, onQuick, onPriority }) {
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [row?.key]);
  if (!row) return null;
  const debt = row.kind === 'AP' ? data.ap.find((x) => x.id === row.refId) : null;
  const loan = row.kind === 'LOAN' ? data.loans.find((x) => x.id === row.refId) : null;
  const approvals = row.kind === 'AP' ? (data.approvals || []).filter((a) => a.payableId === row.refId).sort((a, b) => (b.approvedOn || '').localeCompare(a.approvedOn || '')) : [];
  const tone = row.kind === 'AP' ? 'vermilion' : row.kind === 'INTERNAL' ? 'amber' : row.kind === 'CUSTOM' ? 'orchid' : 'sapphire';
  const editable = !row.locked && row.kind !== 'INTERNAL';
  const saveNote = () => {
    if ((text || '') !== (note || '')) onNote(row.key, text.trim().slice(0, 1000));
  };
  const close = () => {
    saveNote();
    onClose();
  };
  return (
    <Drawer
      open
      onClose={close}
      tone={tone}
      icon={row.kind === 'INTERNAL' ? ReceiptText : row.kind === 'AP' ? Stamp : row.kind === 'CUSTOM' ? Vault : Landmark}
      title={rowTitle(row)}
      subtitle={`${row.kind === 'CUSTOM' ? row.category || 'Chi cố định' : KIND_TAG[row.kind]?.label} · ${row.dueDate ? `hạn ${fmtDate(row.dueDate)}` : 'trong tháng'}`}
      hero={
        <div className="grid grid-cols-2 gap-3">
          <div>
            <p className="text-[11px] text-white/75">Chi đợt này</p>
            <p className="font-display text-2xl font-bold tabular-nums">{row.selected ? fmtNum(row.amount) : 'Hoãn'}</p>
          </div>
          <div>
            <p className="text-[11px] text-white/75">Còn phải trả</p>
            <p className="font-display text-2xl font-bold tabular-nums">{fmtNum(row.outstanding)}</p>
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
          <Button variant="primary" onClick={close}>
            Xong
          </Button>
        </div>
      }
    >
      <div className="divide-y divide-slate-100">
        <Block>
          {row.locked ? (
            <p className="rounded-xl bg-jade-50 px-3 py-2.5 text-sm text-jade-800">
              Đã duyệt chi <b>{fmtVND(row.amount)}</b> — khoản này luôn nằm trong đợt chi. Muốn đổi số tiền hoặc bỏ, bấm “Sửa duyệt chi”.
            </p>
          ) : (
            <>
              <button type="button" role="switch" aria-checked={!!row.selected} onClick={() => onToggle(row.key, !row.selected)} className="flex w-full items-center justify-between gap-3 text-left">
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-ink-900">Chi trong đợt này</span>
                  <span className="block text-xs text-slate-500">Tắt để tạm hoãn sang đợt sau</span>
                </span>
                <span className={cx('relative h-6 w-11 shrink-0 rounded-full transition-colors', row.selected ? 'bg-ink-900' : 'bg-slate-300')}>
                  <span className={cx('absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all', row.selected ? 'left-[22px]' : 'left-0.5')} />
                </span>
              </button>
              {row.selected && editable && (
                <div className="mt-3">
                  <MoneyInput value={row.amount} onChange={(v) => onAmount(row.key, v)} className="!h-12 !text-lg font-semibold" aria-label="Số tiền chi đợt này" />
                  <div className="mt-2 flex gap-2">
                    {[25, 50, 100].map((pct) => {
                      const target = pct >= 100 ? num(row.outstanding) : Math.round((num(row.outstanding) * pct) / 100 / 1000) * 1000;
                      const on = num(row.amount) === target;
                      return (
                        <button
                          key={pct}
                          type="button"
                          onClick={() => onQuick(row, pct)}
                          className={cx('h-8 flex-1 rounded-lg border text-xs font-semibold', on ? 'border-ink-900 bg-ink-900 text-white' : 'border-slate-200 text-slate-600 hover:border-slate-400')}
                        >
                          {pct === 100 ? 'Trả hết' : `${pct}%`}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              {row.kind === 'INTERNAL' && <p className="mt-2 text-xs text-slate-500">Số tiền lấy tự động từ các chứng từ đã duyệt, chưa kết chuyển.</p>}
            </>
          )}
        </Block>

        <Block title="Mức ưu tiên">
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1">
            {['P1', 'P2', 'P3'].map((p) => (
              <button
                key={p}
                type="button"
                disabled={row.kind === 'INTERNAL'}
                onClick={() => onPriority(row.key, p)}
                className={cx(
                  'h-11 rounded-lg text-sm font-semibold transition-colors disabled:cursor-not-allowed',
                  row.priority === p ? GROUP_STYLE[p].seg : 'text-slate-600 hover:bg-white',
                )}
              >
                <span className="block leading-tight">{p}</span>
                <span className="block text-[10px] font-normal leading-tight opacity-80">{GROUP_STYLE[p].title}</span>
              </button>
            ))}
          </div>
        </Block>

        {row.kind === 'AP' && (
          <Block title="Nhà cung cấp">
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
          </Block>
        )}
        {row.kind === 'LOAN' && loan && (
          <Block title="Khoản vay">
            <Info label="Khế ước">{loan.contractNo}</Info>
            <Info label="Giải ngân">{fmtDate(loan.disbursedDate)}</Info>
            <Info label="Đáo hạn">{fmtDate(loan.maturityDate)}</Info>
            <Info label="Lãi suất">{loan.interestRate}%/năm</Info>
          </Block>
        )}
        {row.kind === 'INTEREST' && (
          <Block>
            <p className="text-sm text-slate-600">Lãi vay ước tính theo số ngày thực tế của các khế ước đang vay tại {row.partner}.</p>
          </Block>
        )}

        {row.kind === 'INTERNAL' && internal && (
          <Block title="Chứng từ nội bộ">
            <p className="mb-3 text-sm text-slate-600">
              Chờ kết xuất: chi <b>{fmtVND(internal.pendingOut)}</b>
              {internal.pendingIn > 0 && <>, thu {fmtVND(internal.pendingIn)}</>}. Phần đã kết chuyển trong tháng ({fmtVND(internal.postedOut)}) đã trừ vào tồn két nên không cộng lại.
            </p>
            <div className="space-y-3">
              <VoucherList title="Chờ kết xuất (tính vào dự chi)" list={internal.pending} />
              <VoucherList title="Đã kết chuyển trong tháng" list={internal.posted} muted />
            </div>
          </Block>
        )}

        <Block title="Ghi chú kế hoạch">
          <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} onBlur={saveNote} placeholder="VD: Đã hẹn NCC chuyển 50% trước ngày 25" />
        </Block>

        {row.kind === 'AP' && (
          <Block title="Lịch sử thanh toán & duyệt chi">
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
          </Block>
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
