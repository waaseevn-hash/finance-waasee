import { useEffect, useMemo, useState } from 'react';
import { Building2, CircleCheck, Landmark, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { AuditedBatch, C, friendlyError } from '../../lib/db.js';
import { bankSummary, loanInterestForMonth, loanLabel } from '../../lib/calc.js';
import { currentMonth, daysBetween, describeDays, fmtDate, todayISO } from '../../lib/dates.js';
import { fmtPct, fmtVND } from '../../lib/format.js';
import { Money, MoneyInput } from '../Money.jsx';
import { useConfirm, useToast } from '../feedback.jsx';
import {
  Badge,
  Button,
  Card,
  EmptyState,
  Field,
  Input,
  Modal,
  PageHeader,
  ProgressBar,
  Segmented,
  Select,
  TableWrap,
  Textarea,
  cx,
  td,
  th,
} from '../ui.jsx';

export const pickRaw = (row, keys) => Object.fromEntries(keys.map((k) => [k, row[k]]));
export const BANK_KEYS = ['id', 'name', 'creditLimit', 'depositBalance', 'note', '_auditId'];
export const LOAN_KEYS = ['id', 'bankId', 'contractNo', 'amount', 'disbursedDate', 'interestRate', 'maturityDate', 'status', 'settledDate', 'purpose', 'note', '_auditId'];

export function daysTone(d) {
  if (d == null) return 'slate';
  if (d < 0 || d <= 15) return 'red';
  if (d <= 30) return 'amber';
  return 'green';
}

/* --------------------------- Ngân hàng --------------------------- */
export function BankModal({ open, onClose, initial }) {
  const { actor } = useAuth();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr({});
    setF({
      name: initial?.name || '',
      creditLimit: initial?.creditLimit || 0,
      depositBalance: initial?.depositBalance || 0,
      note: initial?.note || '',
    });
  }, [open, initial]);
  if (!open || !f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const submit = async (e) => {
    e.preventDefault();
    if (!f.name.trim()) {
      setErr({ name: 'Nhập tên ngân hàng' });
      return;
    }
    const data = {
      name: f.name.trim(),
      creditLimit: Math.round(Number(f.creditLimit) || 0),
      depositBalance: Math.round(Number(f.depositBalance) || 0),
      note: f.note.trim(),
    };
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      if (initial) b.update(C.banks, initial.id, data, initial, `Cập nhật ngân hàng ${data.name}`);
      else b.create(C.banks, data, `Thêm ngân hàng ${data.name} — hạn mức ${fmtVND(data.creditLimit)}`);
      await b.commit();
      toast.success('Đã lưu thông tin ngân hàng');
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
      title={initial ? 'Sửa thông tin ngân hàng' : 'Thêm ngân hàng / hạn mức tín dụng'}
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="submit" form="bank-form" variant="blue" loading={busy}>
            Lưu
          </Button>
        </>
      }
    >
      <form id="bank-form" onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Tên ngân hàng / chi nhánh" required error={err.name} className="sm:col-span-2">
          <Input value={f.name} onChange={set('name')} placeholder="VD: Vietcombank – CN Bình Dương" autoFocus />
        </Field>
        <Field label="Tổng hạn mức được cấp" hint="Dư nợ và số còn được vay tự tính từ các khoản vay">
          <MoneyInput value={f.creditLimit} onChange={set('creditLimit')} />
        </Field>
        <Field label="Số dư tiền gửi thanh toán (nếu có)" hint="Dùng để tính thanh khoản khả dụng">
          <MoneyInput value={f.depositBalance} onChange={set('depositBalance')} />
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          <Textarea value={f.note} onChange={set('note')} placeholder="Tài sản bảo đảm, cán bộ tín dụng phụ trách…" />
        </Field>
      </form>
    </Modal>
  );
}

/* ---------------------------- Khoản vay ---------------------------- */
export function LoanModal({ open, onClose, initial, banks, bankRows, defaultBankId }) {
  const { actor } = useAuth();
  const toast = useToast();
  const [f, setF] = useState(null);
  const [err, setErr] = useState({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setErr({});
    setF({
      bankId: initial?.bankId || defaultBankId || banks[0]?.id || '',
      contractNo: initial?.contractNo || '',
      amount: initial?.amount || 0,
      disbursedDate: initial?.disbursedDate || todayISO(),
      interestRate: initial?.interestRate ?? '',
      maturityDate: initial?.maturityDate || '',
      status: initial?.status || 'ACTIVE',
      settledDate: initial?.settledDate || '',
      purpose: initial?.purpose || '',
      note: initial?.note || '',
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial, defaultBankId]);
  if (!open || !f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const bankRow = bankRows.find((b) => b.id === f.bankId);
  const availableForThis = (bankRow?.available || 0) + (initial && initial.status === 'ACTIVE' && initial.bankId === f.bankId ? initial.amount : 0);

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!f.bankId) er.bankId = 'Chọn ngân hàng';
    if (!(Number(f.amount) > 0)) er.amount = 'Số tiền phải lớn hơn 0';
    if (!f.disbursedDate) er.disbursedDate = 'Chọn ngày giải ngân';
    if (!f.maturityDate) er.maturityDate = 'Chọn ngày đáo hạn';
    else if (f.disbursedDate && f.maturityDate <= f.disbursedDate) er.maturityDate = 'Ngày đáo hạn phải sau ngày giải ngân';
    const rate = Number(String(f.interestRate).replace(',', '.'));
    if (!(rate >= 0) || rate > 100 || f.interestRate === '') er.interestRate = 'Lãi suất %/năm (VD: 6,8)';
    setErr(er);
    if (Object.keys(er).length) return;
    const data = {
      bankId: f.bankId,
      contractNo: String(f.contractNo || '').trim(), // không còn nhập; giữ nguyên số cũ nếu có
      amount: Math.round(Number(f.amount)),
      disbursedDate: f.disbursedDate,
      interestRate: rate,
      maturityDate: f.maturityDate,
      status: f.status,
      settledDate: f.status === 'SETTLED' ? f.settledDate || todayISO() : '',
      purpose: f.purpose.trim(),
      note: f.note.trim(),
    };
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      const bankName = banks.find((x) => x.id === data.bankId)?.name || '';
      if (initial) b.update(C.loans, initial.id, data, initial, `Sửa ${loanLabel(data)} (${bankName})`);
      else b.create(C.loans, data, `Giải ngân ${loanLabel(data, { lower: true })} — ${bankName} — ${fmtVND(data.amount)}`);
      await b.commit();
      toast.success('Đã lưu khoản vay');
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
      title={initial ? 'Sửa khoản vay' : 'Thêm khoản vay / giải ngân'}
      size="lg"
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="submit" form="loan-form" variant="blue" loading={busy}>
            Lưu khoản vay
          </Button>
        </>
      }
    >
      <form id="loan-form" onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Ngân hàng" required error={err.bankId}>
          <Select value={f.bankId} onChange={set('bankId')}>
            {banks.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </Select>
        </Field>
        <Field
          label="Số tiền vay"
          required
          error={err.amount}
          hint={
            <span>
              Hạn mức còn trống của ngân hàng: <Money value={availableForThis} className="font-medium" />
            </span>
          }
        >
          <MoneyInput value={f.amount} onChange={set('amount')} />
        </Field>
        <Field label="Lãi suất (%/năm)" required error={err.interestRate}>
          <Input value={f.interestRate} onChange={set('interestRate')} inputMode="decimal" placeholder="VD: 6,8" />
        </Field>
        <Field label="Ngày giải ngân" required error={err.disbursedDate}>
          <Input type="date" value={f.disbursedDate} onChange={set('disbursedDate')} />
        </Field>
        <Field label="Ngày đáo hạn" required error={err.maturityDate}>
          <Input type="date" value={f.maturityDate} onChange={set('maturityDate')} />
        </Field>
        <Field label="Trạng thái">
          <Select value={f.status} onChange={set('status')}>
            <option value="ACTIVE">Đang vay</option>
            <option value="SETTLED">Đã tất toán</option>
          </Select>
        </Field>
        {f.status === 'SETTLED' && (
          <Field label="Ngày tất toán">
            <Input type="date" value={f.settledDate} onChange={set('settledDate')} />
          </Field>
        )}
        <Field label="Mục đích vay" className="sm:col-span-2">
          <Input value={f.purpose} onChange={set('purpose')} placeholder="VD: Thanh toán tiền nguyên vật liệu" />
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          <Textarea value={f.note} onChange={set('note')} />
        </Field>
        {Number(f.amount) > availableForThis && f.status === 'ACTIVE' && (
          <p className="sm:col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Lưu ý: số tiền vay vượt hạn mức còn trống của ngân hàng này.
          </p>
        )}
      </form>
    </Modal>
  );
}

export function SettleModal({ open, onClose, loan, bankName }) {
  const { actor } = useAuth();
  const toast = useToast();
  const [date, setDate] = useState(todayISO());
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setDate(todayISO());
  }, [open]);
  if (!open || !loan) return null;
  const go = async () => {
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      b.update(C.loans, loan.id, { status: 'SETTLED', settledDate: date }, loan, `Tất toán ${loanLabel(loan, { lower: true })} (${bankName}) — ${fmtVND(loan.amount)}`);
      await b.commit();
      toast.success(`Đã tất toán ${loanLabel(loan, { lower: true })}`);
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
      title="Tất toán khoản vay"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="success" icon={CircleCheck} loading={busy} onClick={go}>
            Xác nhận tất toán
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-sm">
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <p className="font-semibold text-slate-900">
            {loanLabel(loan)} · {bankName}
          </p>
          <p className="mt-1 text-slate-600">
            Số tiền: <Money value={loan.amount} className="font-semibold" /> · Đáo hạn {fmtDate(loan.maturityDate)}
          </p>
        </div>
        <Field label="Ngày tất toán">
          <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </Field>
        <p className="text-xs text-slate-500">Sau khi tất toán, hạn mức tương ứng được giải phóng và có thể rút lại.</p>
      </div>
    </Modal>
  );
}


export async function deleteLoan(actor, l, bankName) {
  const b = new AuditedBatch(actor);
  b.remove(C.loans, l.id, pickRaw(l, LOAN_KEYS), `Xóa ${loanLabel(l, { lower: true })} (${bankName}) — ${fmtVND(l.amount)}`);
  await b.commit();
}
