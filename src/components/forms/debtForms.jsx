import { useEffect, useMemo, useState } from 'react';
import { collection, getDocs, increment, onSnapshot, query, where } from 'firebase/firestore';
import {
  CircleArrowDown,
  CircleArrowUp,
  FileSpreadsheet,
  HandCoins,
  History,
  Pencil,
  Plus,
  Search,
  Trash2,
  Wallet,
} from 'lucide-react';
import { db } from '../../lib/firebase.js';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { AuditedBatch, C, friendlyError } from '../../lib/db.js';
import { apSummary, approvalAmount, arSummary, remaining, tsMillis } from '../../lib/calc.js';
import { daysBetween, describeDays, fmtDate, todayISO } from '../../lib/dates.js';
import { fmtVND, matchSearch } from '../../lib/format.js';
import { CERTAINTY, PAY_METHOD, PRIORITY } from '../../lib/constants.js';
import { can } from '../../lib/roles.js';
import { downloadXlsx } from '../../lib/xlsx.js';
import { Who } from '../Who.jsx';
import { SupplierInfo, SupplierPaymentFields, cleanSupplier, emptySupplier, findSupplier, pickSupplier } from './supplierForms.jsx';
import { pickApproval } from '../../lib/approvals.js';

const supplierFieldsOf = (s) =>
  s ? { taxCode: s.taxCode || '', bankAccount: s.bankAccount || '', bankName: s.bankName || '', bankBranch: s.bankBranch || '', accountHolder: s.accountHolder || '' } : {};
import { Money, MoneyInput } from '../Money.jsx';
import { useConfirm, useToast } from '../feedback.jsx';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  Segmented,
  Select,
  TableWrap,
  Tabs,
  Textarea,
  cx,
  td,
  th,
} from '../ui.jsx';

export const KIND = {
  ar: {
    coll: C.ar,
    payKind: 'AR',
    name: 'phải thu',
    partnerLabel: 'Khách hàng',
    paidLabel: 'Đã thu',
    remainLabel: 'Còn phải thu',
    dueLabel: 'Ngày dự kiến tiền về',
    payVerb: 'Thu tiền',
    cashType: 'IN',
    levelField: 'certainty',
    levelLabel: 'Mức độ chắc chắn',
    levels: CERTAINTY,
    defaultLevel: 'SURE',
    openingLabel: 'Đã thu trước khi nhập hệ thống',
  },
  ap: {
    coll: C.ap,
    payKind: 'AP',
    name: 'phải trả',
    partnerLabel: 'Nhà cung cấp / Đối tác',
    paidLabel: 'Đã trả',
    remainLabel: 'Còn phải trả',
    dueLabel: 'Hạn thanh toán',
    payVerb: 'Trả tiền',
    cashType: 'OUT',
    levelField: 'priority',
    levelLabel: 'Mức độ ưu tiên mặc định',
    levels: PRIORITY,
    defaultLevel: 'P2',
    openingLabel: 'Đã trả trước khi nhập hệ thống',
  },
};

export const RAW_KEYS = ['id', 'partnerName', 'description', 'total', 'paid', 'openingPaid', 'dueDate', 'certainty', 'priority', 'note', 'supplierId', '_auditId'];
export const raw = (r) => Object.fromEntries(RAW_KEYS.filter((k) => r[k] !== undefined).map((k) => [k, r[k]]));

/* ------------------------ Thêm / sửa công nợ ------------------------ */
export function DebtModal({ open, onClose, kind, initial, partnerNames }) {
  const cfg = KIND[kind];
  const { actor } = useAuth();
  const { suppliers } = useData();
  const toast = useToast();
  const isAp = kind === 'ap';
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    setErr({});
    setF({
      partnerName: initial?.partnerName || '',
      description: initial?.description || '',
      total: initial?.total || 0,
      openingPaid: initial?.openingPaid || 0,
      dueDate: initial?.dueDate || '',
      level: initial?.[cfg.levelField] || cfg.defaultLevel,
      note: initial?.note || '',
      ...emptySupplier(),
      ...(isAp ? supplierFieldsOf(findSupplier(suppliers, initial || {})) : {}),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, cfg]);
  if (!open || !f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const matched = isAp ? findSupplier(suppliers, { partnerName: f.partnerName }) : null;
  // Chọn đúng tên NCC trong danh bạ -> tự điền MST, số tài khoản, ngân hàng
  const setPartner = (e) => {
    const name = e.target.value;
    const sup = isAp ? findSupplier(suppliers, { partnerName: name }) : null;
    setF((x) => ({ ...x, partnerName: name, ...(sup ? supplierFieldsOf(sup) : {}) }));
  };
  const paidViaPayments = initial ? (initial.paid || 0) - (initial.openingPaid || 0) : 0;

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!f.partnerName.trim()) er.partnerName = 'Nhập tên đối tác';
    if (!(Number(f.total) > 0)) er.total = 'Tổng công nợ phải lớn hơn 0';
    if (Number(f.openingPaid) + paidViaPayments > Number(f.total)) er.openingPaid = 'Số đã thanh toán vượt tổng công nợ';
    setErr(er);
    if (Object.keys(er).length) return;
    const opening = Math.round(Number(f.openingPaid) || 0);
    const data = {
      partnerName: matched ? matched.name : f.partnerName.trim(),
      description: f.description.trim(),
      total: Math.round(Number(f.total)),
      openingPaid: opening,
      dueDate: f.dueDate || '',
      [cfg.levelField]: f.level,
      note: f.note.trim(),
    };
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      if (isAp) {
        // Lưu / cập nhật thông tin NCC trong danh bạ, rồi gắn khoản phải trả vào NCC đó
        const sup = cleanSupplier({ ...f, name: data.partnerName, contactName: matched?.contactName, phone: matched?.phone, address: matched?.address, note: matched?.note });
        if (matched) {
          const changed = ['taxCode', 'bankAccount', 'bankName', 'bankBranch', 'accountHolder'].some((k) => (matched[k] || '') !== sup[k]);
          if (changed) b.update(C.partners, matched.id, sup, pickSupplier(matched), `Cập nhật thông tin nhà cung cấp ${sup.name}`);
          data.supplierId = matched.id;
        } else {
          data.supplierId = b.create(C.partners, { ...sup, kind: 'SUPPLIER' }, `Thêm nhà cung cấp ${sup.name}`);
        }
      }
      if (initial) {
        const delta = opening - (initial.openingPaid || 0);
        const newPaid = (initial.paid || 0) + delta;
        b.update(cfg.coll, initial.id, { ...data, paid: increment(delta) }, initial, `Sửa công nợ ${cfg.name}: ${data.partnerName}`, {
          logAfter: { ...initial, ...data, paid: newPaid },
        });
      } else {
        b.create(cfg.coll, { ...data, paid: opening }, `Thêm công nợ ${cfg.name}: ${data.partnerName} — ${fmtVND(data.total)}`);
      }
      await b.commit();
      toast.success('Đã lưu công nợ');
      onClose();
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={`${initial ? 'Sửa' : 'Thêm'} công nợ ${cfg.name}`}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="submit" form="debt-form" variant="primary" loading={busy}>
            Lưu
          </Button>
        </>
      }
    >
      <form id="debt-form" onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field
          label={cfg.partnerLabel}
          required
          error={err.partnerName}
          className="sm:col-span-2"
          hint={isAp && f.partnerName.trim() ? (matched ? 'Đã có trong danh bạ — thông tin thanh toán được điền sẵn' : 'NCC mới — sẽ được thêm vào danh bạ khi lưu') : ''}
        >
          <Input value={f.partnerName} onChange={isAp ? setPartner : set('partnerName')} list="partner-names" placeholder="Tên đối tác" autoFocus />
          <datalist id="partner-names">
            {(isAp ? [...new Set([...suppliers.map((x) => x.name), ...partnerNames])] : partnerNames).map((n) => (
              <option key={n} value={n} />
            ))}
          </datalist>
        </Field>
        {isAp && (
          <div className="sm:col-span-2 rounded-2xl border border-vermilion-100 bg-vermilion-50/50 p-4">
            <p className="mb-3 text-sm font-semibold text-vermilion-700">Thông tin thanh toán của nhà cung cấp</p>
            <SupplierPaymentFields f={f} set={set} />
          </div>
        )}
        <Field label="Diễn giải (hóa đơn, hợp đồng…)" className="sm:col-span-2">
          <Input value={f.description} onChange={set('description')} placeholder="VD: HĐ 0001234 ngày 05/11 – Lô dây điện" />
        </Field>
        <Field label="Tổng công nợ" required error={err.total}>
          <MoneyInput value={f.total} onChange={set('total')} />
        </Field>
        <Field label={cfg.openingLabel} error={err.openingPaid} hint="Các lần thanh toán sau ghi bằng nút “Thanh toán”">
          <MoneyInput value={f.openingPaid} onChange={set('openingPaid')} />
        </Field>
        <Field label={cfg.dueLabel}>
          <Input type="date" value={f.dueDate} onChange={set('dueDate')} />
        </Field>
        <Field label={cfg.levelLabel}>
          <Select value={f.level} onChange={set('level')}>
            {Object.entries(cfg.levels).map(([k, v]) => (
              <option key={k} value={k}>
                {v.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          <Textarea value={f.note} onChange={set('note')} />
        </Field>
        {initial && paidViaPayments > 0 && (
          <p className="sm:col-span-2 text-xs text-slate-500">
            Đã ghi nhận qua các lần thanh toán: <Money value={paidViaPayments} className="font-medium" />
          </p>
        )}
      </form>
    </Modal>
  );
}

/* --------------------------- Ghi thanh toán --------------------------- */
export function PaymentModal({ open, onClose, kind, debt, approval = null }) {
  const cfg = KIND[kind];
  const { actor, role } = useAuth();
  const toast = useToast();
  const allowCash = can(role, 'linkCashbook');
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const rem = debt ? remaining(debt) : 0;

  useEffect(() => {
    if (!open || !debt) return;
    setErr('');
    setF({ amount: approval ? approvalAmount(approval, remaining(debt)) : remaining(debt), date: todayISO(), method: 'BANK', note: '', linkCash: true });
  }, [open, debt, approval]);
  if (!open || !debt || !f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const submit = async (e) => {
    e.preventDefault();
    const amount = Math.round(Number(f.amount) || 0);
    if (amount <= 0) return setErr('Số tiền phải lớn hơn 0');
    if (amount > rem) return setErr(`Vượt số ${cfg.remainLabel.toLowerCase()} (${fmtVND(rem)}). Nếu tổng công nợ sai, hãy sửa công nợ trước.`);
    if (approval && amount > approvalAmount(approval, rem))
      return setErr(`Vượt số tiền đã duyệt chi (${fmtVND(approvalAmount(approval, rem))}). Cần người duyệt sửa lại lệnh duyệt chi.`);
    if (!f.date) return setErr('Chọn ngày');
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      const label = `${cfg.payVerb} ${fmtVND(amount)} — ${debt.partnerName}`;
      let cashEntryId = '';
      if (allowCash && f.method === 'CASH' && f.linkCash) {
        cashEntryId = b.create(
          C.cash,
          {
            date: f.date,
            type: cfg.cashType,
            amount,
            counterparty: debt.partnerName,
            description: `${cfg.payVerb} ${debt.partnerName}${debt.description ? ` — ${debt.description}` : ''}`,
            note: 'Tự động từ ghi nhận thanh toán công nợ',
          },
          `Sổ quỹ (tự động): ${label}`,
        );
      }
      const paymentId = b.create(
        C.payments,
        {
          approvalId: approval?.id || '',
          kind: cfg.payKind,
          parentId: debt.id,
          partnerName: debt.partnerName,
          description: debt.description || '',
          date: f.date,
          amount,
          method: f.method,
          note: f.note.trim(),
          cashEntryId,
        },
        label,
      );
      b.update(cfg.coll, debt.id, { paid: increment(amount) }, debt, `Cập nhật số ${cfg.paidLabel.toLowerCase()}: ${label}`, {
        logAfter: { ...debt, paid: (debt.paid || 0) + amount },
      });
      if (approval) {
        b.update(
          C.approvals,
          approval.id,
          { status: 'DONE', paidAmount: amount, paidOn: f.date, paymentId },
          pickApproval(approval),
          `Đã chuyển tiền theo lệnh duyệt chi: ${fmtVND(amount)} — ${debt.partnerName}`,
        );
      }
      await b.commit();
      toast.success(`Đã ghi nhận ${cfg.payVerb.toLowerCase()} ${fmtVND(amount)}`);
      onClose();
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={approval ? `Xác nhận đã chuyển tiền: ${debt.partnerName}` : `${cfg.payVerb}: ${debt.partnerName}`}
      subtitle={debt.description}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="submit" form="pay-form" variant={kind === 'ar' || approval ? 'success' : 'danger'} loading={busy}>
            {approval ? 'Đã chuyển tiền' : 'Ghi nhận'}
          </Button>
        </>
      }
    >
      <form id="pay-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-slate-50 px-2 py-2">
            <p className="text-slate-500">Tổng</p>
            <Money value={debt.total} className="font-semibold text-slate-800" />
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-2">
            <p className="text-slate-500">{cfg.paidLabel}</p>
            <Money value={debt.paid} className="font-semibold text-slate-800" />
          </div>
          <div className="rounded-lg bg-amber-50 px-2 py-2">
            <p className="text-amber-700">Còn lại</p>
            <Money value={rem} className="font-semibold text-amber-800" />
          </div>
        </div>
        {approval && (
          <div className="rounded-xl border border-jade-100 bg-jade-50/60 px-3 py-2.5 text-sm">
            <p className="text-jade-800">
              Đã duyệt chi <b>{approval.mode === 'FULL' ? 'hết' : '1 phần'}</b>: <Money value={approvalAmount(approval, rem)} className="font-bold" />
              {approval.approvedOn && <span className="text-xs text-jade-700"> · ngày {fmtDate(approval.approvedOn)}</span>}
            </p>
            {approval.note && <p className="mt-0.5 text-xs text-slate-600">Ghi chú của người duyệt: {approval.note}</p>}
            <SupplierInfo supplier={approval.supplier} className="mt-1" />
          </div>
        )}
        <Field label={approval ? 'Số tiền đã chuyển' : 'Số tiền đợt này'} required hint={approval ? 'Không vượt số đã duyệt' : 'Có thể nhập nhỏ hơn số còn lại (thanh toán một phần)'}>
          <MoneyInput value={f.amount} onChange={set('amount')} autoFocus />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Ngày">
            <Input type="date" value={f.date} onChange={set('date')} />
          </Field>
          <Field label="Hình thức">
            <Select value={f.method} onChange={set('method')}>
              {Object.entries(PAY_METHOD).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {allowCash && f.method === 'CASH' && (
          <Checkbox
            checked={f.linkCash}
            onChange={set('linkCash')}
            label={`Đồng thời ghi phiếu ${kind === 'ar' ? 'thu' : 'chi'} vào Sổ quỹ tiền mặt`}
          />
        )}
        <Field label="Ghi chú">
          <Input value={f.note} onChange={set('note')} placeholder="Số UNC, số phiếu…" />
        </Field>
        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
      </form>
    </Modal>
  );
}

/* --------------------------- Lịch sử thanh toán --------------------------- */
export function HistoryModal({ open, onClose, kind, debt }) {
  const cfg = KIND[kind];
  const { actor, role } = useAuth();
  const { cash, approvals = [] } = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const [items, setItems] = useState(null);

  useEffect(() => {
    if (!open || !debt) return undefined;
    setItems(null);
    const unsub = onSnapshot(
      query(collection(db, C.payments), where('parentId', '==', debt.id)),
      (snap) => setItems(snap.docs.map((d) => ({ id: d.id, ...d.data() }))),
      (ex) => {
        toast.error(friendlyError(ex));
        setItems([]);
      },
    );
    return unsub;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, debt?.id, toast]);

  if (!open || !debt) return null;
  const sorted = (items || []).slice().sort((a, b) => b.date.localeCompare(a.date) || tsMillis(b.createdAt) - tsMillis(a.createdAt));

  const removePayment = async (p) => {
    const linked = p.cashEntryId ? cash.find((c) => c.id === p.cashEntryId) : null;
    const ok = await confirm({
      title: 'Xóa lần thanh toán này?',
      message: (
        <>
          {cfg.payVerb} <b>{fmtVND(p.amount)}</b> ngày {fmtDate(p.date)}. Số {cfg.paidLabel.toLowerCase()} của công nợ sẽ giảm tương ứng.
          {linked && ' Phiếu sổ quỹ tiền mặt được tạo tự động kèm theo cũng sẽ bị xóa.'}
        </>
      ),
      confirmText: 'Xóa',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const b = new AuditedBatch(actor);
      const label = `Xóa lần ${cfg.payVerb.toLowerCase()} ${fmtVND(p.amount)} — ${debt.partnerName}`;
      b.remove(C.payments, p.id, p, label);
      b.update(cfg.coll, debt.id, { paid: increment(-p.amount) }, debt, label, { logAfter: { ...debt, paid: (debt.paid || 0) - p.amount } });
      const appr = p.approvalId ? approvals.find((a) => a.id === p.approvalId && a.status === 'DONE') : null;
      if (appr) b.update(C.approvals, appr.id, { status: 'OPEN', paidAmount: 0, paidOn: '', paymentId: '' }, pickApproval(appr), `${label} — lệnh duyệt chi trở lại chờ chuyển tiền`);
      if (linked) b.remove(C.cash, linked.id, linked, `${label} (phiếu sổ quỹ tự động)`);
      await b.commit();
      toast.success('Đã xóa lần thanh toán');
    } catch (ex) {
      toast.error(friendlyError(ex));
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={`Lịch sử thanh toán · ${debt.partnerName}`} subtitle={debt.description} size="lg">
      <div className="grid grid-cols-3 gap-2 text-center text-xs mb-4">
        <div className="rounded-lg bg-slate-50 px-2 py-2">
          <p className="text-slate-500">Tổng công nợ</p>
          <Money value={debt.total} className="font-semibold" />
        </div>
        <div className="rounded-lg bg-slate-50 px-2 py-2">
          <p className="text-slate-500">{cfg.paidLabel}</p>
          <Money value={debt.paid} className="font-semibold" />
        </div>
        <div className="rounded-lg bg-amber-50 px-2 py-2">
          <p className="text-amber-700">Còn lại</p>
          <Money value={remaining(debt)} className="font-semibold text-amber-800" />
        </div>
      </div>
      {items === null ? (
        <EmptyState title="Đang tải…" />
      ) : (
        <ul className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {(debt.openingPaid || 0) > 0 && (
            <li className="flex items-center justify-between gap-3 px-4 py-3 bg-slate-50/60">
              <span className="text-sm text-slate-600">{cfg.openingLabel}</span>
              <Money value={debt.openingPaid} className="text-sm font-semibold text-slate-700" />
            </li>
          )}
          {sorted.length === 0 && (debt.openingPaid || 0) === 0 && <li className="px-4 py-6 text-center text-sm text-slate-500">Chưa có lần thanh toán nào.</li>}
          {sorted.map((p) => (
            <li key={p.id} className="flex items-center gap-3 px-4 py-3">
              <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full', kind === 'ar' ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600')}>
                {kind === 'ar' ? <CircleArrowDown className="h-4 w-4" /> : <CircleArrowUp className="h-4 w-4" />}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-slate-800">
                  {fmtDate(p.date)} · {PAY_METHOD[p.method] || p.method}
                  {p.cashEntryId && (
                    <Badge tone="green" className="ml-2" icon={Wallet}>
                      Sổ quỹ
                    </Badge>
                  )}
                </p>
                <p className="text-xs text-slate-500 truncate">
                  {p.note ? `${p.note} · ` : ''}
                  <Who id={p.createdBy} />
                </p>
              </div>
              <Money value={p.amount} className={cx('text-sm font-semibold', kind === 'ar' ? 'text-emerald-600' : 'text-rose-600')} />
              {can(role, 'deletePayments') && <Button size="iconSm" variant="ghost" icon={Trash2} onClick={() => removePayment(p)} title="Xóa" />}
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}


/** Xóa một khoản công nợ cùng lịch sử thanh toán của nó */
/**
 * Xóa một khoản công nợ kèm toàn bộ lịch sử thanh toán.
 * Lô đầu: xóa công nợ + tối đa 4 lần thanh toán; các lô sau xóa nốt lịch sử (5 dòng / lô — giới hạn
 * số lần kiểm tra của Security Rules). Kế toán được xóa lịch sử thanh toán chỉ khi công nợ gốc đã bị xóa
 * cùng lúc hoặc trước đó, nên không thể xóa lẻ từng lần thanh toán.
 */
export async function deleteDebt(actor, kind, r) {
  const cfg = KIND[kind];
  const snap = await getDocs(query(collection(db, C.payments), where('parentId', '==', r.id)));
  const pays = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
  const note = (p) => `Xóa lịch sử thanh toán ${fmtVND(p.amount)} (kèm xóa công nợ ${r.partnerName})`;
  const first = new AuditedBatch(actor);
  first.remove(cfg.coll, r.id, raw(r), `Xóa công nợ ${cfg.name}: ${r.partnerName} — ${fmtVND(r.total)}`);
  pays.slice(0, 4).forEach((p) => first.remove(C.payments, p.id, p, note(p)));
  await first.commit();
  for (let i = 4; i < pays.length; i += 5) {
    const pb = new AuditedBatch(actor);
    pays.slice(i, i + 5).forEach((p) => pb.remove(C.payments, p.id, p, note(p)));
    await pb.commit();
  }
}
