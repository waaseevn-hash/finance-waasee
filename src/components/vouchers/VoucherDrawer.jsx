import { useEffect, useState } from 'react';
import { Ban, CircleCheck, FileText, Link2, Pencil, Printer, RotateCcw, Send, Trash2, Undo2, X } from 'lucide-react';
import { useAuth } from '../../context/AuthContext.jsx';
import { useData } from '../../context/DataContext.jsx';
import { AuditedBatch, C, friendlyError } from '../../lib/db.js';
import { can } from '../../lib/roles.js';
import { fmtDate } from '../../lib/dates.js';
import { fmtVND } from '../../lib/format.js';
import { VTYPE, accountName, advanceRemaining, isBank, isPartial, itemAmount, moneyAccount, requestedAmount, settlement, transferContent, voucherAmount } from '../../lib/vouchers.js';
import { ApproveVoucherModal } from './ApproveVoucherModal.jsx';
import { moneyToWords } from '../../lib/vnwords.js';
import { deleteVoucher, loadAttachments, postVouchers, rejectVoucher, reverseVoucher } from '../../lib/voucherService.js';
import { todayISO } from '../../lib/dates.js';
import { cashBalance } from '../../lib/calc.js';
import { useConfirm, useToast } from '../feedback.jsx';
import { Money } from '../Money.jsx';
import { Badge, Button, Drawer, Field, Modal, Spinner, Textarea, cx } from '../ui.jsx';
import { Who } from '../Who.jsx';
import { TYPE_ICON, VStatusBadge, VTypeChip } from './common.jsx';

const TONE = { TU: 'amber', TT: 'orchid', PT: 'jade', PC: 'vermilion' };

function Row({ label, children }) {
  return (
    <div className="grid grid-cols-[130px_minmax(0,1fr)] gap-3 py-2 text-sm">
      <dt className="text-slate-500">{label}</dt>
      <dd className="text-slate-800 min-w-0 break-words">{children || <span className="text-slate-400">—</span>}</dd>
    </div>
  );
}

/** Lý do (từ chối / hủy kết chuyển) — hộp nhập bắt buộc */
export function ReasonModal({ open, title, label, confirmText, tone = 'danger', onClose, onConfirm, hint }) {
  const [text, setText] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) setText('');
  }, [open]);
  return (
    <Modal
      open={open}
      onClose={onClose}
      title={title}
      size="sm"
      z="z-[60]"
      footer={
        <>
          <Button onClick={onClose}>Hủy</Button>
          <Button
            variant={tone === 'danger' ? 'danger' : 'primary'}
            loading={busy}
            disabled={!text.trim()}
            onClick={async () => {
              setBusy(true);
              try {
                await onConfirm(text.trim());
              } finally {
                setBusy(false);
              }
            }}
          >
            {confirmText}
          </Button>
        </>
      }
    >
      <Field label={label} required hint={hint}>
        <Textarea rows={3} value={text} onChange={(e) => setText(e.target.value)} autoFocus />
      </Field>
    </Modal>
  );
}

/**
 * Chi tiết một chứng từ + thao tác theo vai trò & trạng thái.
 */
export function VoucherDrawer({ id, onClose, onEdit, onPrint, onOpen, onPosted, onPostBank }) {
  const { actor, role } = useAuth();
  const data = useData();
  const toast = useToast();
  const confirm = useConfirm();
  const v = (data.vouchers || []).find((x) => x.id === id) || null;
  const [files, setFiles] = useState(null);
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState('');
  const [reason, setReason] = useState(null); // 'reject' | 'reverse'
  const [approving, setApproving] = useState(false);

  const manager = can(role, 'approveVouchers');
  const owner = can(role, 'reverseVouchers');
  const mine = v && v.requestedBy === actor.email;

  useEffect(() => {
    setFiles(null);
    if (!v?.attachments?.length) return undefined;
    let alive = true;
    loadAttachments(v.attachments).then((list) => alive && setFiles(list));
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [v?.id, (v?.attachments || []).map((a) => a.id).join()]);

  if (!id) return null;
  if (!v) {
    return (
      <Drawer open onClose={onClose} title="Chứng từ" tone="ink">
        <p className="text-sm text-slate-500">Không tìm thấy chứng từ (có thể đã bị xóa hoặc bạn không có quyền xem).</p>
      </Drawer>
    );
  }

  const amount = voucherAmount(v);
  const s = v.type === 'TT' ? settlement(v) : null;
  const source = v.sourceId ? data.vouchers.find((x) => x.id === v.sourceId) : null;
  const gens = (v.generatedIds || []).map((g) => data.vouchers.find((x) => x.id === g)).filter(Boolean);
  const cancelledGens = data.vouchers.filter((x) => x.sourceId === v.id && x.status === 'CANCELLED');
  const advance = v.advanceId ? data.vouchers.find((x) => x.id === v.advanceId) : null;
  const settlements = v.type === 'TU' ? data.vouchers.filter((x) => x.type === 'TT' && x.advanceId === v.id && x.status !== 'CANCELLED') : [];
  const batch = v.postingBatchId ? (data.batches || []).find((b) => b.id === v.postingBatchId) : null;
  const Icon = TYPE_ICON[v.type];

  const run = async (key, fn, ok) => {
    setBusy(key);
    try {
      await fn();
      if (ok) toast.success(ok);
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };

  const submit = () =>
    run('submit', async () => {
      const b = new AuditedBatch(actor);
      b.update(C.vouchers, v.id, { status: 'PENDING', submittedOn: todayISO(), rejectReason: '' }, v, `Gửi duyệt ${VTYPE[v.type].short} ${v.person} · ${fmtVND(amount)}`);
      await b.commit();
    }, 'Đã gửi duyệt');
  const backToDraft = () =>
    run('draft', async () => {
      const b = new AuditedBatch(actor);
      b.update(C.vouchers, v.id, { status: 'DRAFT' }, v, `Rút về nháp ${VTYPE[v.type].short} ${v.person} · ${fmtVND(amount)}`);
      await b.commit();
    }, 'Đã rút về nháp');
  const approve = () => setApproving(true);
  const unapprove = async () => {
    const ok = await confirm({ title: `Hủy duyệt ${v.no}?`, message: 'Chứng từ quay về “Chờ duyệt” và giữ nguyên số đã cấp.', confirmText: 'Hủy duyệt' });
    if (ok) run('unapprove', () => rejectVoucher({ actor, v, toPending: true }), 'Đã hủy duyệt');
  };
  const remove = async () => {
    const ok = await confirm({ title: 'Xóa chứng từ này?', message: 'Chứng từ và ảnh đính kèm sẽ bị xóa (vẫn còn dấu vết trong Nhật ký).', confirmText: 'Xóa', tone: 'danger' });
    if (ok)
      run('delete', async () => {
        await deleteVoucher({ actor, v });
        onClose();
      }, 'Đã xóa chứng từ');
  };
  const postNow = async () => {
    // Chứng từ chuyển khoản: chuyển sang màn kết chuyển để chọn tài khoản ngân hàng của công ty
    if (isBank(v) && onPostBank) return onPostBank(v);
    const eff = v.type === 'PT' ? 'thu' : 'chi';
    const ok = await confirm({
      title: `Kết chuyển ngay ${v.no}?`,
      message: `Ghi sổ quỹ tiền mặt (${eff} ${fmtVND(amount)}${v.type === 'TT' ? ' theo quyết toán' : ''}), sinh phiếu tự động nếu có, rồi khóa chứng từ. Sau đó mở bản in.`,
      confirmText: 'Kết chuyển',
    });
    if (!ok) return;
    const before = cashBalance(data.cash);
    run('post', async () => {
      const res = await postVouchers({ actor, ids: [v.id], postDate: todayISO() });
      onPosted?.({ ...res, cash: { before } });
    }, 'Đã kết chuyển');
  };

  const printDocs = () => {
    const list = [v, ...gens.filter((g) => g.status !== 'CANCELLED')];
    onPrint(list, v.no || VTYPE[v.type].short);
  };

  const canEdit = (mine || manager) && !v.auto && ['DRAFT', 'PENDING', 'REJECTED'].includes(v.status);
  const canDelete = canEdit && !v.no;

  const footer = (
    <div className="flex flex-wrap gap-2 justify-end">
      <Button icon={Printer} onClick={printDocs}>
        In
      </Button>
      {canDelete && (
        <Button variant="dangerGhost" icon={Trash2} loading={busy === 'delete'} onClick={remove}>
          Xóa
        </Button>
      )}
      {canEdit && (
        <Button icon={Pencil} onClick={() => onEdit(v)}>
          Sửa
        </Button>
      )}
      {canEdit && v.status === 'PENDING' && mine && !manager && (
        <Button icon={Undo2} loading={busy === 'draft'} onClick={backToDraft}>
          Rút về nháp
        </Button>
      )}
      {canEdit && v.status !== 'PENDING' && (
        <Button variant="amber" icon={Send} loading={busy === 'submit'} onClick={submit}>
          Gửi duyệt
        </Button>
      )}
      {manager && v.status === 'PENDING' && (
        <>
          <Button variant="dangerGhost" icon={Ban} onClick={() => setReason('reject')}>
            Từ chối
          </Button>
          <Button variant="primary" icon={CircleCheck} loading={busy === 'approve'} onClick={approve}>
            Duyệt
          </Button>
        </>
      )}
      {manager && v.status === 'APPROVED' && !v.auto && (
        <>
          <Button variant="ghost" icon={Undo2} loading={busy === 'unapprove'} onClick={unapprove}>
            Hủy duyệt
          </Button>
          <Button variant="primary" icon={CircleCheck} loading={busy === 'post'} onClick={postNow}>
            Kết chuyển ngay
          </Button>
        </>
      )}
      {owner && v.status === 'POSTED' && !v.auto && (
        <Button variant="danger" icon={RotateCcw} onClick={() => setReason('reverse')}>
          Hủy kết chuyển
        </Button>
      )}
    </div>
  );

  return (
    <>
      <Drawer
        open
        onClose={onClose}
        tone={TONE[v.type]}
        icon={Icon}
        title={VTYPE[v.type].label}
        subtitle={`${VTYPE[v.type].form}${v.no ? ` · Số ${v.no}` : ' · chưa cấp số'}${v.auto ? ' · sinh tự động khi kết chuyển' : ''}`}
        hero={
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-md bg-white/90 px-1.5 py-0.5">
                <VStatusBadge status={v.status} />
              </span>
              <span className="text-xs text-white/80">{fmtDate(v.date)}</span>
            </div>
            <p className="mt-2 font-display text-3xl font-bold tabular-nums tracking-tight">{fmtVND(amount)}</p>
            <p className="text-xs italic text-white/85">{moneyToWords(amount)}</p>
            {isPartial(v) && (
              <p className="mt-1.5 inline-block rounded-md bg-white/15 px-2 py-0.5 text-xs text-white">
                Duyệt một phần · đề nghị {fmtVND(requestedAmount(v))}
              </p>
            )}
          </div>
        }
        footer={footer}
      >
        {v.status === 'REJECTED' && v.rejectReason && (
          <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-800">
            <b>Bị từ chối</b>
            {v.rejectedBy && (
              <>
                {' '}
                bởi <Who id={v.rejectedBy} />
              </>
            )}
            : {v.rejectReason}
          </div>
        )}
        {isPartial(v) && (
          <div className="mb-4 rounded-xl border border-sapphire-200 bg-sapphire-50 px-3 py-2 text-sm text-sapphire-900">
            <b>Duyệt một phần:</b> <Money value={amount} className="font-semibold" /> trên số đề nghị <Money value={requestedAmount(v)} /> — không duyệt{' '}
            <Money value={requestedAmount(v) - amount} className="font-semibold" />
            {v.approvalNote && <span className="block text-xs text-sapphire-800">Lý do: {v.approvalNote}</span>}
          </div>
        )}
        {!isPartial(v) && v.approvalNote && ['APPROVED', 'POSTED'].includes(v.status) && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">Ghi chú duyệt: {v.approvalNote}</div>
        )}
        {v.status === 'CANCELLED' && (
          <div className="mb-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
            Phiếu này đã bị hủy do chứng từ gốc được hủy kết chuyển{v.cancelReason ? `: ${v.cancelReason}` : ''}.
          </div>
        )}

        <dl className="divide-y divide-slate-100">
          <Row label={v.type === 'PT' ? 'Người nộp tiền' : v.type === 'PC' ? 'Người nhận tiền' : 'Người đề nghị'}>
            <span className="font-medium">{v.person}</span>
          </Row>
          <Row label={v.type === 'PT' || v.type === 'PC' ? 'Địa chỉ' : 'Bộ phận'}>{v.address || v.position}</Row>
          <Row label={v.type === 'PT' ? 'Lý do nộp' : v.type === 'PC' ? 'Lý do chi' : v.type === 'TU' ? 'Lý do tạm ứng' : 'Nội dung'}>{v.reason}</Row>
          {v.type === 'TU' && <Row label="Hạn hoàn ứng">{v.dueDate ? fmtDate(v.dueDate) : ''}</Row>}
          {v.type === 'TU' && v.status === 'POSTED' && (
            <Row label="Quyết toán">
              Đã quyết toán <Money value={v.settledAmount || 0} className="font-semibold" /> · còn <Money value={advanceRemaining(v)} className="font-semibold text-amber-700" />
            </Row>
          )}
          {v.type === 'PT' && <Row label="Định khoản">Nợ {moneyAccount(v)} / Có {v.credit} — {accountName(v.credit)}</Row>}
          {v.type === 'PC' && <Row label="Định khoản">Nợ {v.debit} — {accountName(v.debit)} / Có {moneyAccount(v)}</Row>}
          {(v.type === 'PT' || v.type === 'PC') && <Row label="Quyển số">{v.bookNo}</Row>}
          <Row label="Kèm theo">{v.attachedDocs ? `${v.attachedDocs} chứng từ gốc` : ''}</Row>
          <Row label={v.type === 'PT' ? 'Hình thức nhận' : 'Hình thức chi'}>
            {isBank(v) ? <span className="font-medium text-sapphire-700">Chuyển khoản (TK 112)</span> : 'Tiền mặt (TK 111)'}
          </Row>
          {isBank(v) && v.type !== 'PT' && (
            <Row label="Người thụ hưởng">
              <span className="block font-medium">{v.payeeName || v.person}</span>
              <span className="block font-mono text-[13px]">{v.payeeAccount}</span>
              <span className="block text-xs text-slate-500">
                {[v.payeeBank, v.payeeBranch].filter(Boolean).join(' – ')}
                {v.payeeTaxCode && ` · MST ${v.payeeTaxCode}`}
              </span>
              <span className="block text-xs text-slate-500">Nội dung CK: {v.transferNote || transferContent(v)}</span>
            </Row>
          )}
          {isBank(v) && batch?.payBank?.name && (
            <Row label={v.type === 'PT' ? 'Vào tài khoản' : 'Chi từ tài khoản'}>
              {batch.payBank.name}
              {batch.payBank.accountNo && <span className="font-mono"> · {batch.payBank.accountNo}</span>}
            </Row>
          )}
        </dl>

        {v.type === 'TT' && (
          <div className="mt-4">
            <p className="text-sm font-semibold text-ink-900 mb-2">Bảng kê chi phí</p>
            <div className="rounded-xl border border-slate-200 overflow-hidden">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 text-[11px] uppercase tracking-wide text-slate-500">
                  <tr>
                    <th className="px-2 py-2 text-center w-8">TT</th>
                    <th className="px-2 py-2 text-left">Tên chi phí</th>
                    <th className="px-2 py-2 text-right">SL × Đơn giá</th>
                    <th className="px-2 py-2 text-right">Thành tiền</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {(v.items || []).map((it, i) => (
                    <tr key={i}>
                      <td className="px-2 py-2 text-center text-slate-500">{i + 1}</td>
                      <td className="px-2 py-2">{it.name}</td>
                      <td className="px-2 py-2 text-right text-slate-500 tabular-nums whitespace-nowrap">
                        {Number(it.qty).toLocaleString('vi-VN')} {it.unit} × {fmtVND(it.price)}
                      </td>
                      <td className="px-2 py-2 text-right font-medium tabular-nums whitespace-nowrap">{fmtVND(itemAmount(it))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="divide-y divide-slate-100 border-t border-slate-200 text-sm">
                {isPartial(v) && (
                  <div className="flex justify-between px-3 py-2 text-slate-500">
                    <span>Tổng cộng bảng kê</span>
                    <Money value={requestedAmount(v)} />
                  </div>
                )}
                <div className="flex justify-between px-3 py-2 bg-orchid-50/50">
                  <span className="font-semibold">{isPartial(v) ? 'Được duyệt thanh toán (A)' : 'Tổng cộng (A)'}</span>
                  <Money value={s.A} className="font-bold" />
                </div>
                <div className="flex justify-between px-3 py-2">
                  <span>
                    Đã tạm ứng (B)
                    {v.advanceNo && (
                      <button type="button" className="ml-1 text-sapphire-700 hover:underline" onClick={() => advance && onOpen(advance.id)}>
                        theo {v.advanceNo}
                      </button>
                    )}
                  </span>
                  <Money value={s.B} />
                </div>
                {s.B > 0 && (
                  <div className={cx('flex justify-between px-3 py-2 font-semibold', s.refund > 0 ? 'bg-jade-50 text-jade-800' : s.extra > 0 ? 'bg-vermilion-50 text-vermilion-800' : '')}>
                    <span>{s.refund > 0 ? 'Số tạm ứng chi không hết (hoàn quỹ)' : s.extra > 0 ? 'Chi quá số tạm ứng (chi bổ sung)' : 'Chênh lệch'}</span>
                    <Money value={s.refund || s.extra} />
                  </div>
                )}
              </div>
            </div>
            <p className="mt-1 text-xs text-slate-500">TK chi phí ghi Nợ: {v.expenseAccount} — {accountName(v.expenseAccount)}</p>
          </div>
        )}

        {(v.entries || []).length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-semibold text-ink-900 mb-2">Định khoản đã ghi sổ</p>
            <ul className="rounded-xl border border-slate-200 divide-y divide-slate-100 text-sm">
              {v.entries.map((e, i) => (
                <li key={i} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="font-mono text-xs text-slate-700">
                    Nợ {e.debit} / Có {e.credit}
                  </span>
                  <Money value={e.amount} className="font-medium" />
                </li>
              ))}
            </ul>
          </div>
        )}

        {(source || gens.length > 0 || cancelledGens.length > 0 || settlements.length > 0 || batch) && (
          <div className="mt-4">
            <p className="text-sm font-semibold text-ink-900 mb-2 flex items-center gap-1.5">
              <Link2 className="h-4 w-4 text-slate-500" /> Chứng từ liên quan
            </p>
            <ul className="space-y-1.5 text-sm">
              {source && (
                <li>
                  <button type="button" className="text-sapphire-700 hover:underline" onClick={() => onOpen(source.id)}>
                    Chứng từ gốc: {source.no} · {VTYPE[source.type].short}
                  </button>
                </li>
              )}
              {gens.map((g) => (
                <li key={g.id} className="flex items-center gap-2">
                  <VTypeChip type={g.type} auto />
                  <button type="button" className="text-sapphire-700 hover:underline" onClick={() => onOpen(g.id)}>
                    {g.no} · {fmtVND(g.amount)}
                  </button>
                </li>
              ))}
              {cancelledGens.map((g) => (
                <li key={g.id} className="flex items-center gap-2 text-slate-400 line-through">
                  <button type="button" onClick={() => onOpen(g.id)}>
                    {g.no} · {fmtVND(g.amount)} (đã hủy)
                  </button>
                </li>
              ))}
              {settlements.map((t) => (
                <li key={t.id}>
                  <button type="button" className="text-sapphire-700 hover:underline" onClick={() => onOpen(t.id)}>
                    Quyết toán bởi {t.no || 'GĐNTT (chưa cấp số)'} · B = {fmtVND(t.advanceAmount)}
                  </button>{' '}
                  <VStatusBadge status={t.status} />
                </li>
              ))}
              {batch && (
                <li className="text-slate-600">
                  Đợt kết chuyển <b>{batch.code}</b> ngày {fmtDate(batch.postDate)}
                </li>
              )}
            </ul>
          </div>
        )}

        {(v.attachments || []).length > 0 && (
          <div className="mt-4">
            <p className="text-sm font-semibold text-ink-900 mb-2">Ảnh chứng từ gốc</p>
            {!files ? (
              <Spinner />
            ) : (
              <ul className="grid grid-cols-3 gap-2">
                {files.map((f) => (
                  <li key={f.id}>
                    {String(f.type).startsWith('image/') ? (
                      <button type="button" onClick={() => setPreview(f)} className="block aspect-square w-full overflow-hidden rounded-lg border border-slate-200">
                        <img src={f.dataUrl} alt={f.name} className="h-full w-full object-cover" />
                      </button>
                    ) : (
                      <a href={f.dataUrl} download={f.name} className="grid aspect-square w-full place-items-center rounded-lg border border-slate-200 p-2 text-center text-[11px] text-slate-600">
                        <FileText className="h-6 w-6 text-slate-400" />
                        <span className="line-clamp-2">{f.name}</span>
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}

        <div className="mt-5 rounded-xl bg-slate-50 px-3 py-2.5 text-xs text-slate-600 space-y-1">
          <p>
            Lập bởi <Who id={v.createdBy} /> {v.submittedOn && `· gửi duyệt ${fmtDate(v.submittedOn)}`}
          </p>
          {v.approvedBy && (
            <p>
              Duyệt bởi <Who id={v.approvedBy} /> · {fmtDate(v.approvedOn)}
            </p>
          )}
          {v.postedOn && (
            <p>
              Kết chuyển ngày {fmtDate(v.postedOn)} {v.postedBy && <>bởi <Who id={v.postedBy} /></>}
            </p>
          )}
          {v.lastReversal?.date && (
            <p className="text-rose-700">
              Đã hủy kết chuyển {v.reversedCount > 1 ? `${v.reversedCount} lần, lần gần nhất` : ''} ngày {fmtDate(v.lastReversal.date)}: {v.lastReversal.reason}
            </p>
          )}
          {v.status === 'POSTED' && <Badge tone="dark">Đã khóa — chỉ Chủ DN được hủy kết chuyển</Badge>}
        </div>
      </Drawer>

      <ReasonModal
        open={reason === 'reject'}
        title={`Từ chối ${VTYPE[v.type].short.toLowerCase()}`}
        label="Lý do từ chối (người lập sẽ thấy)"
        confirmText="Từ chối"
        onClose={() => setReason(null)}
        onConfirm={async (text) => {
          try {
            await rejectVoucher({ actor, v, reason: text });
            toast.success('Đã từ chối');
            setReason(null);
          } catch (ex) {
            toast.error(friendlyError(ex));
          }
        }}
      />
      <ReasonModal
        open={reason === 'reverse'}
        title={`Hủy kết chuyển ${v.no}`}
        label="Lý do hủy kết chuyển"
        hint="Hệ thống ghi bút toán đảo vào sổ quỹ (không xóa bút toán cũ), hủy các phiếu sinh tự động, trả chứng từ về “Đã duyệt · chờ kết xuất”. Thao tác được ghi Nhật ký."
        confirmText="Hủy kết chuyển"
        onClose={() => setReason(null)}
        onConfirm={async (text) => {
          try {
            const plan = await reverseVoucher({ actor, id: v.id, reason: text });
            toast.success(`Đã hủy kết chuyển — ghi ${plan.reversals.length} bút toán đảo`);
            setReason(null);
          } catch (ex) {
            toast.error(friendlyError(ex));
          }
        }}
      />
      {preview && (
        <div data-modal-open="" className="fixed inset-0 z-[70] grid place-items-center bg-ink-950/90 p-4" onClick={() => setPreview(null)}>
          <img src={preview.dataUrl} alt={preview.name} className="max-h-full max-w-full rounded-lg shadow-2xl" />
          <button type="button" className="absolute top-4 right-4 grid h-10 w-10 place-items-center rounded-full bg-white/15 text-white" aria-label="Đóng ảnh">
            <X className="h-5 w-5" />
          </button>
        </div>
      )}
      {approving && <ApproveVoucherModal voucher={v} onClose={() => setApproving(false)} />}
    </>
  );
}
