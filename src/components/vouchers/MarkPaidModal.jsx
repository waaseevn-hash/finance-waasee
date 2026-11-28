/**
 * Kế toán báo "Đã chi tiền" cho khoản Sếp đã duyệt (chưa chốt sổ).
 * Chỉ ghi dấu đã chi + hình thức chi (tiền mặt / chuyển khoản) và thông tin người thụ hưởng —
 * việc ghi sổ quỹ / tiền gửi làm ở bước "Chốt sổ & in phiếu".
 */
import { useState } from 'react';
import { Banknote, Landmark, Wallet } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { friendlyError } from '../../lib/db.js';
import { todayISO } from '../../lib/dates.js';
import { fmtVND } from '../../lib/format.js';
import { VTYPE, isBank, transferContent, voucherAmount } from '../../lib/vouchers.js';
import { markVoucherPaid } from '../../lib/voucherService.js';
import { useToast } from '../feedback.jsx';
import { Button, Field, Input, Modal, Segmented } from '../ui.jsx';

export function MarkPaidModal({ v, onClose, onDone }) {
  const { actor } = useAuth();
  const toast = useToast();
  const [f, setF] = useState(() => ({
    paidAt: v.paidAt || todayISO(),
    payMethod: isBank(v) ? 'BANK' : 'CASH',
    payeeName: v.payeeName || v.person || '',
    payeeAccount: v.payeeAccount || '',
    payeeBank: v.payeeBank || '',
    payeeBranch: v.payeeBranch || '',
    note: v.paidNote || '',
  }));
  const [busy, setBusy] = useState('');
  const set = (k) => (e) => setF((x) => ({ ...x, [k]: e?.target ? e.target.value : e }));
  const bank = f.payMethod === 'BANK';
  const receipt = v.type === 'PT';
  const missing = bank && !receipt && (!f.payeeAccount.trim() || !f.payeeBank.trim());

  const save = async (e) => {
    e?.preventDefault();
    if (missing) return;
    setBusy('save');
    try {
      await markVoucherPaid({ actor, v, paid: f });
      toast.success(`Đã ghi nhận ${receipt ? 'đã thu' : 'đã chi'} ${fmtVND(voucherAmount(v))} — ${v.person}. Bước tiếp theo: chốt sổ & in phiếu.`);
      onDone?.();
      onClose();
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };
  const undo = async () => {
    setBusy('undo');
    try {
      await markVoucherPaid({ actor, v, paid: null });
      toast.success('Đã bỏ đánh dấu đã chi');
      onClose();
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };

  return (
    <Modal
      open
      onClose={onClose}
      z="z-[65]"
      title={receipt ? 'Đã thu tiền' : 'Đã chi tiền'}
      subtitle={`${VTYPE[v.type].short}${v.no ? ` ${v.no}` : ''} · ${v.person} · ${fmtVND(voucherAmount(v))}`}
      footer={
        <>
          {v.paidAt && (
            <Button variant="dangerGhost" loading={busy === 'undo'} disabled={!!busy} onClick={undo} className="mr-auto">
              Bỏ đánh dấu
            </Button>
          )}
          <Button onClick={onClose}>Đóng</Button>
          <Button variant="jade" icon={Wallet} loading={busy === 'save'} disabled={!!busy || missing} onClick={save}>
            {receipt ? 'Xác nhận đã thu' : 'Xác nhận đã chi'}
          </Button>
        </>
      }
    >
      <form onSubmit={save} className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={receipt ? 'Ngày thu' : 'Ngày chi'}>
            <Input type="date" value={f.paidAt} max={todayISO()} onChange={set('paidAt')} />
          </Field>
          <Field label="Hình thức" as="div">
            <Segmented
              value={f.payMethod}
              onChange={set('payMethod')}
              options={[
                { value: 'CASH', label: 'Tiền mặt', icon: Banknote },
                { value: 'BANK', label: 'Chuyển khoản', icon: Landmark },
              ]}
            />
          </Field>
        </div>
        {bank && !receipt && (
          <div className="grid gap-3 rounded-xl border border-sapphire-200 bg-sapphire-50/50 p-3 sm:grid-cols-2">
            <Field label="Người thụ hưởng" className="sm:col-span-2">
              <Input value={f.payeeName} onChange={set('payeeName')} />
            </Field>
            <Field label="Số tài khoản" required>
              <Input value={f.payeeAccount} onChange={set('payeeAccount')} inputMode="numeric" className="font-mono" />
            </Field>
            <Field label="Ngân hàng" required>
              <Input value={f.payeeBank} onChange={set('payeeBank')} placeholder="VD: Vietcombank" />
            </Field>
            <Field label="Chi nhánh" className="sm:col-span-2">
              <Input value={f.payeeBranch} onChange={set('payeeBranch')} />
            </Field>
            <p className="text-xs text-slate-600 sm:col-span-2">Nội dung chuyển khoản: {v.transferNote || transferContent(v)}</p>
          </div>
        )}
        <Field label="Ghi chú (không bắt buộc)">
          <Input value={f.note} onChange={set('note')} placeholder={bank ? 'VD: Mã giao dịch / số UNC' : 'VD: Người nhận đã ký sổ'} />
        </Field>
        <p className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
          Ghi nhận này chưa vào sổ quỹ. Sau khi chi, vào “Sổ chi tiết & Lưu chứng từ” để chốt sổ, in phiếu Thông tư 200 và lưu hồ sơ.
        </p>
      </form>
    </Modal>
  );
}
