import { useEffect, useMemo, useState } from 'react';
import {
  CircleArrowDown,
  CircleArrowUp,
  ClipboardCheck,
  FileSpreadsheet,
  Pencil,
  Plus,
  Search,
  Trash2,
  Vault,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { AuditedBatch, C, friendlyError } from '../../lib/db.js';
import { cashLedger, cashMonthStats } from '../../lib/calc.js';
import { currentMonth, fmtDate, monthLabel, monthRange, todayISO } from '../../lib/dates.js';
import { fmtVND, matchSearch } from '../../lib/format.js';
import { downloadXlsx } from '../../lib/xlsx.js';
import { resolveNames } from '../../lib/runtime.js';
import { Who } from '../Who.jsx';
import { Money, MoneyInput } from '../Money.jsx';
import { useConfirm, useToast } from '../feedback.jsx';
import {
  Button,
  Card,
  Checkbox,
  EmptyState,
  Field,
  Input,
  Modal,
  MonthPicker,
  PageHeader,
  Segmented,
  TableWrap,
  Textarea,
  cx,
  td,
  th,
} from '../ui.jsx';

export const TYPE_LABEL = { IN: 'Thu', OUT: 'Chi' };

/** Mở một chứng từ nội bộ ở màn hình Chứng từ thu chi */
export function openVoucher(id) {
  sessionStorage.setItem('openVoucher', id);
  window.dispatchEvent(new CustomEvent('open-voucher', { detail: id }));
  window.location.hash = 'vouchers-all';
}

/** Bút toán sinh từ chứng từ nội bộ: chỉ xem, không sửa / xóa (sửa bằng Hủy kết chuyển) */
function LockedEntry({ entry, onClose }) {
  return (
    <Modal
      open
      onClose={onClose}
      title={`Bút toán từ chứng từ ${entry.voucherNo || ''}`}
      subtitle={entry.reversalOf ? 'Bút toán đảo (hủy kết chuyển)' : 'Ghi sổ tự động khi kết chuyển'}
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          <Button
            variant="primary"
            onClick={() => {
              onClose();
              openVoucher(entry.sourceVoucherId || entry.voucherId);
            }}
          >
            Mở chứng từ
          </Button>
        </>
      }
    >
      <dl className="space-y-2 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">Ngày</dt>
          <dd>{fmtDate(entry.date)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-slate-500">{entry.type === 'IN' ? 'Thu' : 'Chi'}</dt>
          <dd>
            <Money value={entry.amount} className="font-semibold" />
          </dd>
        </div>
        <div>
          <dt className="text-slate-500">Nội dung</dt>
          <dd className="text-slate-800">{entry.description}</dd>
        </div>
      </dl>
      <p className="mt-4 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">
        Bút toán này đã khóa vì sinh từ chứng từ đã kết chuyển. Muốn điều chỉnh, Chủ doanh nghiệp mở chứng từ và chọn “Hủy kết chuyển” — hệ thống ghi bút toán đảo, không xóa lịch sử.
      </p>
    </Modal>
  );
}

export function EntryModal(props) {
  if (props.open && props.initial?.voucherId) return <LockedEntry entry={props.initial} onClose={props.onClose} />;
  return <EditableEntryModal {...props} />;
}

function EditableEntryModal({ open, onClose, initial, defaultType, balance }) {
  const { actor } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState({});

  useEffect(() => {
    if (!open) return;
    setErr({});
    setF(
      initial
        ? {
            date: initial.date,
            type: initial.type,
            amount: initial.amount,
            counterparty: initial.counterparty || '',
            description: initial.description || '',
            note: initial.note || '',
          }
        : { date: todayISO(), type: defaultType || 'IN', amount: 0, counterparty: '', description: '', note: '' },
    );
  }, [open, initial, defaultType]);

  if (!open || !f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const before = initial ? (initial.type === 'IN' ? 1 : -1) * initial.amount : 0;
  const after = (f.type === 'IN' ? 1 : -1) * (Number(f.amount) || 0);
  const projected = balance - before + after;

  const submit = async (e) => {
    e.preventDefault();
    const er = {};
    if (!f.date) er.date = 'Chọn ngày';
    if (!(Number(f.amount) > 0)) er.amount = 'Số tiền phải lớn hơn 0';
    if (!f.description.trim()) er.description = 'Nhập nội dung';
    setErr(er);
    if (Object.keys(er).length) return;
    const data = {
      date: f.date,
      type: f.type,
      amount: Math.round(Number(f.amount)),
      counterparty: f.counterparty.trim(),
      description: f.description.trim(),
      note: f.note.trim(),
    };
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      const label = `phiếu ${TYPE_LABEL[data.type].toLowerCase()} ${fmtVND(data.amount)} — ${data.description}`;
      if (initial) b.update(C.cash, initial.id, data, initial, `Sửa ${label}`);
      else b.create(C.cash, data, `Thêm ${label}`);
      await b.commit();
      toast.success(initial ? 'Đã cập nhật phiếu' : `Đã ghi phiếu ${TYPE_LABEL[data.type].toLowerCase()}`);
      onClose();
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Xóa phiếu này?',
      message: `Phiếu ${TYPE_LABEL[initial.type].toLowerCase()} ${fmtVND(initial.amount)} — "${initial.description}". Thao tác được ghi lại trong Nhật ký hệ thống.`,
      confirmText: 'Xóa phiếu',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      b.remove(C.cash, initial.id, initial, `Xóa phiếu ${TYPE_LABEL[initial.type].toLowerCase()} ${fmtVND(initial.amount)} — ${initial.description}`);
      await b.commit();
      toast.success('Đã xóa phiếu');
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
      title={initial ? 'Sửa phiếu thu/chi' : f.type === 'IN' ? 'Phiếu thu tiền mặt' : 'Phiếu chi tiền mặt'}
      footer={
        <>
          {initial && (
            <Button variant="dangerGhost" icon={Trash2} onClick={remove} disabled={busy} className="mr-auto">
              Xóa
            </Button>
          )}
          <Button onClick={onClose}>Hủy</Button>
          <Button type="submit" form="cash-form" variant={f.type === 'IN' ? 'success' : 'danger'} loading={busy}>
            {initial ? 'Lưu thay đổi' : `Ghi phiếu ${TYPE_LABEL[f.type].toLowerCase()}`}
          </Button>
        </>
      }
    >
      <form id="cash-form" onSubmit={submit} className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field as="div" label="Loại phiếu" className="sm:col-span-2">
          <Segmented
            value={f.type}
            onChange={set('type')}
            className="w-full [&>button]:flex-1"
            options={[
              { value: 'IN', label: 'Thu tiền (+)', activeClass: 'text-emerald-700' },
              { value: 'OUT', label: 'Chi tiền (−)', activeClass: 'text-rose-700' },
            ]}
          />
        </Field>
        <Field label="Ngày" required error={err.date}>
          <Input type="date" value={f.date} onChange={set('date')} />
        </Field>
        <Field label="Số tiền" required error={err.amount}>
          <MoneyInput value={f.amount} onChange={set('amount')} autoFocus />
        </Field>
        <Field label="Đối tượng (người nộp / người nhận)" className="sm:col-span-2">
          <Input value={f.counterparty} onChange={set('counterparty')} placeholder="VD: Anh Minh – Thủ kho" />
        </Field>
        <Field label="Nội dung" required error={err.description} className="sm:col-span-2">
          <Input value={f.description} onChange={set('description')} placeholder="VD: Thu tiền hàng HĐ 0125 / Chi tạm ứng mua vật tư" />
        </Field>
        <Field label="Ghi chú" className="sm:col-span-2">
          <Textarea value={f.note} onChange={set('note')} />
        </Field>
        <div className={cx('sm:col-span-2 rounded-xl px-4 py-3 text-sm flex justify-between', projected < 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-600')}>
          <span>{projected < 0 ? 'Cảnh báo: tồn quỹ sẽ bị ÂM sau phiếu này' : 'Tồn quỹ sau phiếu này'}</span>
          <Money value={projected} className="font-semibold" />
        </div>
      </form>
    </Modal>
  );
}

export function CountModal({ open, onClose, balance }) {
  const { actor } = useAuth();
  const toast = useToast();
  const [counted, setCounted] = useState(0);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setCounted(0);
  }, [open]);
  const diff = counted - balance;

  const adjust = async () => {
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      const data = {
        date: todayISO(),
        type: diff > 0 ? 'IN' : 'OUT',
        amount: Math.abs(diff),
        counterparty: 'Kiểm kê quỹ',
        description: `Điều chỉnh chênh lệch kiểm kê quỹ (${diff > 0 ? 'thừa' : 'thiếu'})`,
        note: `Sổ sách ${fmtVND(balance)} · Thực tế đếm ${fmtVND(counted)}`,
      };
      b.create(C.cash, data, `Kiểm kê quỹ: ${data.description} ${fmtVND(data.amount)}`);
      await b.commit();
      toast.success('Đã ghi bút toán điều chỉnh kiểm kê');
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
      title="Kiểm kê quỹ tiền mặt"
      subtitle="Đếm tiền thực tế trong két và đối chiếu với sổ quỹ"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Đóng</Button>
          {counted > 0 && diff !== 0 && (
            <Button variant="primary" loading={busy} onClick={adjust}>
              Ghi điều chỉnh chênh lệch
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        <div className="flex justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
          <span className="text-slate-600">Tồn quỹ theo sổ</span>
          <Money value={balance} className="font-semibold text-slate-900" />
        </div>
        <Field label="Số tiền đếm thực tế trong két">
          <MoneyInput value={counted} onChange={setCounted} autoFocus />
        </Field>
        {counted > 0 && (
          <div
            className={cx(
              'rounded-xl px-4 py-3 text-sm flex justify-between',
              diff === 0 ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800',
            )}
          >
            <span>{diff === 0 ? 'Khớp sổ quỹ ✓' : diff > 0 ? 'Tiền thực tế THỪA so với sổ' : 'Tiền thực tế THIẾU so với sổ'}</span>
            <Money value={Math.abs(diff)} className="font-semibold" />
          </div>
        )}
      </div>
    </Modal>
  );
}


export async function deleteCashEntry(actor, e) {
  const b = new AuditedBatch(actor);
  b.remove(C.cash, e.id, e, `Xóa phiếu ${TYPE_LABEL[e.type].toLowerCase()} ${fmtVND(e.amount)} — ${e.description}`);
  await b.commit();
}
