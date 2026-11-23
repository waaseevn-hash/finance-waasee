import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { collection, doc, getDocs, onSnapshot, query, serverTimestamp, setDoc, where } from 'firebase/firestore';
import {
  ArrowDownWideNarrow,
  BadgeCheck,
  CalendarRange,
  CircleArrowDown,
  CircleCheck,
  CloudUpload,
  Eye,
  GripVertical,
  Landmark,
  ListPlus,
  Lock,
  Plus,
  Printer,
  RefreshCw,
  RotateCcw,
  Scale,
  Send,
  Stamp,
  Wallet,
  Trash2,
  TriangleAlert,
  Vault,
  X,
} from 'lucide-react';
import { db } from '../lib/firebase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { AuditedBatch, C, friendlyError } from '../lib/db.js';
import {
  PAY_GROUP,
  bankSummary,
  byPriorityThenDue,
  cashBalance,
  computePlan,
  computeVariance,
  mergePlanRows,
  varianceWindow,
  planCandidates,
  planReceivables,
  remaining,
} from '../lib/calc.js';
import { currentMonth, daysBetween, describeDays, fmtDate, fmtDateTime, monthLabel, monthRange, todayISO } from '../lib/dates.js';
import { fmtPct, fmtVND } from '../lib/format.js';
import { CERTAINTY, FIXED_CATEGORIES, PRIORITY } from '../lib/constants.js';
import { can } from '../lib/roles.js';
import { Money, MoneyInput } from '../components/Money.jsx';
import { useConfirm, useToast } from '../components/feedback.jsx';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  MonthPicker,
  PageHeader,
  Select,
  TableWrap,
  Toggle,
  cx,
  td,
  th,
} from '../components/ui.jsx';
import PlanReport from './PlanReport.jsx';
import { SupplierInfo, findSupplier, payToText } from '../components/forms/supplierForms.jsx';
import { useQuick } from '../components/QuickPanels.jsx';
import { useApprovalFlow } from '../components/forms/approvalForms.jsx';
import { Who, useNames } from '../components/Who.jsx';
import { resolveNames } from '../lib/runtime.js';
import { exportReport } from '../lib/exportReport.js';

const arrayMove = (a, from, to) => {
  const r = a.slice();
  const [x] = r.splice(from, 1);
  r.splice(to, 0, x);
  return r;
};

/** Kéo-thả sắp xếp danh sách bằng Pointer Events (chuột + cảm ứng) và phím mũi tên */
function useSortableList(keys, onMove) {
  const [drag, setDragState] = useState(null);
  const dragRef = useRef(null);
  const setDrag = (d) => {
    dragRef.current = d;
    setDragState(d);
  };
  const refs = useRef(new Map());
  const setRef = (key) => (el) => {
    if (el) refs.current.set(key, el);
    else refs.current.delete(key);
  };
  const handleProps = (key) => ({
    onPointerDown: (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      const rects = keys.map((k) => refs.current.get(k)?.getBoundingClientRect());
      if (rects.some((r) => !r)) return;
      e.preventDefault();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      const from = keys.indexOf(key);
      setDrag({ key, from, over: from, startY: e.clientY, dy: 0, rects, h: rects[from].height });
    },
    onPointerMove: (e) => {
      const d = dragRef.current;
      if (!d) return;
      const dy = e.clientY - d.startY;
      const center = d.rects[d.from].top + d.rects[d.from].height / 2 + dy;
      let over = 0;
      d.rects.forEach((r, i) => {
        if (i !== d.from && r.top + r.height / 2 < center) over += 1;
      });
      setDrag({ ...d, dy, over });
    },
    onPointerUp: () => {
      const d = dragRef.current;
      setDrag(null);
      if (d && d.over !== d.from) onMove(d.from, d.over);
    },
    onPointerCancel: () => setDrag(null),
    onKeyDown: (e) => {
      const i = keys.indexOf(key);
      if (e.key === 'ArrowUp' && i > 0) {
        e.preventDefault();
        onMove(i, i - 1);
      } else if (e.key === 'ArrowDown' && i < keys.length - 1) {
        e.preventDefault();
        onMove(i, i + 1);
      }
    },
  });
  const styleFor = (key, i) => {
    if (!drag) return undefined;
    if (key === drag.key) return { transform: `translateY(${drag.dy}px)`, zIndex: 30, position: 'relative', transition: 'none' };
    let shift = 0;
    if (drag.from < drag.over && i > drag.from && i <= drag.over) shift = -drag.h;
    if (drag.from > drag.over && i >= drag.over && i < drag.from) shift = drag.h;
    return { transform: `translateY(${shift}px)`, transition: 'transform 150ms ease' };
  };
  return { setRef, handleProps, styleFor, draggingKey: drag?.key || null };
}

const rid = () => Math.random().toString(36).slice(2, 10);
const pick = (o, keys) => Object.fromEntries(keys.map((k) => [k, o[k] === undefined ? null : o[k]]));

function newDraft(month, templates = []) {
  return {
    month,
    reserve: 0,
    includeDeposits: true,
    ar: {},
    extraAr: [],
    items: {},
    extraAp: [],
    custom: templates.map((t) => ({ key: `cus_${rid()}`, label: t.label, category: t.category, amount: t.amount, priority: t.priority })),
    order: [],
    rev: 0,
  };
}

function normalizeDraft(d, month) {
  const base = newDraft(month);
  return {
    ...base,
    ...d,
    month,
    ar: d.ar || {},
    extraAr: d.extraAr || [],
    items: d.items || {},
    extraAp: d.extraAp || [],
    custom: d.custom || [],
    order: d.order || [],
    rev: d.rev || 0,
  };
}

function serialize(d) {
  return pick(d, ['month', 'reserve', 'includeDeposits', 'ar', 'extraAr', 'items', 'extraAp', 'custom', 'order']);
}

const KIND_TAG = {
  AP: { label: 'Công nợ', tone: 'orange' },
  LOAN: { label: 'Đáo hạn NH', tone: 'blue' },
  INTEREST: { label: 'Lãi vay', tone: 'blue' },
  CUSTOM: { label: 'Chi cố định', tone: 'violet' },
};

const PRIO_ACTIVE = { P1: 'bg-rose-600 text-white shadow-sm', P2: 'bg-orange-500 text-white shadow-sm', P3: 'bg-slate-500 text-white shadow-sm' };

/** Đổi nhãn ưu tiên bằng 1 chạm */
function PriorityPicker({ value, onChange }) {
  return (
    <div className="inline-flex h-9 w-fit gap-0.5 rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Mức ưu tiên">
      {['P1', 'P2', 'P3'].map((p) => (
        <button
          key={p}
          type="button"
          role="radio"
          aria-checked={value === p}
          title={PRIORITY[p].label + ' — ' + PRIORITY[p].hint}
          onClick={() => onChange(p)}
          className={cx('w-[30px] rounded-md text-xs font-bold transition-colors', value === p ? PRIO_ACTIVE[p] : 'text-slate-400 hover:bg-white hover:text-slate-700')}
        >
          {p}
        </button>
      ))}
    </div>
  );
}

/* =========================== Dòng phải trả (kéo-thả) =========================== */
function PayRow({ row, index, onToggle, onAmount, onMode, onPriority, onRemove, onApprove, itemRef, style, isDragging, handleProps, supplier }) {
  const days = row.dueDate ? daysBetween(todayISO(), row.dueDate) : null;
  const over = row.amount > row.outstanding;
  const removable = row.kind === 'CUSTOM' || row.extra;
  const isDebt = row.kind === 'AP' || row.kind === 'LOAN';

  return (
    <li
      ref={itemRef}
      style={style}
      className={cx(
        'bg-white px-2 sm:px-3 py-2.5 border-b border-slate-100 last:border-0',
        isDragging && 'shadow-xl ring-1 ring-orchid-200 rounded-xl',
        !row.selected && 'bg-slate-50/70',
        row.overflow && 'bg-rose-50/80',
      )}
    >
      <div className="flex items-start gap-2">
        <button
          type="button"
          {...handleProps}
          style={{ touchAction: 'none' }}
          className="mt-1 grid h-8 w-6 shrink-0 cursor-grab place-items-center rounded text-slate-300 hover:text-slate-600 active:cursor-grabbing"
          title="Kéo để đổi thứ tự ưu tiên (hoặc chọn rồi bấm phím ↑ ↓)"
          aria-label="Kéo để đổi thứ tự"
        >
          <GripVertical className="h-4 w-4" />
        </button>
        <div className="mt-2">
          <Checkbox
            checked={row.selected}
            onChange={(v) => onToggle(row.key, v)}
            disabled={row.locked}
            title={row.locked ? 'Đã duyệt chi — muốn bỏ thì hủy duyệt chi' : 'Chọn chi tháng này'}
          />
        </div>
        <div className="min-w-0 flex-1 grid grid-cols-[100px_minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_100px_210px_150px] gap-x-3 gap-y-2 items-center">
          <div className="min-w-0 col-span-2 lg:col-span-1">
            <p className={cx('text-sm font-medium truncate', row.selected ? 'text-ink-900' : 'text-slate-400 line-through decoration-slate-300')}>
              <span className="mr-1.5 text-xs font-semibold text-slate-400 tabular-nums">#{index + 1}</span>
              {row.label}
            </p>
            <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-slate-500">
              {row.kind !== 'CUSTOM' && <span className="truncate max-w-[200px]">{row.partner}</span>}
              <Badge tone={KIND_TAG[row.kind].tone}>{row.kind === 'CUSTOM' ? row.category : KIND_TAG[row.kind].label}</Badge>
              {row.dueDate && <Badge tone={days < 0 ? 'red' : days <= 7 ? 'amber' : 'slate'}>{`${fmtDate(row.dueDate)} · ${describeDays(days)}`}</Badge>}
              <span>
                {isDebt ? 'Còn nợ' : 'Dự kiến'} <Money value={row.outstanding} className="font-medium text-slate-600" />
              </span>
            </div>
            {row.kind === 'AP' && <SupplierInfo supplier={supplier || { name: row.partner }} compact className="mt-0.5" />}
            {row.kind === 'AP' && onApprove && (
              <div className="mt-1 flex flex-wrap items-center gap-2">
                {row.approval ? (
                  <>
                    <Badge tone="green" icon={BadgeCheck}>
                      Đã duyệt {row.approval.mode === 'FULL' ? 'chi hết' : 'chi 1 phần'}
                      {row.approval.approvedOn ? ` · ${fmtDate(row.approval.approvedOn)}` : ''}
                    </Badge>
                    <button type="button" onClick={() => onApprove(row)} className="text-[11px] font-semibold text-slate-500 hover:text-ink-900 hover:underline">
                      Sửa duyệt
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => onApprove(row)}
                    className="inline-flex items-center gap-1 rounded-md bg-vermilion-50 px-2 py-0.5 text-[11px] font-semibold text-vermilion-700 hover:bg-vermilion-100"
                  >
                    <Stamp className="h-3 w-3" /> Duyệt chi
                  </button>
                )}
              </div>
            )}
          </div>
          <PriorityPicker value={row.priority} onChange={(p) => onPriority(row.key, p)} />
          <div className="space-y-1.5">
            {isDebt && (
              <div className="grid grid-cols-2 gap-0.5 rounded-lg bg-slate-100 p-0.5" role="radiogroup" aria-label="Hình thức trả">
                {[
                  ['FULL', 'Trả toàn bộ'],
                  ['PART', 'Trả 1 phần'],
                ].map(([m, label]) => (
                  <button
                    key={m}
                    type="button"
                    role="radio"
                    aria-checked={row.mode === m}
                    disabled={!row.selected || row.locked}
                    onClick={() => onMode(row.key, m, row)}
                    className={cx(
                      'h-7 rounded-md text-[11.5px] font-semibold transition-colors disabled:opacity-50',
                      row.mode === m ? (m === 'FULL' ? 'bg-orchid-600 text-white shadow-sm' : 'bg-amber-500 text-white shadow-sm') : 'text-slate-500 hover:bg-white',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            )}
            <MoneyInput
              value={row.amount}
              onChange={(v) => onAmount(row.key, v, row.outstanding)}
              showHint={false}
              className="!h-9"
              disabled={!row.selected || row.locked || (isDebt && row.mode === 'FULL')}
            />
            {isDebt && row.mode === 'PART' && row.selected && (
              <p className="text-[11px] text-right text-slate-500">
                Còn nợ lại <Money value={row.remainingAfter} className="font-semibold text-amber-700" />
              </p>
            )}
            {over && <p className="text-[11px] text-amber-700 text-right">Lớn hơn số còn nợ</p>}
          </div>
          <div className="col-span-2 lg:col-span-1 flex items-center justify-between lg:justify-end gap-2">
            <span className="lg:hidden text-xs text-slate-400">Số dư sau khoản này</span>
            <span className="text-right">
              {row.selected ? (
                <Money value={row.runningAfter} className={cx('text-sm font-semibold', row.runningAfter < 0 ? 'text-rose-600' : 'text-jade-700')} />
              ) : (
                <span className="text-xs text-slate-400">Tạm hoãn</span>
              )}
            </span>
            {removable ? (
              <button type="button" onClick={() => onRemove(row)} className="grid h-7 w-7 shrink-0 place-items-center rounded-md text-slate-300 hover:bg-rose-50 hover:text-rose-600" title="Bỏ khỏi bảng">
                <X className="h-4 w-4" />
              </button>
            ) : (
              <span className="hidden lg:block h-7 w-7 shrink-0" />
            )}
          </div>
        </div>
      </div>
    </li>
  );
}

/* =========================== Modal: thêm khoản chi cố định =========================== */
function AddFixedModal({ open, onClose, onAdd, templates, onSaveTemplates }) {
  const [f, setF] = useState(null);
  useEffect(() => {
    if (open) setF({ category: 'Lương', label: 'Lương nhân viên', amount: 0, priority: 'P1', saveTemplate: true });
  }, [open]);
  if (!open || !f) return null;
  const setCat = (category) => {
    const c = FIXED_CATEGORIES.find((x) => x.value === category);
    setF((x) => ({ ...x, category, label: c?.label || x.label, priority: c?.priority || x.priority }));
  };
  const submit = (e) => {
    e.preventDefault();
    if (!f.label.trim() || !(f.amount > 0)) return;
    onAdd({ key: `cus_${rid()}`, label: f.label.trim(), category: f.category, amount: Math.round(f.amount), priority: f.priority }, f.saveTemplate);
    onClose();
  };
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Thêm khoản chi cố định"
      subtitle="Lương, Thuế/BHXH, Lãi vay/Đáo hạn NH, Chi phí vận hành…"
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button type="submit" form="fixed-form" variant="primary" icon={Plus} disabled={!(f.amount > 0) || !f.label.trim()}>
            Thêm vào bảng
          </Button>
        </>
      }
    >
      <form id="fixed-form" onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Nhóm chi">
          <Select value={f.category} onChange={(e) => setCat(e.target.value)}>
            {FIXED_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Mức ưu tiên">
          <Select value={f.priority} onChange={(e) => setF((x) => ({ ...x, priority: e.target.value }))}>
            {Object.entries(PRIORITY).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Tên khoản chi" className="sm:col-span-2">
          <Input value={f.label} onChange={(e) => setF((x) => ({ ...x, label: e.target.value }))} />
        </Field>
        <Field label="Số tiền dự kiến" className="sm:col-span-2">
          <MoneyInput value={f.amount} onChange={(v) => setF((x) => ({ ...x, amount: v }))} autoFocus />
        </Field>
        <Checkbox
          className="sm:col-span-2"
          checked={f.saveTemplate}
          onChange={(v) => setF((x) => ({ ...x, saveTemplate: v }))}
          label="Lưu làm mẫu — tự động thêm vào kế hoạch các tháng sau"
        />
      </form>
      {templates.length > 0 && (
        <div className="mt-5">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">Mẫu chi cố định hàng tháng đã lưu</p>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
            {templates.map((t, i) => (
              <li key={`${t.label}-${i}`} className="flex items-center gap-3 px-3 py-2 text-sm">
                <Badge tone={PRIORITY[t.priority]?.tone}>{t.priority}</Badge>
                <span className="flex-1 truncate">{t.label}</span>
                <Money value={t.amount} className="font-medium" />
                <Button size="iconSm" variant="ghost" icon={Trash2} title="Xóa mẫu" onClick={() => onSaveTemplates(templates.filter((_, j) => j !== i))} />
              </li>
            ))}
          </ul>
        </div>
      )}
    </Modal>
  );
}

/* =========================== Modal: thêm khoản chưa đến hạn =========================== */
function PickExtraModal({ open, onClose, title, items, onAdd, amountLabel }) {
  const [sel, setSel] = useState({});
  useEffect(() => {
    if (open) setSel({});
  }, [open]);
  if (!open) return null;
  const ids = Object.keys(sel).filter((k) => sel[k]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button
            variant="primary"
            disabled={!ids.length}
            onClick={() => {
              onAdd(ids);
              onClose();
            }}
          >
            Thêm {ids.length || ''} khoản
          </Button>
        </>
      }
    >
      {items.length === 0 ? (
        <EmptyState title="Không còn khoản nào khác" description="Tất cả công nợ còn lại đã có trong bảng." />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {items.map((r) => (
            <li key={r.id} className="flex items-center gap-3 px-3 py-2.5">
              <Checkbox checked={!!sel[r.id]} onChange={(v) => setSel((s) => ({ ...s, [r.id]: v }))} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800 truncate">{r.partnerName}</p>
                <p className="text-xs text-slate-500 truncate">
                  {r.description} {r.dueDate ? `· hạn ${fmtDate(r.dueDate)}` : '· chưa có hạn'}
                </p>
              </div>
              <span className="text-right text-xs text-slate-500">
                {amountLabel}
                <Money value={remaining(r)} className="block text-sm font-semibold text-slate-800" />
              </span>
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}

/* =========================== Modal: xem bản chốt & đối chiếu =========================== */
function SnapshotModal({ open, onClose, snap, onPrint, onDelete }) {
  const toast = useToast();
  const names = useNames(snap ? [snap.createdBy] : []);
  const [variance, setVariance] = useState(null);
  useEffect(() => {
    if (!open || !snap) return;
    setVariance(null);
    const { from, end } = varianceWindow(snap);
    getDocs(query(collection(db, C.payments), where('date', '>=', from), where('date', '<=', end)))
      .then((s) => setVariance(computeVariance(snap, s.docs.map((d) => ({ id: d.id, ...d.data() })))))
      .catch((ex) => toast.error(friendlyError(ex)));
  }, [open, snap, toast]);
  if (!open || !snap) return null;
  const t = snap.totals;
  const monthDone = monthRange(snap.month).end < todayISO();

  const VarTable = ({ title, rows, kindLabel }) => (
    <div className="mb-4">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500 mb-2">{title}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-slate-400">Không có khoản nào.</p>
      ) : (
        <TableWrap className="rounded-xl border border-slate-200">
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className={th}>{kindLabel}</th>
                <th className={cx(th, 'text-right')}>Kế hoạch</th>
                <th className={cx(th, 'text-right')}>Thực tế</th>
                <th className={cx(th, 'text-right')}>Chênh lệch</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className={td}>
                    <p className="font-medium text-slate-800">{r.partner}</p>
                    <p className="text-xs text-slate-500 truncate max-w-[260px]">{r.label}</p>
                  </td>
                  <td className={cx(td, 'text-right')}>
                    <Money value={r.planned} />
                  </td>
                  <td className={cx(td, 'text-right')}>
                    <Money value={r.actual} className="font-semibold" />
                  </td>
                  <td className={cx(td, 'text-right whitespace-nowrap')}>
                    <Money value={r.variance} sign className={cx('font-semibold', r.variance < 0 ? 'text-rose-600' : r.variance > 0 ? 'text-jade-700' : 'text-slate-500')} />
                    {r.pct != null && <span className="ml-1 text-xs text-slate-400">({fmtPct(r.pct, 0)})</span>}
                    {r.material && <Badge tone="amber" className="ml-1">Trọng yếu</Badge>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
    </div>
  );

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="xl"
      title={`Kế hoạch ${monthLabel(snap.month)} · Bản chốt số ${snap.version}`}
      subtitle={`Chốt lúc ${fmtDateTime(snap.createdAt)} bởi ${names[snap.createdBy] || 'Người dùng'}${snap.note ? ` · ${snap.note}` : ''}`}
      footer={
        <>
          {onDelete && (
            <Button variant="dangerGhost" icon={Trash2} className="mr-auto" onClick={() => onDelete(snap)}>
              Xóa bản chốt
            </Button>
          )}
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="primary" icon={Printer} onClick={() => onPrint(snap, variance)}>
            Xuất PDF
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-5">
        <div className="rounded-xl bg-emerald-50 px-4 py-3">
          <p className="text-xs text-jade-700">(1) Tổng có{snap.sources.arIn > 0 ? ' + phải thu về' : ''}</p>
          <Money value={snap.sources.baseSources ?? snap.sources.sources} className="text-lg font-semibold text-emerald-800" />
        </div>
        <div className="rounded-xl bg-orange-50 px-4 py-3">
          <p className="text-xs text-orange-700">(2) Tổng phải chi</p>
          <Money value={t.payTotal} className="text-lg font-semibold text-orange-800" />
        </div>
        <div className={cx('rounded-xl px-4 py-3', t.balance < 0 ? 'bg-sapphire-50' : 'bg-slate-50')}>
          <p className="text-xs text-slate-600">{t.balance < 0 ? '(3) Cần giải ngân' : '(3) Còn dư'}</p>
          <Money value={t.balance < 0 ? t.suggestedDraw : t.balance} className={cx('text-lg font-semibold', t.balance < 0 ? 'text-sapphire-700' : 'text-slate-900')} />
        </div>
      </div>

      <div className="rounded-xl border border-slate-200 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Scale className="h-4 w-4 text-slate-600" />
          <p className="text-sm font-semibold text-slate-900">Đối chiếu kế hoạch – thực tế</p>
        </div>
        <p className="text-xs text-slate-500 mb-4">
          So sánh với các lần thu/chi công nợ thực tế ghi nhận từ {fmtDate(varianceWindow(snap).from)} đến {fmtDate(varianceWindow(snap).end)}.
          {!monthDone && ' Tháng chưa kết thúc — số liệu thực tế đang cập nhật.'} Chênh lệch ≥ 10% được đánh dấu trọng yếu.
        </p>
        {!variance ? (
          <EmptyState title="Đang tổng hợp số liệu thực tế…" />
        ) : (
          <>
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-4 text-sm">
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Thu: thực hiện / kế hoạch</p>
                <p className="font-semibold">{variance.totals.inRate == null ? '—' : fmtPct(variance.totals.inRate, 0)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Trả NCC: thực hiện / kế hoạch</p>
                <p className="font-semibold">{variance.totals.outRate == null ? '—' : fmtPct(variance.totals.outRate, 0)}</p>
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Thu ngoài kế hoạch</p>
                <Money value={variance.totals.unplannedIn} className="font-semibold text-jade-700" />
              </div>
              <div className="rounded-lg bg-slate-50 px-3 py-2">
                <p className="text-xs text-slate-500">Chi ngoài kế hoạch</p>
                <Money value={variance.totals.unplannedOut} className="font-semibold text-rose-600" />
              </div>
            </div>
            <VarTable title="Tiền về từ khách hàng" rows={variance.inRows} kindLabel="Khách hàng" />
            <VarTable title="Trả nhà cung cấp / đối tác" rows={variance.outRows} kindLabel="Đối tác" />
            {(variance.unplannedIn.length > 0 || variance.unplannedOut.length > 0) && (
              <VarTable
                title="Phát sinh ngoài kế hoạch"
                rows={[
                  ...variance.unplannedIn.map((r) => ({ ...r, key: `i${r.key}`, label: `Thu · ${r.label}`, planned: 0, variance: r.actual, pct: null, material: true })),
                  ...variance.unplannedOut.map((r) => ({ ...r, key: `o${r.key}`, label: `Chi · ${r.label}`, planned: 0, variance: -r.actual, pct: null, material: true })),
                ]}
                kindLabel="Đối tác"
              />
            )}
            {variance.untracked.length > 0 && (
              <p className="text-xs text-slate-500">
                {variance.untracked.length} khoản (lương, thuế, lãi/đáo hạn NH…) với tổng <Money value={variance.totals.untrackedOut} className="font-medium" /> không
                theo dõi tự động — đối chiếu với sổ quỹ / sao kê ngân hàng.
              </p>
            )}
          </>
        )}
      </div>
    </Modal>
  );
}

/* =========================== Bảng tổng hợp chi trả tháng =========================== */
const SUM_GROUPS = [
  { key: 'SUPPLIER', title: 'A. Trả nhà cung cấp', bar: 'bg-vermilion-500', text: 'text-vermilion-700' },
  { key: 'FIXED', title: 'B. Chi cố định (lương, thuế, vận hành…)', bar: 'bg-orchid-500', text: 'text-orchid-700' },
  { key: 'BANK', title: 'C. Trả ngân hàng (lãi vay, đáo hạn)', bar: 'bg-sapphire-500', text: 'text-sapphire-700' },
];

function FundLine({ label, hint, value, strong, tone = 'text-ink-900', sign }) {
  return (
    <div className={cx('flex items-start justify-between gap-3 py-1.5', strong && 'border-t border-slate-200 pt-2.5 mt-1')}>
      <span className={cx('text-sm', strong ? 'font-semibold text-ink-900' : 'text-slate-600')}>
        {label}
        {hint && <span className="block text-[11px] font-normal text-slate-400">{hint}</span>}
      </span>
      <span className={cx('shrink-0 tabular-nums', strong ? 'text-base font-bold' : 'text-sm font-semibold', tone)}>
        {sign}
        <Money value={value} />
      </span>
    </div>
  );
}

function SummaryCard({ plan, data, onApprove, paidThisMonth, onDeposits }) {
  const selected = plan.rows.filter((r) => r.selected);
  const deferred = plan.rows.filter((r) => !r.selected);
  const deferredTotal = deferred.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  const negative = plan.balance < 0;
  const sup = (r) => (r.kind === 'AP' ? findSupplier(data.suppliers, { supplierId: r.supplierId, partnerName: r.partner }) : null);
  const unapproved = selected.filter((r) => r.kind === 'AP' && !r.approval).length;

  return (
    <Card className="mt-4">
      <CardHeader
        title="3 · Bảng tổng hợp chi trả tháng"
        subtitle="Toàn bộ khoản phải trả đã chọn — so với tiền đang có, thiếu thì giải ngân"
        icon={Scale}
        iconClass="bg-ink-900 text-white"
      />
      <div className="grid gap-4 px-4 sm:px-5 pb-5 xl:grid-cols-[minmax(0,1fr)_340px] items-start">
        <div className="min-w-0 rounded-xl border border-slate-200 overflow-hidden">
          {selected.length === 0 ? (
            <EmptyState icon={BadgeCheck} title="Chưa chọn khoản chi nào" description="Tick chọn các khoản ở bảng ưu tiên phía trên." />
          ) : (
            <TableWrap>
              <table className="w-full text-sm">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className={cx(th, 'w-10')}>#</th>
                    <th className={th}>Khoản chi</th>
                    <th className={th}>Người nhận / tài khoản</th>
                    <th className={cx(th, 'hidden md:table-cell')}>Ưu tiên</th>
                    <th className={th}>Trạng thái</th>
                    <th className={cx(th, 'text-right')}>Số tiền</th>
                  </tr>
                </thead>
                {SUM_GROUPS.map((g) => {
                  const list = selected.filter((r) => (PAY_GROUP[r.kind] || 'FIXED') === g.key);
                  if (!list.length) return null;
                  return (
                    <tbody key={g.key} className="divide-y divide-slate-100 border-t border-slate-200">
                      <tr className="bg-slate-50/60">
                        <td colSpan={5} className="px-3 py-2">
                          <span className="flex items-center gap-2 font-display font-semibold text-ink-900">
                            <span className={cx('h-3 w-1 rounded-full', g.bar)} />
                            {g.title}
                            <span className="text-xs font-normal text-slate-500">· {list.length} khoản</span>
                          </span>
                        </td>
                        <td className="px-3 py-2 text-right">
                          <Money value={plan.groups[g.key]} className={cx('font-bold', g.text)} />
                        </td>
                      </tr>
                      {list.map((r, i) => {
                        const s2 = sup(r);
                        return (
                          <tr key={r.key} className={cx('align-top', r.overflow && 'bg-sapphire-50/40')}>
                            <td className={cx(td, 'text-xs text-slate-400 tabular-nums')}>{i + 1}</td>
                            <td className={td}>
                              <p className="font-medium text-ink-900">{r.kind === 'AP' ? r.partner : r.label}</p>
                              <p className="text-xs text-slate-500">
                                {r.kind === 'AP' ? r.label : r.category}
                                {r.kind !== 'CUSTOM' && r.mode === 'PART' && <> · trả 1 phần, còn nợ lại {fmtVND(r.remainingAfter)}</>}
                              </p>
                            </td>
                            <td className={td}>
                              {r.kind === 'AP' ? (
                                s2?.bankAccount ? (
                                  <>
                                    <p className="font-medium tabular-nums text-ink-900">{s2.bankAccount}</p>
                                    <p className="text-xs text-slate-500">{[s2.bankName, s2.bankBranch].filter(Boolean).join(' – ')}</p>
                                  </>
                                ) : (
                                  <span className="text-xs italic text-amber-700">Chưa có số tài khoản</span>
                                )
                              ) : (
                                <span className="text-xs text-slate-500">{r.kind === 'CUSTOM' ? 'Chi nội bộ' : r.partner}</span>
                              )}
                            </td>
                            <td className={cx(td, 'hidden md:table-cell')}>
                              <Badge tone={PRIORITY[r.priority]?.tone}>{r.priority}</Badge>
                            </td>
                            <td className={td}>
                              {r.kind !== 'AP' ? (
                                <span className="text-xs text-slate-400">—</span>
                              ) : r.approval ? (
                                <span className="text-xs font-medium text-jade-700">
                                  <BadgeCheck className="mr-1 inline h-3.5 w-3.5 align-[-2px]" />
                                  Đã duyệt — chờ kế toán chuyển
                                </span>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => onApprove(r)}
                                  className="inline-flex items-center gap-1 rounded-md bg-vermilion-50 px-2 py-1 text-xs font-semibold text-vermilion-700 hover:bg-vermilion-100"
                                >
                                  <Stamp className="h-3.5 w-3.5" /> Duyệt chi
                                </button>
                              )}
                            </td>
                            <td className={cx(td, 'text-right whitespace-nowrap')}>
                              <Money value={r.amount} className="font-semibold text-ink-900" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  );
                })}
                <tfoot>
                  <tr className="border-t-2 border-ink-900/80 bg-white">
                    <td colSpan={5} className="px-3 py-3 font-display font-bold text-ink-900">
                      TỔNG PHẢI CHI · {selected.length} khoản
                    </td>
                    <td className="px-3 py-3 text-right">
                      <Money value={plan.payTotal} className="text-base font-bold text-vermilion-600" />
                    </td>
                  </tr>
                </tfoot>
              </table>
            </TableWrap>
          )}
          {(deferred.length > 0 || unapproved > 0) && (
            <div className="border-t border-slate-100 bg-slate-50/60 px-3 py-2 text-xs text-slate-500 space-y-0.5">
              {unapproved > 0 && (
                <p className="text-vermilion-700">
                  {unapproved} khoản trả nhà cung cấp chưa duyệt chi — kế toán chỉ chuyển tiền các khoản đã duyệt.
                </p>
              )}
              {deferred.length > 0 && (
                <p>
                  {deferred.length} khoản tạm hoãn (không tính vào tổng): <Money value={deferredTotal} className="font-medium" />
                </p>
              )}
            </div>
          )}
        </div>

        <div className="rounded-xl border border-slate-200 p-4">
          <p className="font-display font-semibold text-ink-900 mb-1">Cân đối nguồn tiền</p>
          <FundLine label="Tiền mặt có thể dùng" hint="Tồn két trừ quỹ dự phòng" value={plan.cashUsable} />
          <FundLine label="Tiền gửi tài khoản ngân hàng" value={plan.depositUsable} />
          <FundLine label="TỔNG CÓ" value={plan.haveTotal} strong tone="text-jade-700" />
          {plan.arIn > 0 && <FundLine label="Phải thu chắc chắn về" hint="Các khoản đã chọn ở mục 1" value={plan.arIn} tone="text-jade-700" sign="+ " />}
          <FundLine label="Tổng phải chi" value={plan.payTotal} tone="text-vermilion-600" sign="− " />

          {negative ? (
            <div className="mt-3 space-y-2">
              <div className="flex items-center justify-between rounded-lg bg-rose-50 px-3 py-2">
                <span className="text-sm font-semibold text-rose-700">Thiếu</span>
                <Money value={plan.shortfall} className="font-bold text-rose-700" />
              </div>
              <div className="rounded-xl bg-gradient-to-br from-sapphire-600 to-sapphire-800 guilloche relative px-3 py-3 text-white">
                <div className="relative flex items-center justify-between">
                  <span className="text-sm text-white/85">Cần giải ngân</span>
                  <Money value={plan.suggestedDraw} className="text-xl font-bold" />
                </div>
                {plan.drawPlan.length > 0 && (
                  <ul className="relative mt-2 space-y-1 border-t border-white/20 pt-2 text-xs">
                    {plan.drawPlan.map((d) => (
                      <li key={d.bankId || d.name}>
                        <div className="flex justify-between gap-2">
                          <span className="min-w-0 truncate text-white/90">{d.name}</span>
                          <Money value={d.amount} className="shrink-0 font-semibold" />
                        </div>
                        <p className="text-[11px] text-white/60">còn được vay {fmtVND(d.available)}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              {plan.uncovered > 0 ? (
                <p className="rounded-lg bg-rose-600 px-3 py-2 text-sm font-medium text-white">
                  Giải ngân hết hạn mức vẫn thiếu <Money value={plan.uncovered} className="font-bold" /> — cần hoãn bớt khoản P2 / P3 hoặc thương lượng giãn nợ.
                </p>
              ) : (
                <p className="text-xs text-slate-500">Sau khi giải ngân: đủ tiền chi trả, số dư còn lại <Money value={plan.balanceAfterDraw} className="font-semibold" />.</p>
              )}
            </div>
          ) : (
            <div className="mt-3 rounded-xl bg-jade-50 px-3 py-3">
              <p className="flex items-center gap-1.5 text-sm font-semibold text-jade-800">
                <CircleCheck className="h-4 w-4" /> Đủ tiền — không cần giải ngân
              </p>
              <p className="mt-1 flex justify-between text-sm text-jade-800">
                Còn dư sau chi <Money value={plan.balance} className="font-bold" />
              </p>
            </div>
          )}
          <p className="mt-3 text-xs text-slate-500">
            Hạn mức còn được vay: <Money value={plan.creditAvailable} className="font-medium text-sapphire-700" />
          </p>
          <p
            className={cx(
              'mt-1 flex items-center gap-1 text-xs font-medium',
              plan.p1CoveredBase ? 'text-slate-500' : plan.p1Covered ? 'text-amber-700' : 'text-rose-700',
            )}
          >
            {plan.p1CoveredBase ? <BadgeCheck className="h-3.5 w-3.5 text-jade-600" /> : <TriangleAlert className="h-3.5 w-3.5" />}
            {plan.p1CoveredBase
              ? 'Các khoản P1 đủ tiền từ tiền đang có'
              : plan.p1Covered
                ? 'Các khoản P1 phải dùng tiền giải ngân mới đủ'
                : 'Không đủ tiền cho các khoản P1 bắt buộc'}
          </p>
          {paidThisMonth.count > 0 && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
              Kế toán đã chuyển <Money value={paidThisMonth.total} className="font-semibold" /> ({paidThisMonth.count} lệnh chi) trong tháng. Nhớ{' '}
              <button type="button" onClick={onDeposits} className="font-semibold underline">
                cập nhật số dư tiền gửi
              </button>{' '}
              để Tổng có đúng thực tế.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}

/* ================================== TRANG ================================== */
export default function Planner() {
  const { actor, role } = useAuth();
  const quick = useQuick();
  const data = useData();
  const toast = useToast();
  const confirm = useConfirm();

  const [month, setMonth] = useState(currentMonth());
  const [draft, setDraft] = useState(null);
  const [remote, setRemote] = useState(null);
  const [loadedMonth, setLoadedMonth] = useState(null);
  const [conflict, setConflict] = useState(null);
  const [saveState, setSaveState] = useState('idle');
  const [settings, setSettings] = useState(null);
  const [snapshots, setSnapshots] = useState([]);
  const [modal, setModal] = useState(null); // 'fixed' | 'extraAp' | 'extraAr' | 'lock'
  const [viewSnap, setViewSnap] = useState(null);
  const [reportDoc, setReportDoc] = useState(null);
  const reportRef = useRef(null);
  const savingRef = useRef(false);
  const [lockNote, setLockNote] = useState('');
  const [locking, setLocking] = useState(false);

  const sessionId = useRef(rid() + rid());
  const draftRef = useRef(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef(null);
  const pendingRef = useRef(null);
  const flushRef = useRef(async () => {});
  draftRef.current = draft;

  /* ---------- lưu nháp tự động (debounce) ---------- */
  flushRef.current = async () => {
    clearTimeout(timerRef.current);
    timerRef.current = null;
    const p = pendingRef.current;
    if (!p) return;
    if (savingRef.current) {
      timerRef.current = setTimeout(() => flushRef.current(), 400);
      return;
    }
    savingRef.current = true;
    pendingRef.current = null;
    const rev = (p.draft.rev || 0) + 1;
    setSaveState('saving');
    try {
      await setDoc(doc(db, C.plans, p.month), {
        ...serialize(p.draft),
        rev,
        sessionId: sessionId.current,
        updatedBy: actor.email,
        updatedAt: serverTimestamp(),
      });
      if (draftRef.current?.month === p.month) {
        draftRef.current = { ...draftRef.current, rev };
        setDraft((d) => (d && d.month === p.month ? { ...d, rev } : d));
      }
      if (!pendingRef.current) {
        dirtyRef.current = false;
        setSaveState('saved');
      }
    } catch (ex) {
      setSaveState('error');
      toast.error(friendlyError(ex));
    } finally {
      savingRef.current = false;
    }
  };

  const edit = useCallback((fn) => {
    const cur = draftRef.current;
    if (!cur) return;
    const nd = fn(cur);
    draftRef.current = nd;
    setDraft(nd);
    dirtyRef.current = true;
    pendingRef.current = { month: nd.month, draft: nd };
    setSaveState('pending');
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => flushRef.current(), 1200);
  }, []);

  /* ---------- đăng ký dữ liệu ---------- */
  useEffect(
    () =>
      onSnapshot(
        doc(db, C.settings, 'planner'),
        (s) => setSettings(s.exists() ? s.data() : { fixedTemplates: [] }),
        () => setSettings({ fixedTemplates: [] }),
      ),
    [],
  );

  useEffect(
    () =>
      onSnapshot(
        collection(db, C.snapshots),
        (s) => setSnapshots(s.docs.map((d) => ({ id: d.id, ...d.data() }))),
        (ex) => toast.error(friendlyError(ex)),
      ),
    [toast],
  );

  useEffect(() => {
    setDraft(null);
    setLoadedMonth(null);
    setConflict(null);
    setSaveState('idle');
    dirtyRef.current = false;
    const unsub = onSnapshot(doc(db, C.plans, month), (snap) => setRemote({ month, data: snap.exists() ? snap.data() : null }));
    return () => {
      unsub();
      flushRef.current();
    };
  }, [month]);

  useEffect(() => {
    if (!remote || remote.month !== month || !settings) return;
    if (loadedMonth !== month) {
      setDraft(remote.data ? normalizeDraft(remote.data, month) : newDraft(month, settings.fixedTemplates || []));
      setLoadedMonth(month);
      return;
    }
    const d = remote.data;
    const cur = draftRef.current;
    if (d && d.sessionId !== sessionId.current && (d.rev || 0) > (cur?.rev || 0)) {
      if (!dirtyRef.current) setDraft(normalizeDraft(d, month));
      else setConflict(d);
    }
  }, [remote, settings, month, loadedMonth]);

  useEffect(() => {
    const h = (e) => {
      if (pendingRef.current) {
        flushRef.current();
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, []);

  /* ---------- tính toán ---------- */
  const cashBal = useMemo(() => cashBalance(data.cash), [data.cash]);
  const bank = useMemo(() => bankSummary(data.banks, data.loans, todayISO()), [data.banks, data.loans]);
  const arRows = useMemo(
    () => (draft ? planReceivables({ ar: data.ar, month, extraAr: draft.extraAr, state: draft.ar }) : []),
    [data.ar, month, draft],
  );
  const candidates = useMemo(
    () =>
      draft
        ? planCandidates({ ap: data.ap, loans: data.loans, banks: data.banks, month, extraAp: draft.extraAp, custom: draft.custom, approvals: data.approvals })
        : [],
    [data.ap, data.loans, data.banks, data.approvals, month, draft],
  );
  const rows = useMemo(() => (draft ? mergePlanRows(candidates, draft) : []), [candidates, draft]);
  const plan = useMemo(
    () =>
      computePlan({
        cashBalance: cashBal,
        reserve: draft?.reserve || 0,
        deposits: bank.totals.deposit,
        includeDeposits: draft?.includeDeposits ?? true,
        arRows,
        creditAvailable: bank.totals.available,
        creditBanks: bank.rows,
        rows,
      }),
    [cashBal, draft, bank, arRows, rows],
  );

  const monthEnd = monthRange(month).end;
  const extraApChoices = useMemo(
    () => data.ap.filter((r) => remaining(r) > 0 && !(r.dueDate && r.dueDate <= monthEnd) && !(draft?.extraAp || []).includes(r.id)),
    [data.ap, monthEnd, draft],
  );
  const extraArChoices = useMemo(
    () => data.ar.filter((r) => remaining(r) > 0 && !(r.dueDate && r.dueDate <= monthEnd) && !(draft?.extraAr || []).includes(r.id)),
    [data.ar, monthEnd, draft],
  );
  const flow = useApprovalFlow({ ap: data.ap, approvals: data.approvals, suppliers: data.suppliers });
  const onApprove = (row) => {
    const debt = data.ap.find((r) => r.id === row.refId);
    if (debt) flow.approve(debt, flow.openByPayable.get(row.refId) || null);
  };
  // Lệnh chi kế toán đã chuyển trong tháng (để nhắc cập nhật số dư tiền gửi)
  const paidThisMonth = useMemo(() => {
    const { start, end } = monthRange(month);
    const list = (data.approvals || []).filter((a) => a.status === 'DONE' && a.paidOn >= start && a.paidOn <= end);
    return { count: list.length, total: list.reduce((t, a) => t + (Number(a.paidAmount) || 0), 0) };
  }, [data.approvals, month]);
  const monthSnaps = useMemo(
    () => snapshots.filter((s) => s.month === month).sort((a, b) => (b.version || 0) - (a.version || 0)),
    [snapshots, month],
  );

  /* ---------- thao tác ---------- */
  const setItem = (key, patch) => edit((d) => ({ ...d, items: { ...d.items, [key]: { ...(d.items[key] || {}), ...patch } } }));
  const onToggle = (key, sel) => {
    if (rows.find((r) => r.key === key)?.locked) return;
    setItem(key, { sel });
  };
  // Sửa số tiền = trả 1 phần; chọn "Trả toàn bộ" = luôn bằng số còn nợ
  const onAmount = (key, v) => setItem(key, { amount: v, mode: 'PART' });
  const onMode = (key, mode, row) =>
    setItem(key, mode === 'FULL' ? { mode, amount: null } : { mode, amount: row.mode === 'PART' ? row.amount : Math.round(row.outstanding / 2 / 1000) * 1000 });
  const onPriority = (key, priority) => setItem(key, { priority });
  const onRemove = (row) =>
    edit((d) => {
      const items = { ...d.items };
      delete items[row.key];
      return {
        ...d,
        items,
        order: d.order.filter((k) => k !== row.key),
        custom: d.custom.filter((c) => c.key !== row.key),
        extraAp: row.kind === 'AP' ? d.extraAp.filter((id) => id !== row.refId) : d.extraAp,
      };
    });
  const setAr = (id, patch) => edit((d) => ({ ...d, ar: { ...d.ar, [id]: { ...(d.ar[id] || {}), ...patch } } }));

  const rowKeys = rows.map((r) => r.key);
  const sortable = useSortableList(rowKeys, (from, to) => edit((d) => ({ ...d, order: arrayMove(rowKeys, from, to) })));
  const sortByPriority = () => edit((d) => ({ ...d, order: [...rows].sort(byPriorityThenDue).map((r) => r.key) }));

  const saveTemplates = async (list) => {
    try {
      await setDoc(doc(db, C.settings, 'planner'), { fixedTemplates: list, updatedBy: actor.email, updatedAt: serverTimestamp() }, { merge: true });
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };
  const addFixed = (item, asTemplate) => {
    edit((d) => ({ ...d, custom: [...d.custom, item] }));
    if (asTemplate) {
      saveTemplates([...(settings?.fixedTemplates || []), { label: item.label, category: item.category, amount: item.amount, priority: item.priority }]);
      toast.success('Đã thêm và lưu làm mẫu hàng tháng');
    }
  };

  const resetDraft = async () => {
    const ok = await confirm({
      title: 'Làm lại bảng kế hoạch tháng này?',
      message: 'Mọi lựa chọn, số tiền, thứ tự đã sắp xếp trong bản nháp sẽ trở về mặc định. Các bản đã chốt không bị ảnh hưởng.',
      confirmText: 'Làm lại',
      tone: 'danger',
    });
    if (ok) edit(() => ({ ...newDraft(month, settings?.fixedTemplates || []), rev: draftRef.current?.rev || 0 }));
  };

  const buildSnapshot = () => ({
    month,
    sources: pick({ ...plan, deposits: bank.totals.deposit, includeDeposits: draft.includeDeposits }, [
      'cashBalance',
      'reserve',
      'cashUsable',
      'deposits',
      'includeDeposits',
      'depositUsable',
      'haveTotal',
      'arIn',
      'creditAvailable',
      'creditUsed',
      'baseSources',
      'sources',
    ]),
    arRows: arRows.map((r) => pick(r, ['key', 'refId', 'partner', 'label', 'dueDate', 'certainty', 'outstanding', 'selected', 'amount'])),
    rows: plan.rows.map((r) => {
      const sup = r.kind === 'AP' ? findSupplier(data.suppliers, { supplierId: r.supplierId, partnerName: r.partner }) : null;
      return {
        ...pick(r, ['key', 'kind', 'refId', 'supplierId', 'label', 'partner', 'category', 'dueDate', 'outstanding', 'priority', 'selected', 'amount', 'runningAfter', 'overflow', 'mode', 'remainingAfter']),
        group: PAY_GROUP[r.kind] || 'FIXED',
        approved: !!r.approval,
        approvedOn: r.approval?.approvedOn || null,
        payTo: sup ? payToText(sup) : '',
        // ảnh chụp thông tin NCC tại thời điểm lập / chốt kế hoạch (để in đúng tài khoản nhận tiền)
        supplier: sup ? pick(sup, ['name', 'taxCode', 'bankAccount', 'bankName', 'bankBranch', 'accountHolder', 'phone']) : null,
      };
    }),
    totals: {
      ...pick(plan, ['payTotal', 'byPriority', 'groups', 'groupCount', 'balance', 'shortfall', 'needCredit', 'suggestedDraw', 'uncovered', 'balanceAfterDraw']),
      drawPlan: plan.drawPlan.map((d) => pick(d, ['name', 'available', 'amount'])),
    },
  });

  const lockPlan = async () => {
    setLocking(true);
    try {
      await flushRef.current();
      const version = Math.max(0, ...monthSnaps.map((s) => s.version || 0)) + 1;
      const snap = { ...buildSnapshot(), version, note: lockNote.trim(), lockedOn: todayISO() };
      const b = new AuditedBatch(actor);
      b.create(
        C.snapshots,
        snap,
        `Chốt kế hoạch ${monthLabel(month)} — bản số ${version}: có ${fmtVND(plan.haveTotal)}, chi ${fmtVND(plan.payTotal)}, ${plan.balance < 0 ? `cần giải ngân ${fmtVND(plan.suggestedDraw)}` : `dư ${fmtVND(plan.balance)}`}`,
        {
          logData: { month, version, sources: plan.sources, payTotal: plan.payTotal, balance: plan.balance, note: snap.note },
        },
      );
      await b.commit();
      toast.success(`Đã chốt kế hoạch ${monthLabel(month)} (bản số ${version})`);
      setModal(null);
      setLockNote('');
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setLocking(false);
    }
  };

  const deleteSnapshot = async (s) => {
    const ok = await confirm({
      title: `Xóa bản chốt số ${s.version}?`,
      message: 'Bản chụp kế hoạch này sẽ bị xóa (nội dung vẫn còn trong Nhật ký hệ thống).',
      confirmText: 'Xóa',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const b = new AuditedBatch(actor);
      b.remove(C.snapshots, s.id, { month: s.month, version: s.version, _auditId: s._auditId }, `Xóa bản chốt kế hoạch ${monthLabel(s.month)} số ${s.version}`);
      await b.commit();
      setViewSnap(null);
      toast.success('Đã xóa bản chốt');
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  /* ---------- xuất PDF ---------- */
  const startExport = async (snap, variance) => {
    if (reportDoc) return;
    const names = await resolveNames([snap.createdBy]).catch(() => ({}));
    setReportDoc({ snap, variance, creatorName: names[snap.createdBy] || '' });
  };
  useEffect(() => {
    if (!reportDoc || !reportRef.current) return undefined;
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const kind = await exportReport(reportRef.current, `Ke-hoach-dong-tien_${reportDoc.snap.month}${reportDoc.snap.version ? `_ban-${reportDoc.snap.version}` : '_nhap'}`);
        if (kind === 'pdf') toast.success('Đã xuất báo cáo PDF');
        else toast.info('Đã tải bản in (.html): mở file → hộp thoại In hiện ra → chọn “Lưu thành PDF”.');
      } catch (ex) {
        if (ex?.code !== 'declined') toast.error(friendlyError(ex));
      } finally {
        if (alive) setReportDoc(null);
      }
    }, 120);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [reportDoc, toast]);

  /* ---------- giao diện ---------- */
  if (!data.ready || !draft) {
    return (
      <div>
        <PageHeader icon={CalendarRange} title="Bảng điều phối tài chính tháng" actions={<MonthPicker value={month} onChange={setMonth} />} />
        <Card>
          <EmptyState title="Đang tải bảng kế hoạch…" />
        </Card>
      </div>
    );
  }

  const SaveBadge = () => {
    const map = {
      idle: [CircleCheck, 'Đã đồng bộ', 'text-slate-400'],
      saved: [CircleCheck, 'Đã lưu nháp', 'text-jade-600'],
      pending: [CloudUpload, 'Chờ lưu…', 'text-amber-600'],
      saving: [RefreshCw, 'Đang lưu…', 'text-amber-600'],
      error: [TriangleAlert, 'Lỗi lưu', 'text-rose-600'],
    };
    const [Icon, text, cls] = map[saveState];
    return (
      <span className={cx('flex items-center gap-1.5 text-xs font-medium', cls)}>
        <Icon className={cx('h-4 w-4', saveState === 'saving' && 'animate-spin')} /> {text}
      </span>
    );
  };

  const selAr = arRows.filter((r) => r.selected);
  const negative = plan.balance < 0;

  return (
    <div>
      <PageHeader
        icon={CalendarRange}
        tone="orchid"
        title="Bảng điều phối tài chính tháng"
        subtitle="Cân đối tiền về – quyết định trả ai trước, trả bao nhiêu"
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <SaveBadge />
            <Button icon={Printer} loading={!!reportDoc} onClick={() => startExport({ ...buildSnapshot(), version: null, createdBy: actor.email }, null)}>
              Xuất PDF
            </Button>
            <Button variant="orchid" icon={Lock} onClick={() => setModal('lock')}>
              Chốt kế hoạch tháng
            </Button>
          </>
        }
      />

      {conflict && (
        <div className="mb-4 flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900">
          <TriangleAlert className="h-5 w-5 shrink-0" />
          <span className="flex-1">
            <b>
              <Who id={conflict.updatedBy} />
            </b>{' '}
            vừa cập nhật bản nháp kế hoạch này. Tải bản mới sẽ thay thế các thay đổi chưa lưu của bạn.
          </span>
          <div className="flex gap-2">
            <Button size="sm" onClick={() => setConflict(null)}>
              Giữ bản của tôi
            </Button>
            <Button
              size="sm"
              variant="primary"
              icon={RefreshCw}
              onClick={() => {
                pendingRef.current = null;
                clearTimeout(timerRef.current);
                dirtyRef.current = false;
                setDraft(normalizeDraft(conflict, month));
                setConflict(null);
                setSaveState('idle');
              }}
            >
              Tải bản mới
            </Button>
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 xl:grid-cols-12 gap-4 items-start">
        {/* ===================== KHU VỰC 1: NGUỒN TIỀN ===================== */}
        <Card className="xl:col-span-4 2xl:col-span-4">
          <CardHeader title="1 · Nguồn tiền sẵn có & tiền về" subtitle="Cash In" icon={CircleArrowDown} iconClass="bg-emerald-50 text-jade-600" />
          <div className="px-4 sm:px-5 pb-5 space-y-4">
            <div className="rounded-xl border border-slate-200 p-3 space-y-3">
              <div className="flex items-center justify-between text-sm">
                <button type="button" onClick={() => quick.open('cash')} className="flex items-center gap-2 text-slate-600 hover:text-jade-700">
                  <Vault className="h-4 w-4" /> Tồn quỹ két hiện tại
                  <span className="rounded-full bg-jade-50 px-2 py-0.5 text-[11px] font-semibold text-jade-700">Thêm / bớt</span>
                </button>
                <Money value={cashBal} className="font-semibold text-ink-900" />
              </div>
              <Field label="Giữ lại tối thiểu trong két (quỹ dự phòng)">
                <MoneyInput value={draft.reserve} onChange={(v) => edit((d) => ({ ...d, reserve: v }))} />
              </Field>
              <div className="flex items-center justify-between text-sm border-t border-slate-100 pt-2">
                <span className="text-slate-600">Tiền mặt có thể dùng</span>
                <Money value={plan.cashUsable} className={cx('font-semibold', plan.cashUsable < 0 ? 'text-rose-600' : 'text-jade-700')} />
              </div>
            </div>

            <div className="rounded-xl border border-slate-200 p-3">
              <Toggle
                tone="green"
                checked={draft.includeDeposits}
                onChange={(v) => edit((d) => ({ ...d, includeDeposits: v }))}
                label="Tính tiền gửi tài khoản ngân hàng"
                description={
                  <>
                    Số dư hiện có: <Money value={bank.totals.deposit} className="font-medium" />
                  </>
                }
              />
              <button type="button" onClick={() => quick.open('deposits')} className="mt-2 text-xs font-semibold text-lagoon-700 hover:underline">
                Cập nhật số dư tiền gửi
              </button>
            </div>

            <div>
              <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1 mb-2">
                <p className="text-sm font-semibold text-slate-800">
                  Phải thu dự kiến về{' '}
                  <span className="font-normal text-slate-500">
                    ({selAr.length}/{arRows.length} khoản)
                  </span>
                </p>
                <span className="flex gap-1">
                  <Button size="xs" variant="ghost" icon={Plus} onClick={() => quick.open('ar')}>
                    Thu tiền / thêm
                  </Button>
                  <Button size="xs" variant="ghost" icon={ListPlus} onClick={() => setModal('extraAr')}>
                    Đưa khoản khác vào
                  </Button>
                </span>
              </div>
              {arRows.length === 0 ? (
                <p className="rounded-xl bg-slate-50 px-3 py-4 text-center text-xs text-slate-500">Không có khoản phải thu nào đến hạn trong tháng.</p>
              ) : (
                <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 max-h-[420px] overflow-y-auto thin-scroll">
                  {arRows.map((r) => (
                    <li key={r.key} className={cx('px-3 py-2.5', !r.selected && 'bg-slate-50/70')}>
                      <div className="flex items-start gap-2.5">
                        <div className="mt-0.5">
                          <Checkbox checked={r.selected} onChange={(v) => setAr(r.key, { sel: v })} title="Đưa vào tính toán" />
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className={cx('text-sm font-medium truncate', r.selected ? 'text-slate-800' : 'text-slate-400')}>{r.partner}</p>
                          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                            <Badge tone={CERTAINTY[r.certainty]?.tone}>{CERTAINTY[r.certainty]?.label}</Badge>
                            {r.dueDate && <span className="text-[11px] text-slate-500">{fmtDate(r.dueDate)}</span>}
                            {r.extra && (
                              <button
                                type="button"
                                className="text-[11px] text-rose-600 hover:underline"
                                onClick={() => edit((d) => ({ ...d, extraAr: d.extraAr.filter((id) => id !== r.refId) }))}
                              >
                                Bỏ
                              </button>
                            )}
                          </div>
                          <div className="mt-2">
                            <MoneyInput
                              value={r.amount}
                              onChange={(v) => setAr(r.key, { amount: v === r.outstanding ? null : v })}
                              showHint={false}
                              className="!h-9"
                              disabled={!r.selected}
                            />
                          </div>
                        </div>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex justify-between text-sm px-1">
                <span className="text-slate-600">Tổng phải thu đưa vào tính</span>
                <Money value={plan.arIn} className="font-semibold text-jade-700" />
              </div>
            </div>

            <div className="relative rounded-2xl bg-gradient-to-br from-jade-500 to-jade-700 guilloche text-white px-4 py-3 shadow-lg">
              <div className="relative flex items-center justify-between">
                <span className="text-sm text-white/85">(1) Tổng có</span>
                <Money value={plan.haveTotal} className="text-lg font-semibold" />
              </div>
              <p className="relative text-[11px] text-white/75">Tiền mặt có thể dùng + tiền gửi tài khoản</p>
              {plan.arIn > 0 && (
                <div className="relative mt-1.5 flex items-center justify-between border-t border-white/20 pt-1.5 text-xs text-white/85">
                  <span>+ Phải thu chắc chắn về</span>
                  <Money value={plan.arIn} className="font-semibold" />
                </div>
              )}
            </div>

            <div className="rounded-xl border border-sapphire-100 bg-sapphire-50/60 p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink-900">Hạn mức vay còn được giải ngân</p>
                  <p className="text-xs text-slate-500">Không cộng sẵn vào tiền có — chỉ giải ngân phần còn thiếu (xem bảng tổng hợp)</p>
                </div>
                <Money value={bank.totals.available} className="shrink-0 text-sm font-semibold text-sapphire-700" />
              </div>
              <button type="button" onClick={() => quick.open('credit')} className="mt-2 text-xs font-semibold text-sapphire-700 hover:underline">
                Xem / thêm khoản vay
              </button>
            </div>
          </div>
        </Card>

        {/* ===================== KHU VỰC 2: ƯU TIÊN PHẢI TRẢ ===================== */}
        <Card className="xl:col-span-8 2xl:col-span-8">
          <CardHeader
            title="2 · Bảng lập thứ tự ưu tiên phải trả"
            subtitle="Kéo ⋮⋮ để đổi thứ tự · Tick chọn chi tháng này · Sửa số tiền để trả một phần"
            icon={ArrowDownWideNarrow}
            iconClass="bg-orchid-50 text-orchid-600"
          />
          <div className="flex flex-wrap items-center gap-2 px-4 sm:px-5 pb-3">
            <Button size="sm" variant="orchid" icon={Plus} onClick={() => setModal('fixed')}>
              Khoản chi cố định
            </Button>
            <Button size="sm" variant="vermilion" icon={Plus} onClick={() => quick.open('ap', { filter: 'month' })}>
              Công nợ phải trả
            </Button>
            <Button size="sm" icon={ListPlus} onClick={() => setModal('extraAp')}>
              Thêm công nợ chưa đến hạn
            </Button>
            <Button size="sm" icon={ArrowDownWideNarrow} onClick={sortByPriority}>
              Sắp xếp theo ưu tiên
            </Button>
            <Button size="sm" variant="ghost" icon={RotateCcw} onClick={resetDraft}>
              Làm lại
            </Button>
            <div className="ml-auto flex flex-wrap gap-1.5">
              {['P1', 'P2', 'P3'].map((p) => (
                <Badge key={p} tone={PRIORITY[p].tone}>
                  {p}: <Money value={plan.byPriority[p]} compact />
                </Badge>
              ))}
            </div>
          </div>

          <div className="hidden lg:grid grid-cols-[minmax(0,1fr)_100px_210px_150px] gap-x-3 pl-[78px] pr-[50px] pr-3 py-2 border-y border-slate-100 bg-slate-50/80 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <span>Khoản chi</span>
            <span>Ưu tiên</span>
            <span className="text-right">Trả toàn bộ / 1 phần</span>
            <span className="text-right" title="Số âm: từ khoản này trở đi phải dùng tiền giải ngân">Số dư lũy kế (âm = giải ngân)</span>
          </div>

          {rows.length === 0 ? (
            <EmptyState
              icon={BadgeCheck}
              title="Chưa có khoản phải trả nào trong tháng"
              description="Thêm nhanh Lương, Thuế/BHXH, Chi phí vận hành… bằng nút “Khoản chi cố định”."
            />
          ) : (
            <ul className="border-t border-slate-100 lg:border-t-0">
              {plan.rows.map((r, i) => (
                <PayRow
                  key={r.key}
                  row={r}
                  index={i}
                  onToggle={onToggle}
                  onAmount={onAmount}
                  onMode={onMode}
                  onPriority={onPriority}
                  supplier={r.kind === 'AP' ? findSupplier(data.suppliers, { supplierId: r.supplierId, partnerName: r.partner }) : null}
                  onRemove={onRemove}
                  onApprove={onApprove}
                  itemRef={sortable.setRef(r.key)}
                  style={sortable.styleFor(r.key, i)}
                  isDragging={sortable.draggingKey === r.key}
                  handleProps={sortable.handleProps(r.key)}
                />
              ))}
            </ul>
          )}
        </Card>
      </div>

      {/* ===================== KHU VỰC 3: BẢNG TỔNG HỢP ===================== */}
      <SummaryCard plan={plan} data={data} onApprove={onApprove} paidThisMonth={paidThisMonth} onDeposits={() => quick.open('deposits')} />

      {/* ===================== LỊCH SỬ CHỐT ===================== */}
      <Card className="mt-4">
        <CardHeader title={`Các bản đã chốt · ${monthLabel(month)}`} subtitle="Bản chụp lịch sử để đối chiếu cuối tháng" icon={Lock} />
        {monthSnaps.length === 0 ? (
          <p className="px-5 pb-5 text-sm text-slate-500">Chưa chốt bản nào cho tháng này.</p>
        ) : (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {monthSnaps.map((s) => (
              <li key={s.id} className="flex flex-col sm:flex-row sm:items-center gap-2 px-4 sm:px-5 py-3">
                <div className="flex items-center gap-3 flex-1 min-w-0">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-orchid-600 text-xs font-bold text-white">#{s.version}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-slate-800">
                      {fmtDateTime(s.createdAt)} · <Who id={s.createdBy} />
                    </p>
                    <p className="text-xs text-slate-500">
                      Có <Money value={s.sources?.haveTotal ?? s.sources?.sources} /> · Chi <Money value={s.totals?.payTotal} /> ·{' '}
                      {s.totals?.balance < 0 ? (
                        <>
                          Cần giải ngân <Money value={s.totals?.suggestedDraw} className="font-semibold text-sapphire-700" />
                        </>
                      ) : (
                        <>
                          Dư <Money value={s.totals?.balance} className="font-semibold text-jade-700" />
                        </>
                      )}
                      {s.note && ` · ${s.note}`}
                    </p>
                  </div>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" icon={Eye} onClick={() => setViewSnap(s)}>
                    Xem & đối chiếu
                  </Button>
                  <Button size="sm" icon={Printer} onClick={() => startExport(s, null)}>
                    PDF
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ===================== MODALS ===================== */}
      <AddFixedModal
        open={modal === 'fixed'}
        onClose={() => setModal(null)}
        onAdd={addFixed}
        templates={settings?.fixedTemplates || []}
        onSaveTemplates={saveTemplates}
      />
      <PickExtraModal
        open={modal === 'extraAp'}
        onClose={() => setModal(null)}
        title="Thêm công nợ phải trả chưa đến hạn"
        items={extraApChoices}
        amountLabel="Còn phải trả"
        onAdd={(ids) => edit((d) => ({ ...d, extraAp: [...d.extraAp, ...ids] }))}
      />
      <PickExtraModal
        open={modal === 'extraAr'}
        onClose={() => setModal(null)}
        title="Thêm khoản phải thu (chưa đến hạn trong tháng)"
        items={extraArChoices}
        amountLabel="Còn phải thu"
        onAdd={(ids) => edit((d) => ({ ...d, extraAr: [...d.extraAr, ...ids] }))}
      />
      <Modal
        open={modal === 'lock'}
        onClose={() => setModal(null)}
        title={`Chốt kế hoạch ${monthLabel(month)}`}
        size="sm"
        footer={
          <>
            <Button onClick={() => setModal(null)}>Hủy</Button>
            <Button variant="primary" icon={Lock} loading={locking} onClick={lockPlan}>
              Chốt bản số {Math.max(0, ...monthSnaps.map((s) => s.version || 0)) + 1}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-sm">
          <p className="text-slate-600">
            Lưu bản chụp cố định của kế hoạch hiện tại để đối chiếu với thực tế cuối tháng. Bản chốt không thể chỉnh sửa; bạn vẫn có thể tiếp tục sửa bản nháp và chốt thêm
            bản mới.
          </p>
          <div className="rounded-xl bg-slate-50 px-4 py-3 space-y-1">
            <div className="flex justify-between">
              <span>Tổng có (tiền mặt + tiền gửi)</span>
              <Money value={plan.haveTotal} className="font-semibold" />
            </div>
            {plan.arIn > 0 && (
              <div className="flex justify-between">
                <span>Phải thu chắc chắn về</span>
                <Money value={plan.arIn} className="font-semibold" />
              </div>
            )}
            <div className="flex justify-between">
              <span>Tổng phải chi</span>
              <Money value={plan.payTotal} className="font-semibold" />
            </div>
            <div className="flex justify-between">
              <span>{negative ? 'Cần giải ngân' : 'Còn dư'}</span>
              <Money value={negative ? plan.suggestedDraw : plan.balance} className={cx('font-semibold', negative ? 'text-sapphire-700' : 'text-jade-700')} />
            </div>
          </div>
          <Field label="Ghi chú (tùy chọn)">
            <Input value={lockNote} onChange={(e) => setLockNote(e.target.value)} placeholder="VD: Đã thống nhất với Đồng quản trị" />
          </Field>
        </div>
      </Modal>
      {flow.modals}
      <SnapshotModal
        open={!!viewSnap}
        onClose={() => setViewSnap(null)}
        snap={viewSnap}
        onPrint={(snap, variance) => startExport(snap, variance)}
        onDelete={can(role, 'deleteSnapshots') ? deleteSnapshot : null}
      />

      {reportDoc &&
        createPortal(
          <div ref={reportRef} style={{ position: 'fixed', left: -10000, top: 0, width: 794, background: '#fff', padding: 24 }}>
            <PlanReport snap={reportDoc.snap} variance={reportDoc.variance} creatorName={reportDoc.creatorName} suppliers={data.suppliers} />
          </div>,
          document.body,
        )}
    </div>
  );
}
