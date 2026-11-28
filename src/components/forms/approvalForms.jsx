import { useEffect, useMemo, useState } from 'react';
import { BadgeCheck, Copy, FileSpreadsheet, Hourglass, Pencil, Send, Stamp, Undo2 } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { AuditedBatch, C, friendlyError } from '../../lib/db.js';
import { APPROVAL_MODE, openPayOrders, pickApproval } from '../../lib/approvals.js';
import { approvalAmount, remaining } from '../../lib/calc.js';
import { fmtDate, todayISO } from '../../lib/dates.js';
import { fmtVND } from '../../lib/format.js';
import { can } from '../../lib/roles.js';
import { downloadXlsx } from '../../lib/xlsx.js';
import { notifyEvent } from '../../lib/notify.js';
export { isHeld } from '../../lib/pending.js';
import { Who } from '../Who.jsx';
import { Money, MoneyInput } from '../Money.jsx';
import { useConfirm, useToast } from '../feedback.jsx';
import { Badge, Button, Card, CardHeader, EmptyState, Field, Input, Modal, TableWrap, cx, td, th } from '../ui.jsx';
import { SupplierInfo, copyText, findSupplier } from './supplierForms.jsx';
import { PaymentModal, raw } from './debtForms.jsx';

/* ============================ Modal: Duyệt chi ============================ */
/**
 * Lưu lệnh duyệt chi một khoản phải trả (tạo mới hoặc sửa) và báo kế toán.
 * mode: 'FULL' (chi hết số còn nợ) | 'PART' (chi một phần = amount)
 */
export async function saveApproval({ actor, debt, approval = null, mode = 'FULL', amount, note = '', suppliers = [] }) {
  const rem = remaining(debt);
  const amt = mode === 'FULL' ? rem : Math.round(Number(amount) || 0);
  if (amt <= 0) throw new Error('Số tiền duyệt chi phải lớn hơn 0');
  if (amt > rem) throw new Error(`Vượt số còn phải trả (${fmtVND(rem)})`);
  const supplier = findSupplier(suppliers, debt);
  const b = new AuditedBatch(actor);
  const data = { mode, amount: amt, outstandingAtApproval: rem, note: String(note || '').trim() };
  const label = `${APPROVAL_MODE[mode]} ${fmtVND(amt)} — ${debt.partnerName}`;
  if (approval) {
    b.update(C.approvals, approval.id, { ...data, approvedOn: todayISO() }, pickApproval(approval), `Sửa duyệt chi: ${label}`);
  } else {
    b.create(
      C.approvals,
      {
        ...data,
        payableId: debt.id,
        partnerName: debt.partnerName,
        description: debt.description || '',
        supplierId: debt.supplierId || supplier?.id || '',
        approvedOn: todayISO(),
        status: 'OPEN',
        paidAmount: 0,
        paidOn: '',
        paymentId: '',
      },
      `Duyệt chi: ${label}`,
    );
  }
  // Khoản đang hoãn được duyệt lại: bỏ hoãn
  if (debt.holdUntil) b.update(C.ap, debt.id, { holdUntil: '', holdNote: '' }, raw(debt), `Bỏ hoãn — ${debt.partnerName}`);
  await b.commit();
  notifyEvent('APPROVED', {
    who: debt.partnerName,
    what: `Công nợ phải trả${debt.description ? ` — ${debt.description}` : ''}`,
    amount: amt,
    requested: rem,
    method: supplier?.bankAccount ? `Chuyển khoản ${supplier.bankName || ''} ${supplier.bankAccount}`.trim() : '',
    by: actor.name || actor.email,
  });
  return amt;
}

/** Ngày đầu tháng sau (ISO) */
const nextMonthStart = () => {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth() + 1, 1, 12).toISOString().slice(0, 10);
};

/** "Từ chối" một khoản phải trả = hoãn sang tháng sau (kèm lý do) — khoản nợ vẫn còn nguyên */
export async function holdPayable({ actor, debt, reason, until = nextMonthStart() }) {
  const b = new AuditedBatch(actor);
  b.update(C.ap, debt.id, { holdUntil: until, holdNote: String(reason || '').trim().slice(0, 300) }, raw(debt), `Hoãn chi đến ${until} — ${debt.partnerName}${reason ? ` (${reason})` : ''}`);
  await b.commit();
  notifyEvent('REJECTED', { who: debt.partnerName, what: `Hoãn chi công nợ phải trả${debt.description ? ` — ${debt.description}` : ''}`, amount: remaining(debt), reason: reason || 'Hoãn sang tháng sau', by: actor.name || actor.email });
}

export function ApproveModal({ open, onClose, debt, approval, suppliers = [] }) {
  const { actor } = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [f, setF] = useState(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const rem = debt ? remaining(debt) : 0;

  useEffect(() => {
    if (!open || !debt) return;
    setErr('');
    setF({
      mode: approval?.mode || 'FULL',
      amount: approval ? approvalAmount(approval, remaining(debt)) : Math.round(remaining(debt) / 2 / 1000) * 1000,
      note: approval?.note || '',
    });
  }, [open, debt, approval]);
  if (!open || !debt || !f) return null;
  const supplier = findSupplier(suppliers, debt);
  const amount = f.mode === 'FULL' ? rem : Math.round(Number(f.amount) || 0);

  const submit = async (e) => {
    e.preventDefault();
    if (amount <= 0) return setErr('Số tiền duyệt chi phải lớn hơn 0');
    if (amount > rem) return setErr(`Vượt số còn phải trả (${fmtVND(rem)}). Chọn “Chi hết” nếu muốn trả toàn bộ.`);
    setBusy(true);
    try {
      await saveApproval({ actor, debt, approval, mode: f.mode, amount, note: f.note, suppliers });
      toast.success(`Đã duyệt chi ${fmtVND(amount)} cho ${debt.partnerName} — kế toán sẽ thấy trong “Cần chi ngay”`);
      onClose();
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    const ok = await confirm({
      title: 'Hủy lệnh duyệt chi này?',
      message: `${debt.partnerName} — ${fmtVND(approvalAmount(approval, rem))}. Khoản phải trả vẫn còn, chỉ bỏ lệnh chi để kế toán không chuyển tiền.`,
      confirmText: 'Hủy duyệt chi',
      tone: 'danger',
    });
    if (!ok) return;
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      b.update(C.approvals, approval.id, { status: 'CANCELLED' }, pickApproval(approval), `Hủy duyệt chi — ${debt.partnerName}`);
      await b.commit();
      toast.success('Đã hủy lệnh duyệt chi');
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
      title={`${approval ? 'Sửa duyệt chi' : 'Duyệt chi'}: ${debt.partnerName}`}
      subtitle={debt.description}
      size="sm"
      footer={
        <>
          {approval && (
            <Button variant="dangerGhost" icon={Undo2} onClick={cancel} disabled={busy} className="mr-auto">
              Hủy duyệt
            </Button>
          )}
          <Button onClick={onClose}>Đóng</Button>
          <Button type="submit" form="approve-form" variant="vermilion" icon={Stamp} loading={busy}>
            {approval ? 'Lưu duyệt chi' : 'Duyệt chi'} <Money value={amount} />
          </Button>
        </>
      }
    >
      <form id="approve-form" onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-3 gap-2 text-center text-xs">
          <div className="rounded-lg bg-slate-50 px-2 py-2">
            <p className="text-slate-500">Tổng công nợ</p>
            <Money value={debt.total} className="font-semibold text-slate-800" />
          </div>
          <div className="rounded-lg bg-slate-50 px-2 py-2">
            <p className="text-slate-500">Đã trả</p>
            <Money value={debt.paid} className="font-semibold text-slate-800" />
          </div>
          <div className="rounded-lg bg-amber-50 px-2 py-2">
            <p className="text-amber-700">Còn phải trả</p>
            <Money value={rem} className="font-semibold text-amber-800" />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1" role="radiogroup" aria-label="Số tiền duyệt chi">
          {[
            ['FULL', 'Chi hết', 'Trả toàn bộ số còn nợ'],
            ['PART', 'Chi 1 phần', 'Tự nhập số tiền'],
          ].map(([m, label, hint]) => (
            <button
              key={m}
              type="button"
              role="radio"
              aria-checked={f.mode === m}
              onClick={() => setF((x) => ({ ...x, mode: m }))}
              className={cx(
                'rounded-lg px-3 py-2 text-left transition-colors',
                f.mode === m ? (m === 'FULL' ? 'bg-vermilion-500 text-white shadow-sm' : 'bg-amber-500 text-white shadow-sm') : 'text-slate-600 hover:bg-white',
              )}
            >
              <span className="block text-sm font-semibold">{label}</span>
              <span className={cx('block text-[11px]', f.mode === m ? 'text-white/85' : 'text-slate-500')}>{hint}</span>
            </button>
          ))}
        </div>

        {f.mode === 'PART' ? (
          <Field label="Số tiền duyệt chi đợt này" required>
            <MoneyInput value={f.amount} onChange={(v) => setF((x) => ({ ...x, amount: v }))} autoFocus />
            <p className="mt-1 text-xs text-slate-500">
              Còn nợ lại sau đợt này: <Money value={Math.max(0, rem - amount)} className="font-semibold text-amber-700" />
            </p>
          </Field>
        ) : (
          <p className="rounded-xl bg-vermilion-50 px-3 py-2.5 text-sm text-vermilion-700">
            Duyệt chi toàn bộ: <Money value={rem} className="font-bold" />
          </p>
        )}

        <div className="rounded-xl border border-slate-200 px-3 py-2.5">
          <p className="text-xs font-semibold text-slate-500">Chuyển khoản tới</p>
          <p className="text-sm font-medium text-ink-900">{supplier?.accountHolder || supplier?.name || debt.partnerName}</p>
          <SupplierInfo supplier={supplier || { name: debt.partnerName }} />
        </div>

        <Field label="Ghi chú cho kế toán (tùy chọn)">
          <Input value={f.note} onChange={(e) => setF((x) => ({ ...x, note: e.target.value }))} placeholder="VD: chuyển trước ngày 25, ghi rõ số hóa đơn" />
        </Field>
        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
      </form>
    </Modal>
  );
}

/* =================== Trạng thái + nút thao tác cho một khoản phải trả =================== */
export function ApprovalBadge({ approval, outstanding }) {
  if (!approval) return null;
  return (
    <Badge tone="green" icon={BadgeCheck}>
      Đã duyệt {approval.mode === 'FULL' ? 'chi hết' : 'chi 1 phần'} {fmtVND(approvalAmount(approval, outstanding))}
    </Badge>
  );
}

/**
 * Thay cho nút "Trả tiền" ở công nợ phải trả:
 *   Người duyệt (Chủ DN / Đồng quản trị): "Duyệt chi" hoặc "Sửa duyệt" + "Đã chuyển tiền"
 *   Kế toán: "Đã chuyển tiền" khi khoản đã được duyệt, ngược lại hiện "Chờ duyệt chi"
 */
export function ApActions({ approval, onApprove, onExecute, size = 'xs' }) {
  const { role } = useAuth();
  const approver = can(role, 'approvePayments');
  if (approval) {
    return (
      <>
        <Button size={size} variant="success" icon={Send} onClick={onExecute} title="Ghi nhận sau khi đã chuyển khoản cho đối tác">
          Đã chuyển tiền
        </Button>
        {approver && (
          <Button size={size} icon={Pencil} onClick={onApprove} title="Sửa / hủy lệnh duyệt chi">
            Sửa duyệt
          </Button>
        )}
      </>
    );
  }
  if (approver) {
    return (
      <Button size={size} variant="vermilion" icon={Stamp} onClick={onApprove}>
        Duyệt chi
      </Button>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-slate-100 px-2 py-1 text-[11px] font-medium text-slate-500" title="Chủ doanh nghiệp chưa duyệt chi khoản này">
      <Hourglass className="h-3 w-3" /> Chờ duyệt chi
    </span>
  );
}

/** Quản lý modal duyệt chi / đã chuyển tiền dùng chung cho các danh sách công nợ phải trả */
export function useApprovalFlow({ ap, approvals, suppliers }) {
  const [approveFor, setApproveFor] = useState(null); // { debt, approval }
  const [executeFor, setExecuteFor] = useState(null); // { debt, approval }
  const openByPayable = useMemo(() => {
    const m = new Map();
    for (const a of approvals || []) if (a.status === 'OPEN') m.set(a.payableId, a);
    return m;
  }, [approvals]);
  const fresh = (d) => (d ? ap.find((x) => x.id === d.id) || d : null);
  const freshApproval = (a) => (a ? (approvals || []).find((x) => x.id === a.id && x.status === 'OPEN') || null : null);

  const actionsFor = (r, size) => {
    const approval = openByPayable.get(r.id) || null;
    return (
      <ApActions
        size={size}
        approval={approval}
        onApprove={() => setApproveFor({ debt: raw(r), approval })}
        onExecute={() => setExecuteFor({ debt: raw(r), approval })}
      />
    );
  };
  const execApproval = executeFor ? freshApproval(executeFor.approval) : null;
  const modals = (
    <>
      <ApproveModal
        open={!!approveFor}
        onClose={() => setApproveFor(null)}
        debt={approveFor && raw(fresh(approveFor.debt))}
        approval={approveFor ? freshApproval(approveFor.approval) : null}
        suppliers={suppliers}
      />
      <PaymentModal
        open={!!executeFor && !!execApproval}
        onClose={() => setExecuteFor(null)}
        kind="ap"
        debt={executeFor && raw(fresh(executeFor.debt))}
        approval={execApproval && { ...execApproval, supplier: findSupplier(suppliers, executeFor.debt) }}
      />
    </>
  );
  return { openByPayable, actionsFor, modals, approve: (debt, approval) => setApproveFor({ debt: raw(debt), approval }), execute: (debt, approval) => setExecuteFor({ debt: raw(debt), approval }) };
}

/* ========================= Tab: Lệnh chi đã duyệt (kế toán đi lệnh) ========================= */
function exportOrders(orders, toast) {
  const done = downloadXlsx(`Lenh-chi-da-duyet_${todayISO()}`, [
    {
      name: 'Lệnh chi đã duyệt',
      colWidths: [6, 30, 16, 20, 20, 22, 28, 16, 40, 12, 12],
      rows: [
        ['STT', 'Nhà cung cấp', 'Mã số thuế', 'Số tài khoản', 'Ngân hàng', 'Chi nhánh', 'Chủ tài khoản', 'Số tiền', 'Nội dung', 'Hình thức', 'Ngày duyệt'],
        ...orders.map((o, i) => [
          i + 1,
          o.supplier?.name || o.partnerName,
          o.supplier?.taxCode || '',
          o.supplier?.bankAccount || '',
          o.supplier?.bankName || '',
          o.supplier?.bankBranch || '',
          o.supplier?.accountHolder || '',
          o.payAmount,
          [o.description, o.note].filter(Boolean).join(' — '),
          APPROVAL_MODE[o.mode] || '',
          o.approvedOn ? fmtDate(o.approvedOn) : '',
        ]),
        ['', 'TỔNG CỘNG', '', '', '', '', '', orders.reduce((s, o) => s + o.payAmount, 0), '', '', ''],
      ],
    },
  ]);
  done.then(() => toast.success('Đã xuất danh sách lệnh chi')).catch((ex) => ex?.code !== 'declined' && toast.error(friendlyError(ex)));
}

const Missing = () => <span className="italic text-amber-700">Chưa có</span>;

export function PayOrdersPanel({ ap, approvals, suppliers, flow }) {
  const toast = useToast();
  const { role } = useAuth();
  const orders = useMemo(() => openPayOrders(approvals, ap, suppliers), [approvals, ap, suppliers]);
  const total = orders.reduce((s, o) => s + o.payAmount, 0);
  const since = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);
  const done = useMemo(
    () => (approvals || []).filter((a) => a.status === 'DONE' && (a.paidOn || '') >= since).sort((a, b) => (b.paidOn || '').localeCompare(a.paidOn || '')),
    [approvals, since],
  );
  const doneTotal = done.reduce((s, a) => s + (Number(a.paidAmount) || 0), 0);
  const approver = can(role, 'approvePayments');

  return (
    <div className="space-y-4 my-5">
      <Card className="overflow-hidden">
        <div className="relative bg-gradient-to-br from-vermilion-500 to-vermilion-700 guilloche text-white px-4 sm:px-5 py-4 flex flex-wrap items-end justify-between gap-3">
          <div className="relative">
            <p className="text-sm text-white/85">Lệnh chi đã duyệt — chờ chuyển tiền</p>
            <Money value={total} className="block text-2xl font-bold" />
            <p className="text-xs text-white/80">{orders.length} lệnh chi · kế toán chuyển khoản theo danh sách này rồi bấm “Đã chuyển tiền”</p>
          </div>
          <Button variant="white" icon={FileSpreadsheet} onClick={() => exportOrders(orders, toast)} disabled={!orders.length} className="relative">
            Xuất Excel đi lệnh
          </Button>
        </div>

        {orders.length === 0 ? (
          <EmptyState
            icon={BadgeCheck}
            title="Không có lệnh chi nào đang chờ"
            description={approver ? 'Vào tab Phải trả, bấm “Duyệt chi” ở khoản muốn trả.' : 'Khi Chủ doanh nghiệp duyệt chi một khoản phải trả, khoản đó hiện ở đây.'}
          />
        ) : (
          <>
            <TableWrap className="hidden lg:block">
              <table className="w-full">
                <thead className="bg-slate-50/80">
                  <tr>
                    <th className={th}>Nhà cung cấp</th>
                    <th className={th}>Tài khoản nhận tiền</th>
                    <th className={th}>Nội dung</th>
                    <th className={th}>Duyệt</th>
                    <th className={cx(th, 'text-right')}>Số tiền chuyển</th>
                    <th className={th} />
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 text-sm">
                  {orders.map((o) => (
                    <tr key={o.id} className="align-top">
                      <td className={td}>
                        <p className="font-medium text-ink-900">{o.supplier?.name || o.partnerName}</p>
                        <p className="text-xs text-slate-500">MST {o.supplier?.taxCode || <Missing />}</p>
                        {o.supplier?.phone && <p className="text-xs text-slate-500">ĐT {o.supplier.phone}</p>}
                      </td>
                      <td className={td}>
                        {o.supplier?.bankAccount ? (
                          <button
                            type="button"
                            onClick={() => copyText(o.supplier.bankAccount, toast)}
                            className="inline-flex items-center gap-1.5 font-semibold tabular-nums text-ink-900 hover:text-sapphire-700"
                            title="Chép số tài khoản"
                          >
                            {o.supplier.bankAccount} <Copy className="h-3.5 w-3.5 text-slate-400" />
                          </button>
                        ) : (
                          <Missing />
                        )}
                        <p className="text-xs text-slate-500">{[o.supplier?.bankName, o.supplier?.bankBranch].filter(Boolean).join(' – ') || <Missing />}</p>
                        <p className="text-xs text-slate-500">Chủ TK: {o.supplier?.accountHolder || <Missing />}</p>
                      </td>
                      <td className={cx(td, 'max-w-[260px]')}>
                        <p className="text-slate-700">{o.description || '—'}</p>
                        {o.note && <p className="mt-0.5 text-xs text-vermilion-700">Ghi chú: {o.note}</p>}
                      </td>
                      <td className={cx(td, 'whitespace-nowrap')}>
                        <Badge tone={o.mode === 'FULL' ? 'orange' : 'amber'}>{APPROVAL_MODE[o.mode]}</Badge>
                        <p className="mt-1 text-xs text-slate-500">
                          {o.approvedOn ? fmtDate(o.approvedOn) : ''} · <Who id={o.updatedBy || o.createdBy} />
                        </p>
                        {o.mode === 'PART' && (
                          <p className="text-xs text-slate-500">
                            Còn nợ lại <Money value={Math.max(0, o.outstanding - o.payAmount)} />
                          </p>
                        )}
                      </td>
                      <td className={cx(td, 'text-right')}>
                        <Money value={o.payAmount} className="text-base font-bold text-vermilion-600" />
                      </td>
                      <td className={cx(td, 'text-right whitespace-nowrap space-x-1')}>{flow.actionsFor(o.debt)}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-slate-50/80">
                    <td className={cx(td, 'font-semibold')} colSpan={4}>
                      Tổng cộng {orders.length} lệnh chi
                    </td>
                    <td className={cx(td, 'text-right')}>
                      <Money value={total} className="text-base font-bold text-ink-900" />
                    </td>
                    <td className={td} />
                  </tr>
                </tfoot>
              </table>
            </TableWrap>

            <ul className="lg:hidden divide-y divide-slate-100">
              {orders.map((o) => (
                <li key={o.id} className="px-4 py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-ink-900">{o.supplier?.name || o.partnerName}</p>
                      <p className="text-xs text-slate-500 truncate">{o.description}</p>
                    </div>
                    <Money value={o.payAmount} className="shrink-0 text-sm font-bold text-vermilion-600" />
                  </div>
                  <div className="mt-2 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600 space-y-0.5">
                    <p>
                      STK:{' '}
                      {o.supplier?.bankAccount ? (
                        <button type="button" className="font-semibold text-ink-900" onClick={() => copyText(o.supplier.bankAccount, toast)}>
                          {o.supplier.bankAccount} <Copy className="inline h-3 w-3 text-slate-400" />
                        </button>
                      ) : (
                        <Missing />
                      )}
                    </p>
                    <p>{[o.supplier?.bankName, o.supplier?.bankBranch].filter(Boolean).join(' – ') || <Missing />}</p>
                    <p>Chủ TK: {o.supplier?.accountHolder || <Missing />} · MST {o.supplier?.taxCode || <Missing />}</p>
                    {o.note && <p className="text-vermilion-700">Ghi chú: {o.note}</p>}
                  </div>
                  <div className="mt-2 flex items-center justify-between gap-2">
                    <Badge tone={o.mode === 'FULL' ? 'orange' : 'amber'}>{APPROVAL_MODE[o.mode]}</Badge>
                    <span className="flex gap-1">{flow.actionsFor(o.debt)}</span>
                  </div>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      <Card>
        <CardHeader
          title="Đã chuyển tiền trong 30 ngày"
          subtitle={done.length ? `${done.length} lệnh · ${fmtVND(doneTotal)}` : 'Chưa có lệnh nào được chuyển'}
          icon={Send}
          iconClass="bg-jade-50 text-jade-700"
        />
        {done.length > 0 && (
          <ul className="divide-y divide-slate-100 border-t border-slate-100">
            {done.map((a) => (
              <li key={a.id} className="flex items-center gap-3 px-4 sm:px-5 py-2.5 text-sm">
                <span className="w-20 shrink-0 tabular-nums text-slate-500">{fmtDate(a.paidOn)}</span>
                <span className="min-w-0 flex-1 truncate">
                  <span className="font-medium text-ink-900">{a.partnerName}</span>
                  <span className="text-slate-500"> · {a.description}</span>
                </span>
                <span className="hidden sm:block text-xs text-slate-500">
                  <Who id={a.updatedBy} />
                </span>
                <Money value={a.paidAmount} className="font-semibold text-jade-700" />
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}
