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
import { internalForPlan } from '../lib/vouchers.js';
import { downloadPlanXlsx } from '../lib/planExcel.js';
import { getCompanyName } from '../lib/brand.js';
import { CashInStrip, PlanActionsMobile, PlanTopBar, PriorityTable, RowDrawer, matchFilter } from '../components/planner/PlanParts.jsx';

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
    includeCredit: false,
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
  return pick(d, ['month', 'reserve', 'includeDeposits', 'includeCredit', 'ar', 'extraAr', 'items', 'extraAp', 'custom', 'order']);
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
  { key: 'INTERNAL', title: 'D. Chi nội bộ (chứng từ đã duyệt, chờ kết xuất)', bar: 'bg-amber-500', text: 'text-amber-700' },
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
  const [open, setOpen] = useState(false);
  const selected = plan.rows.filter((r) => r.selected);
  const deferred = plan.rows.filter((r) => !r.selected);
  const deferredTotal = deferred.reduce((t, r) => t + (Number(r.amount) || 0), 0);
  const negative = plan.balance < 0;
  const sup = (r) => (r.kind === 'AP' ? findSupplier(data.suppliers, { supplierId: r.supplierId, partnerName: r.partner }) : null);
  const unapproved = selected.filter((r) => r.kind === 'AP' && !r.approval).length;

  return (
    <Card className="mt-4">
      <button type="button" onClick={() => setOpen((o) => !o)} className="w-full text-left" aria-expanded={open}>
        <CardHeader
          title="Bảng tổng hợp chi trả & giải ngân"
          subtitle={
            open
              ? 'Danh sách đi lệnh theo nhóm — so với tiền đang có, thiếu thì giải ngân'
              : `${selected.length} khoản · ${fmtVND(plan.payTotal)}${negative ? ` · cần giải ngân ${fmtVND(plan.suggestedDraw)}` : ' · đủ tiền'}${unapproved ? ` · ${unapproved} khoản NCC chưa duyệt chi` : ''}`
          }
          icon={Scale}
          iconClass="bg-ink-900 text-white"
          actions={<span className="text-xs font-semibold text-slate-500">{open ? 'Thu gọn' : 'Mở'}</span>}
        />
      </button>
      {open && (
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
                                <span className="text-xs text-slate-500">{r.kind === 'CUSTOM' ? 'Chi nội bộ' : r.kind === 'INTERNAL' ? 'Thủ quỹ chi theo phiếu' : r.partner}</span>
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
      )}
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
  // Chứng từ nội bộ đã duyệt (chưa kết chuyển) gộp thành MỘT dòng P1; phần đã kết chuyển đã trừ vào tồn két
  const internal = useMemo(() => internalForPlan(data.vouchers || [], month), [data.vouchers, month]);
  const candidates = useMemo(() => {
    if (!draft) return [];
    const list = planCandidates({ ap: data.ap, loans: data.loans, banks: data.banks, month, extraAp: draft.extraAp, custom: draft.custom, approvals: data.approvals });
    if (internal.pending.length || internal.posted.length) {
      list.push({
        key: 'internal',
        kind: 'INTERNAL',
        refId: null,
        label: 'Chi tiêu nội bộ đã duyệt',
        partner: `${internal.pending.length} chứng từ chờ kết xuất${internal.posted.length ? ` · đã kết chuyển ${fmtVND(internal.postedOut)}` : ''}`,
        dueDate: null,
        outstanding: internal.pendingOut,
        defaultPriority: 'P1',
        category: 'Chi nội bộ',
      });
    }
    return list;
  }, [data.ap, data.loans, data.banks, data.approvals, month, draft, internal]);
  const rows = useMemo(
    () =>
      draft
        ? mergePlanRows(candidates, draft).map((r) =>
            r.kind === 'INTERNAL' ? { ...r, priority: 'P1', mode: 'FULL', amount: r.outstanding, remainingAfter: 0, edited: false } : r,
          )
        : [],
    [candidates, draft],
  );
  const planRaw = useMemo(
    () =>
      computePlan({
        cashBalance: cashBal,
        reserve: draft?.reserve || 0,
        deposits: bank.totals.deposit,
        includeDeposits: draft?.includeDeposits ?? true,
        arRows,
        creditAvailable: bank.totals.available,
        creditBanks: bank.rows,
        includeCredit: !!draft?.includeCredit,
        rows,
      }),
    [cashBal, draft, bank, arRows, rows],
  );
  // Đánh dấu khoản đầu tiên làm số dư lũy kế âm (từ đó phải dùng tiền vay)
  const plan = useMemo(() => {
    let crossed = false;
    return {
      ...planRaw,
      rows: planRaw.rows.map((r) => {
        const crossing = !crossed && r.selected && r.overflow;
        if (crossing) crossed = true;
        return crossing ? { ...r, crossing: true } : r;
      }),
    };
  }, [planRaw]);

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
  const onAmount = (key, v) => {
    const r = rows.find((x) => x.key === key);
    if (r && r.kind !== 'CUSTOM' && v === r.outstanding) setItem(key, { mode: 'FULL', amount: null });
    else setItem(key, { amount: v, mode: 'PART' });
  };
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

  /* ---------- bảng ưu tiên nhóm P1 / P2 / P3 ---------- */
  const [filter, setFilter] = useState('ALL');
  const [drawerKey, setDrawerKey] = useState(null);
  const rowKeys = rows.map((r) => r.key);
  const groups = useMemo(() => {
    const g = { P1: [], P2: [], P3: [] };
    for (const r of plan.rows) if (matchFilter(r, filter)) g[r.priority]?.push(r);
    return g;
  }, [plan.rows, filter]);
  // Kéo-thả trong một nhóm: đổi chỗ các khoản của nhóm, giữ nguyên vị trí các khoản khác trong thứ tự chung
  const reorderGroup = (groupKeys) => (from, to) =>
    edit((d) => {
      const moved = arrayMove(groupKeys, from, to);
      const inGroup = new Set(groupKeys);
      let i = 0;
      return { ...d, order: rowKeys.map((k) => (inGroup.has(k) ? moved[i++] : k)) };
    });
  const keysP1 = groups.P1.map((r) => r.key);
  const keysP2 = groups.P2.map((r) => r.key);
  const keysP3 = groups.P3.map((r) => r.key);
  const sortables = {
    P1: useSortableList(keysP1, reorderGroup(keysP1)),
    P2: useSortableList(keysP2, reorderGroup(keysP2)),
    P3: useSortableList(keysP3, reorderGroup(keysP3)),
  };
  const onQuick = (row, pct) => (pct >= 100 ? setItem(row.key, { mode: 'FULL', amount: null }) : setItem(row.key, { mode: 'PART', amount: Math.round((row.outstanding * pct) / 100 / 1000) * 1000 }));
  const onNote = (key, note) => setItem(key, { note });
  const drawerRow = drawerKey ? plan.rows.find((r) => r.key === drawerKey) || null : null;
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
      'includeCredit',
      'creditInSources',
      'available',
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
      ...pick(plan, ['payTotal', 'byPriority', 'groups', 'groupCount', 'balance', 'balanceAvailable', 'shortfall', 'needCredit', 'suggestedDraw', 'uncovered', 'balanceAfterDraw']),
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

  const negative = plan.balance < 0;
  const exportPdf = () => startExport({ ...buildSnapshot(), version: null, createdBy: actor.email }, null);
  const exportExcel = async () => {
    try {
      await downloadPlanXlsx({ plan, arRows, month, companyName: getCompanyName() });
      toast.success('Đã xuất file Excel bảng điều phối');
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  return (
    <div>
      <PageHeader
        icon={CalendarRange}
        tone="orchid"
        title="Bảng điều phối tài chính tháng"
        subtitle="10 giây: có bao nhiêu · chi bao nhiêu · còn bao nhiêu"
        actions={
          <>
            <MonthPicker value={month} onChange={setMonth} />
            <SaveBadge />
            <PlanActionsMobile exporting={!!reportDoc} onLock={() => setModal('lock')} onPdf={exportPdf} onExcel={exportExcel} />
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

      {/* ===================== TẦNG 1: THANH TỔNG HỢP ===================== */}
      <PlanTopBar
        plan={plan}
        exporting={!!reportDoc}
        onLock={() => setModal('lock')}
        onPdf={exportPdf}
        onExcel={exportExcel}
      />

      {/* ===================== TẦNG 2: NGUỒN TIỀN VÀO ===================== */}
      <CashInStrip
        plan={plan}
        cashBal={cashBal}
        deposits={bank.totals.deposit}
        credit={bank.totals.available}
        draft={draft}
        arRows={arRows}
        edit={edit}
        setAr={setAr}
        quick={quick}
        onExtraAr={() => setModal('extraAr')}
      />

      {/* ===================== TẦNG 3: BẢNG ƯU TIÊN ===================== */}
      <PriorityTable
        plan={plan}
        groups={groups}
        filter={filter}
        setFilter={setFilter}
        sortables={sortables}
        handlers={{ onToggle, onAmount, onQuick, onPriority, onOpen: (r) => setDrawerKey(r.key) }}
        onAddFixed={() => setModal('fixed')}
        onExtraAp={() => setModal('extraAp')}
        onSort={sortByPriority}
        onReset={resetDraft}
      />

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
      {drawerRow && (
        <RowDrawer
          row={drawerRow}
          data={data}
          note={draft.items?.[drawerRow.key]?.note || ''}
          onNote={onNote}
          onClose={() => setDrawerKey(null)}
          onApprove={can(role, 'approvePayments') ? onApprove : null}
          onRemove={onRemove}
          supplier={drawerRow.kind === 'AP' ? findSupplier(data.suppliers, { supplierId: drawerRow.supplierId, partnerName: drawerRow.partner }) : null}
          internal={internal}
        />
      )}
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
