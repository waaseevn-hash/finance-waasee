/**
 * MÀN HÌNH THAO TÁC NHANH
 * Bấm vào bất kỳ ô số liệu nào (tiền mặt, tín dụng, tiền gửi, phải thu, phải trả)
 * sẽ mở bảng trượt này để xem chi tiết và thêm / sửa / xóa khoản ngay tại chỗ.
 */
import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import {
  Building2,
  CircleArrowDown,
  CircleArrowUp,
  CircleCheck,
  ClipboardCheck,
  HandCoins,
  History,
  Landmark,
  Lock,
  Pencil,
  PiggyBank,
  Plus,
  ReceiptText,
  Trash2,
  Vault,
  Wallet,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { useData } from '../context/DataContext.jsx';
import { AuditedBatch, C, friendlyError } from '../lib/db.js';
import { apSummary, arSummary, bankSummary, cashLedger, cashMonthStats, loanInterestForMonth, loanLabel, remaining } from '../lib/calc.js';
import { currentMonth, daysBetween, describeDays, fmtDate, monthLabel, monthRange, todayISO } from '../lib/dates.js';
import { fmtPct } from '../lib/format.js';
import { can } from '../lib/roles.js';
import { Money, MoneyInput } from './Money.jsx';
import { useConfirm, useToast } from './feedback.jsx';
import { Badge, Button, Drawer, EmptyState, MonthPicker, ProgressBar, Segmented, cx } from './ui.jsx';
import { CountModal, EntryModal, TYPE_LABEL, deleteCashEntry } from './forms/cashForms.jsx';
import { BANK_KEYS, BankModal, LOAN_KEYS, LoanModal, SettleModal, daysTone, deleteLoan, pickRaw } from './forms/bankForms.jsx';
import { DebtModal, HistoryModal, KIND, PaymentModal, deleteDebt, raw } from './forms/debtForms.jsx';
import { ApprovalBadge, useApprovalFlow } from './forms/approvalForms.jsx';
import { SupplierInfo, findSupplier } from './forms/supplierForms.jsx';

const QuickContext = createContext({ open: () => {} });

export function QuickPanelProvider({ children }) {
  const { role } = useAuth();
  const [panel, setPanel] = useState(null);
  const open = useCallback(
    (kind, opts = {}) => {
      if (['cash', 'credit', 'deposits'].includes(kind) && !can(role, 'viewTreasury')) return;
      setPanel({ kind, opts });
    },
    [role],
  );
  const close = useCallback(() => setPanel(null), []);
  const value = useMemo(() => ({ open }), [open]);
  return (
    <QuickContext.Provider value={value}>
      {children}
      {panel?.kind === 'cash' && <CashPanel opts={panel.opts} onClose={close} />}
      {panel?.kind === 'credit' && <CreditPanel opts={panel.opts} onClose={close} />}
      {panel?.kind === 'deposits' && <DepositPanel onClose={close} />}
      {(panel?.kind === 'ar' || panel?.kind === 'ap') && <DebtPanel kind={panel.kind} opts={panel.opts} onClose={close} />}
    </QuickContext.Provider>
  );
}

export function useQuick() {
  return useContext(QuickContext);
}

function HeroStat({ label, value, className = '' }) {
  return (
    <div className={className}>
      <p className="text-xs text-white/75">{label}</p>
      <Money value={value} compact className="block sm:hidden font-display text-base font-bold text-white" />
      <Money value={value} className="hidden sm:block font-display text-lg font-bold text-white" />
    </div>
  );
}

function RowAction({ icon: Icon, title, onClick, tone = 'slate' }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={onClick}
      className={cx(
        'grid h-8 w-8 shrink-0 place-items-center rounded-lg transition-colors',
        tone === 'danger' ? 'text-slate-400 hover:bg-rose-50 hover:text-rose-600' : 'text-slate-400 hover:bg-slate-100 hover:text-ink-900',
      )}
    >
      <Icon className="h-4 w-4" />
    </button>
  );
}

/* =============================== Tiền mặt =============================== */
function CashPanel({ opts, onClose }) {
  const { cash } = useData();
  const { actor } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [month, setMonth] = useState(opts.month || currentMonth());
  const [type, setType] = useState(opts.type || 'ALL');
  const [modal, setModal] = useState(null);
  const [countOpen, setCountOpen] = useState(false);

  const ledger = useMemo(() => cashLedger(cash), [cash]);
  const balance = ledger.length ? ledger[ledger.length - 1].balance : 0;
  const stats = useMemo(() => cashMonthStats(cash, month), [cash, month]);
  const { start, end } = monthRange(month);
  const rows = ledger.filter((e) => e.date >= start && e.date <= end && (type === 'ALL' || e.type === type)).reverse();

  const remove = async (e) => {
    const ok = await confirm({
      title: 'Xóa phiếu này?',
      message: `Phiếu ${TYPE_LABEL[e.type].toLowerCase()} — "${e.description}". Thao tác được ghi vào nhật ký.`,
      confirmText: 'Xóa phiếu',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteCashEntry(actor, e);
      toast.success('Đã xóa phiếu');
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      tone="jade"
      icon={Vault}
      title="Tiền mặt trong két"
      subtitle="Thêm phiếu thu / chi, sửa hoặc xóa ngay tại đây"
      hero={
        <div className="grid grid-cols-3 gap-3">
          <HeroStat label="Tồn quỹ hiện tại" value={balance} />
          <HeroStat label={`Thu ${monthLabel(month).toLowerCase()}`} value={stats.inSum} />
          <HeroStat label="Chi trong tháng" value={stats.outSum} />
        </div>
      }
      footer={
        <div className="grid grid-cols-3 gap-2">
          <Button variant="jade" icon={CircleArrowDown} onClick={() => setModal({ type: 'IN' })}>
            Thu tiền
          </Button>
          <Button variant="vermilion" icon={CircleArrowUp} onClick={() => setModal({ type: 'OUT' })}>
            Chi tiền
          </Button>
          <Button icon={ClipboardCheck} onClick={() => setCountOpen(true)}>
            Kiểm kê
          </Button>
        </div>
      }
    >
      <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
        <MonthPicker value={month} onChange={setMonth} />
        <Segmented
          value={type}
          onChange={setType}
          options={[
            { value: 'ALL', label: 'Tất cả' },
            { value: 'IN', label: 'Thu', activeClass: 'text-jade-700' },
            { value: 'OUT', label: 'Chi', activeClass: 'text-vermilion-600' },
          ]}
        />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={Vault} title="Chưa có phiếu nào trong tháng" description="Bấm Thu tiền hoặc Chi tiền bên dưới để ghi phiếu đầu tiên." />
      ) : (
        <ul className="space-y-2">
          {rows.map((e) => (
            <li key={e.id} className="flex items-center gap-3 rounded-xl bg-white px-3 py-2.5 border border-slate-200/70">
              <span className={cx('grid h-9 w-9 shrink-0 place-items-center rounded-full', e.type === 'IN' ? 'bg-jade-50 text-jade-600' : 'bg-vermilion-50 text-vermilion-600')}>
                {e.type === 'IN' ? <CircleArrowDown className="h-4 w-4" /> : <CircleArrowUp className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink-900 truncate">{e.description}</p>
                <p className="text-xs text-slate-500 truncate">
                  {fmtDate(e.date)}
                  {e.counterparty && ` · ${e.counterparty}`}
                </p>
              </div>
              <div className="text-right">
                <Money value={e.type === 'IN' ? e.amount : -e.amount} sign className={cx('block text-sm font-bold', e.type === 'IN' ? 'text-jade-600' : 'text-vermilion-600')} />
                <span className="text-[11px] text-slate-400">
                  Tồn <Money value={e.balance} />
                </span>
              </div>
              {e.voucherId ? (
                <RowAction icon={Lock} title={`Bút toán từ chứng từ ${e.voucherNo || ''} — đã khóa`} onClick={() => setModal({ initial: e })} />
              ) : (
                <>
                  <RowAction icon={Pencil} title="Sửa" onClick={() => setModal({ initial: e })} />
                  <RowAction icon={Trash2} title="Xóa" tone="danger" onClick={() => remove(e)} />
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <EntryModal open={!!modal} onClose={() => setModal(null)} initial={modal?.initial} defaultType={modal?.type} balance={balance} />
      <CountModal open={countOpen} onClose={() => setCountOpen(false)} balance={balance} />
    </Drawer>
  );
}

/* =============================== Tín dụng ngân hàng =============================== */
function CreditPanel({ onClose }) {
  const { banks, loans } = useData();
  const { actor } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [bankModal, setBankModal] = useState(null);
  const [loanModal, setLoanModal] = useState(null);
  const [settle, setSettle] = useState(null);
  const today = todayISO();
  const summary = useMemo(() => bankSummary(banks, loans, today), [banks, loans, today]);
  const bankName = (id) => banks.find((b) => b.id === id)?.name || '(ngân hàng đã xóa)';
  const active = loans
    .filter((l) => l.status === 'ACTIVE')
    .map((l) => ({ ...l, days: l.maturityDate ? daysBetween(today, l.maturityDate) : null }))
    .sort((a, b) => (a.maturityDate || '').localeCompare(b.maturityDate || ''));
  const t = summary.totals;

  const remove = async (l) => {
    const ok = await confirm({
      title: `Xóa ${loanLabel(l, { lower: true })}?`,
      message: 'Chỉ xóa khi nhập nhầm. Khoản vay đã trả xong hãy dùng “Tất toán”.',
      confirmText: 'Xóa',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteLoan(actor, l, bankName(l.bankId));
      toast.success('Đã xóa khoản vay');
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      tone="sapphire"
      icon={Landmark}
      title="Vay ngân hàng"
      subtitle="Dư nợ đang vay và số tiền còn được vay"
      hero={
        <div>
          <div className="grid grid-cols-3 gap-3">
            <HeroStat label="Dư nợ đang vay" value={t.outstanding} />
            <HeroStat label="Còn được vay" value={t.available} />
            <HeroStat label="Tổng hạn mức" value={t.limit} />
          </div>
          <div className="mt-3 h-2 rounded-full bg-white/20 overflow-hidden">
            <div className="h-full rounded-full bg-white" style={{ width: `${t.usedPct}%` }} />
          </div>
          <p className="mt-1 text-[11px] text-white/75">Đã dùng {fmtPct(t.usedPct, 0)} hạn mức</p>
        </div>
      }
      footer={
        <div className="grid grid-cols-2 gap-2">
          <Button variant="blue" icon={Plus} onClick={() => setLoanModal({})} disabled={!banks.length}>
            Khoản vay mới
          </Button>
          <Button icon={Building2} onClick={() => setBankModal({})}>
            Thêm ngân hàng
          </Button>
        </div>
      }
    >
      <p className="mb-2 text-sm font-semibold text-ink-900">Theo từng ngân hàng</p>
      {summary.rows.length === 0 ? (
        <EmptyState icon={Landmark} title="Chưa có ngân hàng" description="Bấm “Thêm ngân hàng” để nhập hạn mức được cấp." />
      ) : (
        <ul className="space-y-2 mb-5">
          {summary.rows.map((b) => (
            <li key={b.id} className="rounded-xl bg-white border border-slate-200/70 px-3 py-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold text-ink-900 truncate">{b.name}</p>
                <div className="flex">
                  <RowAction icon={Plus} title="Vay thêm" onClick={() => setLoanModal({ bankId: b.id })} />
                  <RowAction icon={Pencil} title="Sửa hạn mức" onClick={() => setBankModal({ initial: pickRaw(b, BANK_KEYS) })} />
                </div>
              </div>
              <ProgressBar value={b.usedPct} className="mt-2" />
              <div className="mt-1.5 flex justify-between text-xs text-slate-500">
                <span>
                  Dư nợ <Money value={b.outstanding} className="font-semibold text-ink-900" />
                </span>
                <span>
                  Còn được vay <Money value={b.available} className="font-semibold text-sapphire-600" />
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="mb-2 text-sm font-semibold text-ink-900">Các khoản vay đang vay ({active.length})</p>
      {active.length === 0 ? (
        <p className="rounded-xl bg-white px-3 py-4 text-center text-sm text-slate-500">Không có khoản vay nào đang vay.</p>
      ) : (
        <ul className="space-y-2">
          {active.map((l) => (
            <li key={l.id} className="rounded-xl bg-white border border-slate-200/70 px-3 py-2.5">
              <div className="flex items-start gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold text-ink-900 truncate">{loanLabel(l)}</p>
                  <p className="text-xs text-slate-500 truncate">
                    {bankName(l.bankId)} · {fmtPct(l.interestRate, 2)}/năm · lãi tháng ≈ <Money value={loanInterestForMonth(l, currentMonth())} />
                  </p>
                  <Badge tone={daysTone(l.days)} className="mt-1">
                    Đáo hạn {fmtDate(l.maturityDate)} · {describeDays(l.days)}
                  </Badge>
                </div>
                <Money value={l.amount} className="text-sm font-bold text-ink-900" />
              </div>
              <div className="mt-2 flex justify-end gap-1">
                <Button size="xs" variant="success" icon={CircleCheck} onClick={() => setSettle(pickRaw(l, LOAN_KEYS))}>
                  Tất toán
                </Button>
                <Button size="xs" icon={Pencil} onClick={() => setLoanModal({ initial: pickRaw(l, LOAN_KEYS) })}>
                  Sửa
                </Button>
                <Button size="xs" variant="dangerGhost" icon={Trash2} onClick={() => remove(l)}>
                  Xóa
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <BankModal open={!!bankModal} onClose={() => setBankModal(null)} initial={bankModal?.initial} />
      <LoanModal open={!!loanModal} onClose={() => setLoanModal(null)} initial={loanModal?.initial} defaultBankId={loanModal?.bankId} banks={banks} bankRows={summary.rows} />
      <SettleModal open={!!settle} onClose={() => setSettle(null)} loan={settle} bankName={settle ? bankName(settle.bankId) : ''} />
    </Drawer>
  );
}

/* =============================== Tiền gửi tài khoản =============================== */
function DepositRow({ bank }) {
  const { actor } = useAuth();
  const toast = useToast();
  const [v, setV] = useState(Number(bank.depositBalance) || 0);
  const [busy, setBusy] = useState(false);
  const dirty = v !== (Number(bank.depositBalance) || 0);
  const save = async () => {
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      b.update(C.banks, bank.id, { depositBalance: Math.round(v) }, pickRaw(bank, BANK_KEYS), `Cập nhật số dư tiền gửi ${bank.name}`);
      await b.commit();
      toast.success(`Đã cập nhật số dư ${bank.name}`);
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="rounded-xl bg-white border border-slate-200/70 px-3 py-3">
      <p className="text-sm font-semibold text-ink-900">{bank.name}</p>
      <div className="mt-2 flex items-start gap-2">
        <div className="flex-1">
          <MoneyInput value={v} onChange={setV} />
        </div>
        <Button variant={dirty ? 'primary' : 'secondary'} disabled={!dirty} loading={busy} onClick={save}>
          Lưu
        </Button>
      </div>
    </li>
  );
}

function DepositPanel({ onClose }) {
  const { banks, loans } = useData();
  const [bankModal, setBankModal] = useState(false);
  const total = bankSummary(banks, loans).totals.deposit;
  return (
    <Drawer
      open
      onClose={onClose}
      tone="lagoon"
      icon={PiggyBank}
      title="Tiền gửi tài khoản ngân hàng"
      subtitle="Cập nhật số dư theo sao kê / ứng dụng ngân hàng"
      hero={<HeroStat label="Tổng tiền gửi" value={total} />}
      footer={
        <Button icon={Building2} className="w-full" onClick={() => setBankModal(true)}>
          Thêm tài khoản ngân hàng
        </Button>
      }
    >
      {banks.length === 0 ? (
        <EmptyState icon={PiggyBank} title="Chưa có tài khoản ngân hàng" />
      ) : (
        <ul className="space-y-2">
          {banks.map((b) => (
            <DepositRow key={`${b.id}-${b.depositBalance}`} bank={b} />
          ))}
        </ul>
      )}
      <BankModal open={bankModal} onClose={() => setBankModal(false)} />
    </Drawer>
  );
}

/* =============================== Công nợ =============================== */
const DEBT_FILTERS = {
  ar: [
    { value: 'all', label: 'Còn nợ' },
    { value: 'inTerm', label: 'Trong hạn' },
    { value: 'overdue', label: 'Quá hạn' },
    { value: 'doubtful', label: 'Khó đòi' },
  ],
  ap: [
    { value: 'all', label: 'Còn nợ' },
    { value: 'month', label: 'Đến hạn tháng này' },
    { value: 'overdue', label: 'Quá hạn' },
    { value: 'p1', label: 'P1' },
  ],
};

function DebtPanel({ kind, opts, onClose }) {
  const cfg = KIND[kind];
  const data = useData();
  const { actor, role } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [filter, setFilter] = useState(opts.filter || 'all');
  const [debtModal, setDebtModal] = useState(null);
  const [payDebt, setPayDebt] = useState(null);
  const [histDebt, setHistDebt] = useState(null);
  const flow = useApprovalFlow({ ap: data.ap, approvals: data.approvals, suppliers: data.suppliers });
  const list = kind === 'ar' ? data.ar : data.ap;
  const today = todayISO();
  const monthEnd = monthRange(today.slice(0, 7)).end;
  const s = kind === 'ar' ? arSummary(data.ar, today) : apSummary(data.ap, today);

  const rows = list
    .map((r) => ({ ...r, remain: remaining(r), days: r.dueDate ? daysBetween(today, r.dueDate) : null }))
    .filter((r) => r.remain > 0)
    .filter((r) => {
      if (filter === 'overdue') return r.dueDate && r.dueDate < today;
      if (filter === 'inTerm') return !r.dueDate || r.dueDate >= today;
      if (filter === 'doubtful') return r.certainty === 'DOUBTFUL';
      if (filter === 'month') return r.dueDate && r.dueDate <= monthEnd;
      if (filter === 'p1') return (r.priority || 'P2') === 'P1';
      return true;
    })
    .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  const fresh = (d) => (d ? list.find((x) => x.id === d.id) || d : null);
  const partnerNames = [...new Set([...data.ar, ...data.ap].map((r) => r.partnerName).filter(Boolean))].sort();

  const remove = async (r) => {
    const ok = await confirm({
      title: `Xóa công nợ ${cfg.name}?`,
      message: `${r.partnerName} — lịch sử thanh toán của khoản này cũng bị xóa. Thao tác được ghi vào nhật ký.`,
      confirmText: 'Xóa công nợ',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDebt(actor, kind, r);
      toast.success('Đã xóa công nợ');
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  return (
    <Drawer
      open
      onClose={onClose}
      tone={kind === 'ar' ? 'lagoon' : 'vermilion'}
      icon={kind === 'ar' ? HandCoins : ReceiptText}
      title={kind === 'ar' ? 'Công nợ phải thu' : 'Công nợ phải trả'}
      subtitle={kind === 'ar' ? 'Ghi nhận tiền khách trả, thêm khoản phải thu' : 'Duyệt chi, xác nhận đã chuyển tiền, thêm khoản phải trả'}
      hero={
        kind === 'ar' ? (
          <div className="grid grid-cols-3 gap-3">
            <HeroStat label="Tổng còn phải thu" value={s.total} />
            <HeroStat label="Trong hạn" value={s.inTerm} />
            <HeroStat label="Quá hạn" value={s.overdue} />
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            <HeroStat label="Đến hạn tháng này" value={s.dueThisMonth} />
            <HeroStat label="Quá hạn" value={s.overdue} />
            <HeroStat label="Tổng còn phải trả" value={s.total} />
          </div>
        )
      }
      footer={
        <Button variant={kind === 'ar' ? 'jade' : 'vermilion'} icon={Plus} className="w-full" onClick={() => setDebtModal({})}>
          Thêm khoản {cfg.name}
        </Button>
      }
    >
      <div className="mb-3 overflow-x-auto thin-scroll">
        <Segmented value={filter} onChange={setFilter} options={DEBT_FILTERS[kind]} />
      </div>
      {rows.length === 0 ? (
        <EmptyState icon={kind === 'ar' ? HandCoins : ReceiptText} title="Không có khoản nào" description={`Bấm “Thêm khoản ${cfg.name}” để ghi nhận.`} />
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const lv = cfg.levels[r[cfg.levelField] || cfg.defaultLevel];
            const sup = kind === 'ap' ? findSupplier(data.suppliers, r) : null;
            return (
              <li key={r.id} className="rounded-xl bg-white border border-slate-200/70 px-3 py-3">
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-ink-900 truncate">{r.partnerName}</p>
                    {r.description && <p className="text-xs text-slate-500 truncate">{r.description}</p>}
                    {sup && <SupplierInfo supplier={sup} compact className="mt-0.5" />}
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <Badge tone={lv?.tone}>{kind === 'ap' ? lv?.short : lv?.label}</Badge>
                      {r.days != null && <Badge tone={r.days < 0 ? 'red' : r.days <= 7 ? 'amber' : 'slate'}>{`${fmtDate(r.dueDate)} · ${describeDays(r.days)}`}</Badge>}
                      {kind === 'ap' && <ApprovalBadge approval={flow.openByPayable.get(r.id)} outstanding={r.remain} />}
                    </div>
                  </div>
                  <div className="text-right">
                    <Money value={r.remain} className={cx('block text-sm font-bold', kind === 'ar' ? 'text-jade-700' : 'text-vermilion-600')} />
                    <span className="text-[11px] text-slate-400">
                      / <Money value={r.total} />
                    </span>
                  </div>
                </div>
                <div className="mt-2 flex justify-end gap-1">
                  {kind === 'ap' ? (
                    flow.actionsFor(r)
                  ) : (
                    <Button size="xs" variant="jade" icon={Wallet} onClick={() => setPayDebt(raw(r))}>
                      {cfg.payVerb}
                    </Button>
                  )}
                  <Button size="xs" icon={History} onClick={() => setHistDebt(raw(r))}>
                    Lịch sử
                  </Button>
                  <Button size="xs" icon={Pencil} onClick={() => setDebtModal({ initial: raw(r) })}>
                    Sửa
                  </Button>
                  {can(role, 'deleteDebts') && <Button size="xs" variant="dangerGhost" icon={Trash2} onClick={() => remove(r)} />}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <DebtModal open={!!debtModal} onClose={() => setDebtModal(null)} kind={kind} initial={debtModal?.initial} partnerNames={partnerNames} />
      <PaymentModal open={!!payDebt} onClose={() => setPayDebt(null)} kind={kind} debt={payDebt} />
      {flow.modals}
      <HistoryModal open={!!histDebt} onClose={() => setHistDebt(null)} kind={kind} debt={fresh(histDebt) && raw(fresh(histDebt))} />
    </Drawer>
  );
}

