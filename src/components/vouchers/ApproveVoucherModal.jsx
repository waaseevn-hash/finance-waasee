import { useEffect, useMemo, useState } from 'react';
import { CircleCheck } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { friendlyError } from '../../lib/db.js';
import { cashBalance } from '../../lib/calc.js';
import { fmtDate } from '../../lib/dates.js';
import { fmtVND } from '../../lib/format.js';
import { can } from '../../lib/roles.js';
import { PARTIAL_TYPES, VTYPE, flowEffect, isBank, requestedAmount, settlement } from '../../lib/vouchers.js';
import { approveVouchers } from '../../lib/voucherService.js';
import { Money, MoneyInput } from '../Money.jsx';
import { useToast } from '../feedback.jsx';
import { Button, Field, Input, Modal, Segmented, cx } from '../ui.jsx';
import { VTypeChip } from './common.jsx';

const roundK = (n) => Math.max(1000, Math.round(n / 1000) * 1000);

/** Duyệt chứng từ: toàn bộ số đề nghị hoặc một phần */
export function ApproveVoucherModal({ voucher: v, onClose, onDone, startMode = 'FULL' }) {
  const { actor, role } = useAuth();
  const data = useData();
  const toast = useToast();
  const [mode, setMode] = useState('FULL');
  const [amount, setAmount] = useState(0);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const req = v ? requestedAmount(v) : 0;
  const canPartial = v && PARTIAL_TYPES.includes(v.type);

  useEffect(() => {
    if (!v) return;
    setMode(startMode === 'PART' && PARTIAL_TYPES.includes(v.type) ? 'PART' : 'FULL');
    setAmount(roundK(req / 2));
    setNote('');
    setErr('');
  }, [v?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const treasury = can(role, 'viewTreasury');
  // Tiền (mặt + gửi ngân hàng) còn lại sau khi kết chuyển các khoản đã duyệt khác và khoản này
  const base = useMemo(() => {
    if (!treasury) return null;
    let b = cashBalance(data.cash) + (data.banks || []).reduce((t, x) => t + (Number(x.depositBalance) || 0), 0);
    for (const x of data.vouchers || []) {
      if (x.auto || x.status !== 'APPROVED' || x.id === v?.id) continue;
      const e = flowEffect(x);
      b += e.in - e.out;
    }
    return b;
  }, [treasury, data.cash, data.banks, data.vouchers, v?.id]);

  if (!v) return null;
  const approved = mode === 'FULL' ? req : Math.round(Number(amount) || 0);
  const preview = { ...v, status: 'APPROVED', approvedAmount: mode === 'FULL' ? 0 : approved };
  const eff = flowEffect(preview);
  const st = v.type === 'TT' ? settlement(preview) : null;
  const after = base === null ? null : base + eff.in - eff.out;

  const submit = async (e) => {
    e?.preventDefault();
    if (mode === 'PART' && (approved <= 0 || approved >= req)) return setErr(`Số duyệt một phần phải lớn hơn 0 và nhỏ hơn số đề nghị ${fmtVND(req)}. Muốn duyệt đủ thì chọn “Duyệt toàn bộ”.`);
    setBusy(true);
    try {
      const partial = mode === 'PART' ? { [v.id]: { amount: approved, note } } : note.trim() ? { [v.id]: { amount: req, note } } : {};
      const nums = await approveVouchers({ actor, ids: [v.id], partial, list: [v] });
      toast.success(`Đã duyệt ${mode === 'PART' ? `một phần ${fmtVND(approved)}` : fmtVND(req)} — số ${nums[v.id]}`);
      onDone?.(nums[v.id]);
      onClose();
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={`Duyệt ${VTYPE[v.type].short.toLowerCase()}`}
      subtitle={`${v.person} · ${fmtDate(v.date)}`}
      size="sm"
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button type="submit" form="approve-voucher-form" variant="primary" icon={CircleCheck} loading={busy}>
            Duyệt <Money value={approved} />
          </Button>
        </>
      }
    >
      <form id="approve-voucher-form" onSubmit={submit} className="space-y-4">
        <div className="rounded-xl bg-slate-50 px-4 py-3">
          <div className="flex items-center gap-2">
            <VTypeChip type={v.type} />
            {isBank(v) && <span className="rounded bg-sapphire-50 px-1.5 py-px text-[10px] font-semibold text-sapphire-700 ring-1 ring-inset ring-sapphire-200">Chuyển khoản</span>}
            <span className="min-w-0 flex-1 truncate text-sm text-slate-600">{v.reason}</span>
          </div>
          <div className="mt-2 flex items-baseline justify-between gap-3">
            <span className="text-sm text-slate-600">{v.type === 'PT' ? 'Số tiền thu' : 'Số tiền đề nghị'}</span>
            <Money value={req} className="font-display text-xl font-bold text-ink-900" />
          </div>
          {v.type === 'TT' && v.advanceAmount > 0 && (
            <p className="mt-0.5 text-right text-xs text-slate-500">
              đã tạm ứng <Money value={v.advanceAmount} />
              {v.advanceNo ? ` theo ${v.advanceNo}` : ''}
            </p>
          )}
        </div>

        {canPartial && (
          <Segmented
            value={mode}
            onChange={(m) => {
              setMode(m);
              setErr('');
            }}
            className="w-full [&>button]:flex-1"
            options={[
              { value: 'FULL', label: 'Duyệt toàn bộ' },
              { value: 'PART', label: 'Duyệt một phần' },
            ]}
          />
        )}

        {mode === 'PART' && (
          <div className="space-y-2">
            <Field label="Số tiền được duyệt">
              <MoneyInput value={amount} onChange={(x) => { setAmount(x); setErr(''); }} autoFocus />
            </Field>
            <div className="flex flex-wrap gap-1.5">
              {[25, 50, 75].map((p) => (
                <button
                  key={p}
                  type="button"
                  onClick={() => setAmount(roundK((req * p) / 100))}
                  className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold text-slate-700 hover:bg-slate-200"
                >
                  {p}%
                </button>
              ))}
              {approved > 0 && approved < req && (
                <span className="ml-auto self-center text-xs text-slate-500">
                  Không duyệt <Money value={req - approved} className="font-semibold text-slate-700" />
                </span>
              )}
            </div>
          </div>
        )}

        {st && st.B > 0 && (
          <div className={cx('rounded-xl px-4 py-2.5 text-sm', st.refund > 0 ? 'bg-jade-50 text-jade-800' : st.extra > 0 ? 'bg-vermilion-50 text-vermilion-800' : 'bg-slate-50 text-slate-600')}>
            {st.refund > 0 ? (
              <>
                Người đề nghị nộp lại quỹ <Money value={st.refund} className="font-semibold" /> (tạm ứng chi không hết)
              </>
            ) : st.extra > 0 ? (
              <>
                Chi bổ sung <Money value={st.extra} className="font-semibold" /> (chi quá tạm ứng)
              </>
            ) : (
              'Khớp số đã tạm ứng — không phát sinh thu / chi tiền mặt'
            )}
          </div>
        )}

        <Field label={mode === 'PART' ? 'Lý do duyệt một phần' : 'Ghi chú duyệt (không bắt buộc)'}>
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={mode === 'PART' ? 'VD: Chỉ duyệt phần có hóa đơn' : ''} />
        </Field>

        {after !== null && (eff.out > 0 || eff.in > 0) && (
          <div className={cx('flex items-center justify-between rounded-xl px-4 py-2.5 text-sm', after < 0 ? 'bg-rose-50 text-rose-700' : 'bg-slate-50 text-slate-600')}>
            <span>{after < 0 ? 'Thiếu tiền (mặt + gửi) sau khi chốt sổ' : 'Tiền (mặt + gửi) còn sau khi chốt sổ'}</span>
            <Money value={Math.abs(after)} className="font-semibold" />
          </div>
        )}
        {err && <p className="text-sm text-rose-600">{err}</p>}
      </form>
    </Modal>
  );
}
