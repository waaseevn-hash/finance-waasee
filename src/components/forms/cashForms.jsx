import { useEffect, useMemo, useState } from 'react';
import { ArrowRightLeft, Plus, RotateCcw, Trash2, UserRound } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { AuditedBatch, C, friendlyError } from '../../lib/db.js';
import { MAIN_HOLDER, holderBalances, holderOf } from '../../lib/calc.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { fmtVND } from '../../lib/format.js';
import { newHolderId, saveHolders, useCashHolders } from '../../lib/holders.js';
import { Money, MoneyInput } from '../Money.jsx';
import { useConfirm, useToast } from '../feedback.jsx';
import { Button, Field, Input, Modal, Segmented, Select, Textarea, cx } from '../ui.jsx';

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
      subtitle={entry.reversalOf ? 'Bút toán đảo (hủy chốt sổ)' : 'Ghi sổ tự động khi chốt sổ'}
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
        Bút toán này đã khóa vì sinh từ chứng từ đã chốt sổ. Muốn điều chỉnh, Chủ doanh nghiệp mở chứng từ và chọn “Hủy chốt sổ” — hệ thống ghi bút toán đảo, không xóa lịch sử.
      </p>
    </Modal>
  );
}

export function EntryModal(props) {
  if (props.open && props.initial?.voucherId) return <LockedEntry entry={props.initial} onClose={props.onClose} />;
  if (props.open && props.initial?.transferId) return <TransferModal open onClose={props.onClose} initial={props.initial} />;
  return <EditableEntryModal {...props} />;
}

/** Chọn người giữ tiền: nút bấm khi ít người, danh sách thả xuống khi nhiều */
export function HolderPicker({ value, onChange, holders, balances, extraId }) {
  const opts = holders.active.slice();
  if (extraId && !opts.some((h) => h.id === extraId)) opts.push({ id: extraId, name: holders.name(extraId) });
  if (opts.length <= 3) {
    return (
      <Segmented
        value={value}
        onChange={onChange}
        className="w-full [&>button]:flex-1 [&>button]:min-w-0"
        options={opts.map((h) => ({ value: h.id, label: <span className="block truncate">{h.name}</span> }))}
      />
    );
  }
  return (
    <Select value={value} onChange={(e) => onChange(e.target.value)}>
      {opts.map((h) => (
        <option key={h.id} value={h.id}>
          {h.name}
          {balances ? ` — ${fmtVND(balances[h.id] || 0)}` : ''}
        </option>
      ))}
    </Select>
  );
}

function EditableEntryModal({ open, onClose, initial, defaultType, defaultHolder }) {
  const { actor } = useAuth();
  const { cash } = useData();
  const holders = useCashHolders(open);
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState({});
  const balances = useMemo(() => holderBalances(cash), [cash]);

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
            holderId: holderOf(initial),
          }
        : { date: todayISO(), type: defaultType || 'IN', amount: 0, counterparty: '', description: '', note: '', holderId: defaultHolder || MAIN_HOLDER },
    );
  }, [open, initial, defaultType, defaultHolder]);

  if (!open || !f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const before = initial && holderOf(initial) === f.holderId ? (initial.type === 'IN' ? 1 : -1) * initial.amount : 0;
  const after = (f.type === 'IN' ? 1 : -1) * (Number(f.amount) || 0);
  const projected = (balances[f.holderId] || 0) - before + after;
  const multi = holders.active.length > 1 || f.holderId !== MAIN_HOLDER;
  const holderName = holders.name(f.holderId);

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
      holderId: f.holderId === MAIN_HOLDER ? '' : f.holderId,
    };
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      const label = `phiếu ${TYPE_LABEL[data.type].toLowerCase()} ${fmtVND(data.amount)} — ${data.description}${f.holderId !== MAIN_HOLDER ? ` (${holderName})` : ''}`;
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
        {multi && (
          <Field as="div" label={f.type === 'IN' ? 'Tiền nộp vào' : 'Chi từ tiền của'} className="sm:col-span-2">
            <HolderPicker value={f.holderId} onChange={set('holderId')} holders={holders} balances={balances} extraId={initial ? holderOf(initial) : ''} />
          </Field>
        )}
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
          <span>
            {projected < 0 ? 'Cảnh báo: tiền sẽ bị ÂM sau phiếu này' : 'Còn lại sau phiếu này'}
            {multi && <span className="text-slate-400"> · {holderName}</span>}
          </span>
          <Money value={projected} className="font-semibold" />
        </div>
      </form>
    </Modal>
  );
}

export function CountModal({ open, onClose, defaultHolder }) {
  const { actor } = useAuth();
  const { cash } = useData();
  const holders = useCashHolders(open);
  const toast = useToast();
  const [counted, setCounted] = useState(0);
  const [holderId, setHolderId] = useState(MAIN_HOLDER);
  const [busy, setBusy] = useState(false);
  const balances = useMemo(() => holderBalances(cash), [cash]);
  useEffect(() => {
    if (open) {
      setCounted(0);
      setHolderId(defaultHolder || MAIN_HOLDER);
    }
  }, [open, defaultHolder]);
  const balance = balances[holderId] || 0;
  const diff = counted - balance;
  const holderName = holders.name(holderId);
  const multi = holders.active.length > 1;

  const adjust = async () => {
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      const data = {
        date: todayISO(),
        type: diff > 0 ? 'IN' : 'OUT',
        amount: Math.abs(diff),
        counterparty: 'Kiểm kê quỹ',
        description: `Điều chỉnh chênh lệch kiểm kê quỹ (${diff > 0 ? 'thừa' : 'thiếu'})${multi ? ` — ${holderName}` : ''}`,
        note: `Sổ sách ${fmtVND(balance)} · Thực tế đếm ${fmtVND(counted)}`,
        holderId: holderId === MAIN_HOLDER ? '' : holderId,
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
      subtitle="Đếm tiền thực tế và đối chiếu với sổ quỹ"
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
        {multi && (
          <Field as="div" label="Kiểm kê tiền của">
            <HolderPicker value={holderId} onChange={setHolderId} holders={holders} balances={balances} />
          </Field>
        )}
        <div className="flex justify-between rounded-xl bg-slate-50 px-4 py-3 text-sm">
          <span className="text-slate-600">Tồn theo sổ{multi ? ` — ${holderName}` : ''}</span>
          <Money value={balance} className="font-semibold text-slate-900" />
        </div>
        <Field label="Số tiền đếm thực tế">
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

/* ============================ Bàn giao tiền giữa người giữ ============================ */
const newTransferId = () => `T${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;

export function TransferModal({ open, onClose, initial, defaultFrom }) {
  const { actor } = useAuth();
  const { cash } = useData();
  const holders = useCashHolders(open);
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const balances = useMemo(() => holderBalances(cash), [cash]);
  const legs = useMemo(() => (initial?.transferId ? cash.filter((e) => e.transferId === initial.transferId) : []), [cash, initial]);
  const outLeg = legs.find((e) => e.type === 'OUT');
  const inLeg = legs.find((e) => e.type === 'IN');

  useEffect(() => {
    if (!open) return;
    setErr('');
    if (initial?.transferId) {
      setF({ from: holderOf(outLeg), to: holderOf(inLeg), amount: outLeg?.amount || initial.amount, date: initial.date, note: initial.note || '' });
    } else {
      const from = defaultFrom || MAIN_HOLDER;
      const to = holders.active.find((h) => h.id !== from)?.id || '';
      setF({ from, to, amount: 0, date: todayISO(), note: '' });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initial?.transferId, defaultFrom]);
  // Danh sách người giữ tải xong sau khi mở: tự chọn người nhận
  useEffect(() => {
    if (open && f && !f.to) {
      const to = holders.active.find((h) => h.id !== f.from)?.id;
      if (to) setF((x) => ({ ...x, to }));
    }
  }, [open, f, holders]);
  if (!open || !f) return null;
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));
  const amount = Math.round(Number(f.amount) || 0);
  const editing = !!initial?.transferId;
  const back = (id) => (editing && outLeg && inLeg ? (holderOf(outLeg) === id ? outLeg.amount : 0) - (holderOf(inLeg) === id ? inLeg.amount : 0) : 0);
  const fromAfter = (balances[f.from] || 0) + back(f.from) - amount;
  const toAfter = (balances[f.to] || 0) + back(f.to) + amount;
  const fromName = holders.name(f.from);
  const toName = holders.name(f.to);

  const submit = async (e) => {
    e.preventDefault();
    if (!f.to || f.from === f.to) return setErr('Chọn người giao và người nhận khác nhau');
    if (amount <= 0) return setErr('Số tiền phải lớn hơn 0');
    if (!f.date) return setErr('Chọn ngày bàn giao');
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      const tid = initial?.transferId || newTransferId();
      const base = { date: f.date, amount, note: f.note.trim(), transferId: tid };
      const outData = { ...base, type: 'OUT', holderId: f.from === MAIN_HOLDER ? '' : f.from, transferPeer: f.to, counterparty: toName, description: `Bàn giao tiền cho ${toName}` };
      const inData = { ...base, type: 'IN', holderId: f.to === MAIN_HOLDER ? '' : f.to, transferPeer: f.from, counterparty: fromName, description: `Nhận bàn giao từ ${fromName}` };
      const label = `Bàn giao tiền mặt ${fmtVND(amount)}: ${fromName} → ${toName}`;
      if (editing && outLeg && inLeg) {
        b.update(C.cash, outLeg.id, outData, outLeg, `Sửa ${label}`);
        b.update(C.cash, inLeg.id, inData, inLeg, `Sửa ${label}`);
      } else {
        b.create(C.cash, outData, label);
        b.create(C.cash, inData, label);
      }
      await b.commit();
      toast.success(editing ? 'Đã cập nhật bàn giao' : `Đã ghi bàn giao ${fmtVND(amount)} cho ${toName}`);
      onClose();
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: 'Xóa lần bàn giao này?',
      message: `${fmtVND(amount)}: ${fromName} → ${toName}. Tiền của hai bên trở lại như trước khi bàn giao. Thao tác được ghi vào nhật ký.`,
      confirmText: 'Xóa bàn giao',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      for (const leg of legs) b.remove(C.cash, leg.id, leg, `Xóa bàn giao tiền mặt ${fmtVND(leg.amount)}: ${fromName} → ${toName}`);
      await b.commit();
      toast.success('Đã xóa bàn giao');
      onClose();
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };

  const tooFew = holders.active.length < 2 && !editing;
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={editing ? 'Sửa bàn giao tiền mặt' : 'Bàn giao tiền mặt'}
      subtitle="Chuyển tiền giữa két và người giữ — tổng tiền mặt không đổi"
      size="sm"
      footer={
        <>
          {editing && (
            <Button variant="dangerGhost" icon={Trash2} onClick={remove} disabled={busy} className="mr-auto">
              Xóa
            </Button>
          )}
          <Button onClick={onClose}>Hủy</Button>
          {!tooFew && (
            <Button type="submit" form="transfer-form" variant="primary" icon={ArrowRightLeft} loading={busy}>
              {editing ? 'Lưu thay đổi' : 'Ghi bàn giao'}
            </Button>
          )}
        </>
      }
    >
      {tooFew ? (
        <p className="rounded-xl bg-amber-50 px-4 py-3 text-sm text-amber-900">Chưa có người giữ tiền nào ngoài két. Bấm “Thêm người giữ tiền” trước, rồi quay lại bàn giao.</p>
      ) : (
        <form id="transfer-form" onSubmit={submit} className="space-y-4">
          <Field as="div" label="Người giao tiền">
            <HolderPicker value={f.from} onChange={set('from')} holders={holders} balances={balances} extraId={editing ? f.from : ''} />
          </Field>
          <Field as="div" label="Người nhận tiền">
            <HolderPicker value={f.to} onChange={set('to')} holders={holders} balances={balances} extraId={editing ? f.to : ''} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Số tiền">
              <MoneyInput value={f.amount} onChange={set('amount')} autoFocus />
            </Field>
            <Field label="Ngày">
              <Input type="date" value={f.date} onChange={set('date')} />
            </Field>
          </div>
          <Field label="Ghi chú">
            <Input value={f.note} onChange={set('note')} placeholder="VD: Nhận tiền để chi lương thời vụ" />
          </Field>
          {f.from !== f.to && f.to && (
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-slate-200 text-sm">
              <div className={cx('px-3 py-2', fromAfter < 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-600')}>
                <span className="block truncate text-xs">{fromName} còn</span>
                <Money value={fromAfter} className="font-semibold" />
              </div>
              <div className="bg-slate-50 px-3 py-2 text-slate-600">
                <span className="block truncate text-xs">{toName} có</span>
                <Money value={toAfter} className="font-semibold" />
              </div>
            </div>
          )}
          {err && <p className="text-sm text-rose-600">{err}</p>}
        </form>
      )}
    </Modal>
  );
}

/* ============================ Danh sách người giữ tiền ============================ */
export function HoldersModal({ open, onClose }) {
  const { actor } = useAuth();
  const { cash } = useData();
  const holders = useCashHolders(open);
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const balances = useMemo(() => holderBalances(cash), [cash]);
  const used = useMemo(() => new Set(cash.map(holderOf)), [cash]);

  useEffect(() => {
    if (open) {
      setErr('');
      setRows(holders.all.map((h) => ({ ...h })));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, holders.loaded]);
  if (!open) return null;

  const update = (id, patch) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const removeRow = (r) => {
    if (used.has(r.id)) update(r.id, { active: false });
    else setRows((rs) => rs.filter((x) => x.id !== r.id));
  };
  const add = () => setRows((rs) => [...rs, { id: newHolderId(), name: '', active: true, fresh: true }]);

  const save = async () => {
    const live = rows.filter((r) => r.active);
    if (live.some((r) => !String(r.name).trim())) return setErr('Nhập tên cho từng người giữ tiền');
    const names = live.map((r) => r.name.trim().toLowerCase());
    if (new Set(names).size !== names.length) return setErr('Hai người giữ đang trùng tên');
    setBusy(true);
    try {
      await saveHolders(actor, rows, holders.raw, `Cập nhật người giữ tiền mặt: ${live.map((r) => r.name.trim()).join(', ')}`);
      toast.success('Đã lưu danh sách người giữ tiền');
      onClose();
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };

  const hidden = rows.filter((r) => !r.active);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Người giữ tiền mặt của công ty"
      subtitle="Két công ty và những người đang cầm tiền mặt của công ty"
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button variant="primary" loading={busy} onClick={save}>
            Lưu danh sách
          </Button>
        </>
      }
    >
      <ul className="space-y-2">
        {rows
          .filter((r) => r.active)
          .map((r) => {
            const bal = balances[r.id] || 0;
            const locked = r.id === MAIN_HOLDER || bal !== 0;
            return (
              <li key={r.id} className="flex items-center gap-2">
                <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-jade-50 text-jade-700">
                  <UserRound className="h-4 w-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <Input value={r.name} onChange={(e) => update(r.id, { name: e.target.value })} placeholder="Tên người giữ, VD: Anh Huy" autoFocus={!!r.fresh} />
                  {!r.fresh && (
                    <span className="mt-0.5 block text-[11px] text-slate-500">
                      Đang giữ <Money value={bal} className="font-medium text-slate-700" />
                    </span>
                  )}
                </div>
                <Button
                  size="iconSm"
                  variant="ghost"
                  icon={Trash2}
                  disabled={locked}
                  onClick={() => removeRow(r)}
                  title={r.id === MAIN_HOLDER ? 'Két công ty luôn có' : bal !== 0 ? 'Bàn giao hết tiền về két trước khi bỏ người này' : 'Bỏ người giữ này'}
                />
              </li>
            );
          })}
      </ul>
      <Button icon={Plus} className="mt-3 w-full" onClick={add}>
        Thêm người giữ tiền
      </Button>
      {hidden.length > 0 && (
        <div className="mt-4 rounded-xl bg-slate-50 px-3 py-2 text-xs text-slate-600">
          <p className="mb-1 font-medium">Đã ngừng giữ tiền (phiếu cũ vẫn giữ tên):</p>
          {hidden.map((r) => (
            <span key={r.id} className="mr-2 inline-flex items-center gap-1">
              {r.name}
              <button type="button" className="inline-flex items-center gap-0.5 font-semibold text-sapphire-700 hover:underline" onClick={() => update(r.id, { active: true })}>
                <RotateCcw className="h-3 w-3" /> dùng lại
              </button>
            </span>
          ))}
        </div>
      )}
      {err && <p className="mt-3 text-sm text-rose-600">{err}</p>}
    </Modal>
  );
}

export async function deleteCashEntry(actor, e) {
  const b = new AuditedBatch(actor);
  b.remove(C.cash, e.id, e, `Xóa phiếu ${TYPE_LABEL[e.type].toLowerCase()} ${fmtVND(e.amount)} — ${e.description}`);
  await b.commit();
}
