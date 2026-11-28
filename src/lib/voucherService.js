/**
 * Ghi dữ liệu chứng từ thu chi nội bộ lên Firestore.
 * Mọi thao tác nhiều tài liệu chạy trong giao dịch (runTransaction) có nhật ký gộp — xem db.js / firestore.rules.
 */
import { collection, deleteDoc, doc, getDoc, getDocs, query, setDoc, serverTimestamp, where } from 'firebase/firestore';
import { db } from './firebase.js';
import { notifyEvent } from './notify.js';
import { AuditedBatch, C, newId, runAuditedTx } from './db.js';
import { todayISO } from './dates.js';
import {
  PARTIAL_TYPES,
  VTYPE,
  buildApprovalNumbers,
  buildPostingPlan,
  buildReversalPlan,
  counterKey,
  countersNeeded,
  requestedAmount,
  bankFlow,
  isBank,
  itemsTotal,
  settlement,
  voucherAmount,
} from './vouchers.js';
import { fmtVND } from './format.js';

/** Các trường người lập được sửa */
export const CONTENT_KEYS = [
  'type',
  'date',
  'person',
  'position',
  'address',
  'reason',
  'amount',
  'items',
  'total',
  'advanceId',
  'advanceNo',
  'advanceAmount',
  'expenseAccount',
  'debit',
  'credit',
  'attachedDocs',
  'bookNo',
  'dueDate',
  'attachments',
];

const num = (v) => Math.round(Number(v) || 0);

/** Chuẩn hóa dữ liệu biểu mẫu thành tài liệu lưu trữ */
export function normalizeForm(f) {
  const items = f.type === 'TT'
    ? (f.items || []).map((it) => ({ name: String(it.name || '').trim().slice(0, 300), unit: String(it.unit || '').trim().slice(0, 30), qty: Number(it.qty) || 0, price: num(it.price) }))
    : [];
  const out = {
    type: f.type,
    date: f.date,
    person: String(f.person || '').trim().slice(0, 200),
    position: String(f.position || '').trim().slice(0, 200),
    address: String(f.address || '').trim().slice(0, 300),
    reason: String(f.reason || '').trim().slice(0, 1000),
    items,
    advanceId: f.type === 'TT' ? f.advanceId || '' : '',
    advanceNo: f.type === 'TT' ? f.advanceNo || '' : '',
    advanceAmount: f.type === 'TT' ? Math.max(0, num(f.advanceAmount)) : 0,
    expenseAccount: f.type === 'TT' ? String(f.expenseAccount || '642') : '',
    debit: f.type === 'PC' ? String(f.debit || '642') : '',
    credit: f.type === 'PT' ? String(f.credit || '141') : '',
    attachedDocs: String(f.attachedDocs || '').trim().slice(0, 200),
    bookNo: f.type === 'PT' || f.type === 'PC' ? String(f.bookNo || '').trim().slice(0, 20) : '',
    dueDate: f.type === 'TU' ? f.dueDate || '' : '',
    attachments: (f.attachments || []).slice(0, 12).map((a) => ({ id: a.id, name: a.name, type: a.type, size: a.size })),
  };
  // Hình thức thanh toán: tiền mặt (111) hoặc chuyển khoản (112). Phiếu thu chuyển khoản không cần TK người nộp.
  const bank = f.payMethod === 'BANK';
  const payee = bank && f.type !== 'PT';
  out.payMethod = bank ? 'BANK' : 'CASH';
  out.payeeName = payee ? String(f.payeeName || f.person || '').trim().slice(0, 200) : '';
  out.payeeAccount = payee ? String(f.payeeAccount || '').replace(/\s+/g, '').slice(0, 40) : '';
  out.payeeBank = payee ? String(f.payeeBank || '').trim().slice(0, 200) : '';
  out.payeeBranch = payee ? String(f.payeeBranch || '').trim().slice(0, 200) : '';
  out.payeeTaxCode = payee ? String(f.payeeTaxCode || '').trim().slice(0, 20) : '';
  out.transferNote = payee ? String(f.transferNote || '').trim().slice(0, 200) : '';
  out.amount = f.type === 'TT' ? items.reduce((s, it) => s + Math.round(it.qty * it.price), 0) : num(f.amount);
  out.total = f.type === 'TT' ? out.amount : 0;
  return out;
}

const describe = (v) => `${VTYPE[v.type]?.short || ''} ${v.no || ''} · ${v.person} · ${fmtVND(voucherAmount(v))}`.replace(/\s+/g, ' ').trim();

/**
 * Lưu chứng từ: mode 'draft' | 'submit' | 'approve' (chỉ quản lý).
 * @returns id chứng từ
 */
export async function saveVoucher({ actor, id, existing, form, mode }) {
  const content = normalizeForm(form);
  const status = mode === 'draft' ? 'DRAFT' : mode === 'submit' ? 'PENDING' : 'APPROVED';
  if (mode !== 'approve') {
    const b = new AuditedBatch(actor);
    if (!existing) {
      b.create(
        C.vouchers,
        {
          ...content,
          status,
          auto: false,
          requestedBy: actor.email,
          no: '',
          approvedBy: '',
          approvedByName: '',
          approvedOn: '',
          rejectReason: '',
          postingBatchId: '',
          postedOn: '',
          settledAmount: 0,
          entries: [],
          cashEntryIds: [],
          generatedIds: [],
          submittedOn: status === 'PENDING' ? todayISO() : '',
        },
        `${status === 'PENDING' ? 'Lập & gửi duyệt' : 'Lập nháp'} ${describe(content)}`,
        { id },
      );
    } else {
      const patch = { ...content, status, rejectReason: existing.status === 'REJECTED' ? '' : existing.rejectReason || '', submittedOn: status === 'PENDING' ? todayISO() : existing.submittedOn || '' };
      b.update(C.vouchers, existing.id, patch, existing, `${status === 'PENDING' ? 'Gửi duyệt' : 'Sửa nháp'} ${describe({ ...existing, ...content })}`);
    }
    await b.commit();
    if (status === 'PENDING') notifyProposed({ ...(existing || {}), ...content }, actor);
    return existing?.id || id;
  }

  // Quản lý lưu & duyệt ngay: cấp số trong giao dịch
  return runAuditedTx(actor, { summary: '', primaryPath: `${C.vouchers}/${existing?.id || id}` }, async (tx, audit) => {
    const key = counterKey(content.type, content.date);
    const cSnap = await tx.get(doc(db, C.counters, key));
    let cur = null;
    if (existing) {
      const s = await tx.get(doc(db, C.vouchers, existing.id));
      if (!s.exists()) throw new Error('Chứng từ không còn tồn tại');
      cur = { id: s.id, ...s.data() };
      if (!['DRAFT', 'PENDING', 'REJECTED'].includes(cur.status)) throw new Error('Chứng từ đã được duyệt hoặc chốt sổ bởi người khác');
    }
    const counters = { [key]: cSnap.exists() ? cSnap.data().value || 0 : 0 };
    const vid = existing?.id || id;
    const { numbers, counters: next } = buildApprovalNumbers({ vouchers: [{ id: vid, ...content, no: cur?.no || '' }], counters });
    const approval = { status: 'APPROVED', no: numbers[vid], approvedBy: actor.email, approvedByName: actor.name || actor.email, approvedOn: todayISO(), rejectReason: '', approvedAmount: 0, approvalNote: '' };
    if (!cur) {
      audit.create(
        C.vouchers,
        {
          ...content,
          ...approval,
          auto: false,
          requestedBy: actor.email,
          postingBatchId: '',
          postedOn: '',
          settledAmount: 0,
          entries: [],
          cashEntryIds: [],
          generatedIds: [],
          submittedOn: todayISO(),
        },
        { id: vid },
      );
    } else {
      audit.update(C.vouchers, vid, { ...content, ...approval }, cur);
    }
    if (next[key] !== counters[key]) tx.set(doc(db, C.counters, key), { value: next[key], updatedBy: actor.email, updatedAt: serverTimestamp() });
    audit.summary = `Lập & duyệt ${describe({ ...content, no: approval.no })}`;
    return vid;
  });
}

/**
 * Duyệt một hoặc nhiều chứng từ đang chờ duyệt (cấp số).
 * partial: { [id]: { amount, note } } — duyệt một phần (số nhỏ hơn số đề nghị); không có thì duyệt toàn bộ.
 */
export async function approveVouchers(args) {
  const nums = await approveVouchersTx(args);
  try {
    const list = (args.list || []).filter((v) => args.ids.includes(v.id));
    if (list.length) {
      const total = list.reduce((t, v) => {
        const p = args.partial?.[v.id];
        return t + (p && Number(p.amount) > 0 && Number(p.amount) < requestedAmount(v) ? Math.round(Number(p.amount)) : requestedAmount(v));
      }, 0);
      const one = list[0];
      notifyEvent('APPROVED', {
        who: list.length === 1 ? one.person : `${list.length} đề xuất`,
        what: list.length === 1 ? `${nums[one.id] || ''} ${one.reason || ''}`.trim() : list.map((v) => nums[v.id]).join(', '),
        amount: total,
        requested: list.length === 1 ? requestedAmount(one) : undefined,
        method: list.length === 1 ? (isBank(one) ? 'Chuyển khoản' : 'Tiền mặt') : '',
        by: args.actor.name || args.actor.email,
        count: list.length,
      });
    }
  } catch {
    /* thông báo không được làm hỏng thao tác duyệt */
  }
  return nums;
}

function approveVouchersTx({ actor, ids, partial = {} }) {
  return runAuditedTx(actor, { summary: '' }, async (tx, audit) => {
    const snaps = await Promise.all(ids.map((id) => tx.get(doc(db, C.vouchers, id))));
    const list = snaps.map((s) => {
      if (!s.exists()) throw new Error('Có chứng từ không còn tồn tại. Tải lại trang.');
      return { id: s.id, ...s.data() };
    });
    const bad = list.filter((v) => v.status !== 'PENDING');
    if (bad.length) throw new Error(`${bad.map((v) => v.no || v.person).join(', ')} không còn ở trạng thái Chờ duyệt.`);
    const keys = [...new Set(list.filter((v) => !v.no).map((v) => counterKey(v.type, v.date)))];
    const cs = await Promise.all(keys.map((k) => tx.get(doc(db, C.counters, k))));
    const counters = Object.fromEntries(keys.map((k, i) => [k, cs[i].exists() ? cs[i].data().value || 0 : 0]));
    const { numbers, counters: next } = buildApprovalNumbers({ vouchers: list, counters });
    const today = todayISO();
    const partialNo = [];
    for (const v of list) {
      const req = requestedAmount(v);
      const p = partial[v.id];
      const want = p ? Math.round(Number(p.amount) || 0) : 0;
      if (p && (want <= 0 || want > req)) throw new Error(`Số duyệt của ${v.person} phải lớn hơn 0 và không vượt số đề nghị ${fmtVND(req)}`);
      if (p && want < req && !PARTIAL_TYPES.includes(v.type)) throw new Error('Phiếu thu chỉ duyệt toàn bộ số tiền');
      const approvedAmount = p && want < req ? want : 0;
      if (approvedAmount) partialNo.push(`${numbers[v.id]} duyệt ${fmtVND(approvedAmount)}/${fmtVND(req)}`);
      audit.update(
        C.vouchers,
        v.id,
        { status: 'APPROVED', no: numbers[v.id], approvedBy: actor.email, approvedByName: actor.name || actor.email, approvedOn: today, rejectReason: '', approvedAmount, approvalNote: String(p?.note || '').trim().slice(0, 300) },
        v,
      );
    }
    for (const k of keys) {
      if (next[k] !== counters[k]) tx.set(doc(db, C.counters, k), { value: next[k], updatedBy: actor.email, updatedAt: serverTimestamp() });
    }
    audit.summary =
      (list.length === 1 ? `Duyệt ${describe({ ...list[0], no: numbers[list[0].id] })}` : `Duyệt ${list.length} chứng từ: ${list.map((v) => numbers[v.id]).join(', ')}`) +
      (partialNo.length ? ` — duyệt một phần: ${partialNo.join('; ')}` : '');
    return numbers;
  });
}

/** Từ chối (kèm lý do) hoặc hủy duyệt (đưa về Chờ duyệt) */
export async function rejectVoucher({ actor, v, reason, toPending = false }) {
  const b = new AuditedBatch(actor);
  const patch = toPending
    ? { status: 'PENDING', approvedBy: '', approvedByName: '', approvedOn: '' }
    : { status: 'REJECTED', rejectReason: String(reason || '').trim().slice(0, 500), rejectedBy: actor.email, rejectedOn: todayISO(), approvedBy: '', approvedByName: '', approvedOn: '' };
  // Bỏ số duyệt một phần cũ (khi duyệt lại sẽ chọn lại)
  if (v.approvedAmount) Object.assign(patch, { approvedAmount: 0, approvalNote: '' });
  b.update(C.vouchers, v.id, patch, v, `${toPending ? 'Hủy duyệt' : `Từ chối (${patch.rejectReason})`} ${describe(v)}`);
  await b.commit();
  if (!toPending) notifyEvent('REJECTED', { who: v.person, what: `${VTYPE[v.type]?.short || ''} — ${v.reason || ''}`, amount: requestedAmount(v), reason: patch.rejectReason, by: actor.name || actor.email });
}

/** Báo Sếp có đề xuất mới (gọi sau khi gửi duyệt) */
export function notifyProposed(v, actor) {
  notifyEvent('PROPOSED', {
    who: v.person,
    what: `${VTYPE[v.type]?.short || ''} — ${v.reason || ''}`,
    amount: v.type === 'TT' ? itemsTotal(v.items) : Math.round(Number(v.amount) || 0),
    method: v.payMethod === 'BANK' ? 'Chuyển khoản' : 'Tiền mặt',
    by: actor?.name || actor?.email,
  });
}

/**
 * Kế toán báo "Đã chi tiền" cho khoản Sếp đã duyệt (chưa chốt sổ).
 * Ghi ngày chi, người chi, hình thức thực chi (tiền mặt / chuyển khoản, tài khoản người nhận). Không đổi số tiền.
 * paid = null: bỏ đánh dấu đã chi.
 */
export async function markVoucherPaid({ actor, v, paid }) {
  if (v.status !== 'APPROVED') throw new Error('Chỉ báo đã chi cho khoản đã duyệt, chưa chốt sổ');
  const b = new AuditedBatch(actor);
  const patch = paid
    ? {
        paidAt: paid.paidAt || todayISO(),
        paidBy: actor.email,
        paidByName: actor.name || actor.email,
        paidNote: String(paid.note || '').trim().slice(0, 300),
        payMethod: paid.payMethod === 'BANK' ? 'BANK' : 'CASH',
        ...(paid.payMethod === 'BANK' && v.type !== 'PT'
          ? {
              payeeName: String(paid.payeeName ?? v.payeeName ?? '').trim().slice(0, 200),
              payeeAccount: String(paid.payeeAccount ?? v.payeeAccount ?? '').replace(/\s+/g, '').slice(0, 40),
              payeeBank: String(paid.payeeBank ?? v.payeeBank ?? '').trim().slice(0, 200),
              payeeBranch: String(paid.payeeBranch ?? v.payeeBranch ?? '').trim().slice(0, 200),
            }
          : {}),
      }
    : { paidAt: '', paidBy: '', paidByName: '', paidNote: '' };
  b.update(C.vouchers, v.id, patch, v, paid ? `Đã chi tiền ${describe(v)} — ${patch.payMethod === 'BANK' ? 'chuyển khoản' : 'tiền mặt'}` : `Bỏ đánh dấu đã chi ${describe(v)}`);
  await b.commit();
}

/** Xóa chứng từ chưa cấp số (kèm ảnh đính kèm) */
export async function deleteVoucher({ actor, v }) {
  const b = new AuditedBatch(actor);
  b.remove(C.vouchers, v.id, v, `Xóa ${describe(v)}`);
  for (const a of v.attachments || []) b.batch.delete(doc(db, C.voucherFiles, a.id));
  await b.commit();
}

/**
 * KẾT XUẤT & KẾT CHUYỂN (một giao dịch nguyên tử)
 *   1. Đọc lại từng chứng từ: phải đang "Đã duyệt" (chống kết chuyển trùng khi 2 người bấm cùng lúc)
 *   2. Cấp số đợt KC-YYYYMMDD-NN, số phiếu thu/chi sinh tự động
 *   3. Ghi sổ quỹ (mã bút toán cố định), cập nhật quyết toán tạm ứng, khóa chứng từ (Đã kết chuyển)
 */
/**
 * Kết chuyển một đợt.
 * payBank: tài khoản ngân hàng của công ty dùng cho các khoản chuyển khoản { id, name, accountNo, accountName }
 */
export async function postVouchers({ actor, ids, postDate, payBank = null, canReadBanks = true }) {
  if (!ids.length) throw new Error('Chưa chọn chứng từ nào');
  if (ids.length > 80) throw new Error('Mỗi đợt chốt sổ tối đa 80 chứng từ. Chia thành nhiều đợt.');
  const batchId = newId(C.batches);
  return runAuditedTx(actor, { summary: '', primaryPath: `${C.batches}/${batchId}` }, async (tx, audit) => {
    const snaps = await Promise.all(ids.map((id) => tx.get(doc(db, C.vouchers, id))));
    const vouchers = snaps.map((s) => {
      if (!s.exists()) throw new Error('Có chứng từ không còn tồn tại. Tải lại trang.');
      return { id: s.id, ...s.data() };
    });
    const notReady = vouchers.filter((v) => v.status !== 'APPROVED' || v.auto);
    if (notReady.length)
      throw new Error(`Không chốt sổ được: ${notReady.map((v) => v.no || v.person).join(', ')} không còn ở trạng thái "Đã duyệt" (có thể vừa được người khác chốt sổ). Tải lại danh sách.`);
    const advIds = [...new Set(vouchers.filter((v) => v.type === 'TT' && v.advanceId && settlement(v).B > 0).map((v) => v.advanceId))];
    const advSnaps = await Promise.all(advIds.map((id) => tx.get(doc(db, C.vouchers, id))));
    const advances = {};
    advSnaps.forEach((s) => {
      if (s.exists()) advances[s.id] = { id: s.id, ...s.data() };
    });
    const keys = countersNeeded(vouchers, postDate);
    const cs = await Promise.all(keys.map((k) => tx.get(doc(db, C.counters, k))));
    const counters = Object.fromEntries(keys.map((k, i) => [k, cs[i].exists() ? cs[i].data().value || 0 : 0]));

    const plan = buildPostingPlan({ vouchers, advances, counters, postDate, newId: () => newId(C.vouchers), batchId, actorEmail: actor.email });
    const byId = Object.fromEntries(vouchers.map((v) => [v.id, v]));
    // Khoản chuyển khoản: cập nhật số dư tiền gửi của tài khoản ngân hàng được chọn (đọc trước khi ghi)
    let bankBefore = null;
    let bankAfter = null;
    let bankDelta = 0;
    if ((plan.batch.bankTotal || plan.batch.bankInTotal) && !canReadBanks) {
      // Kế toán không xem số dư tiền gửi: cộng / trừ thẳng (luật bảo mật chặn nếu số dư âm)
      if (!payBank?.id) throw new Error('Đợt này có khoản chuyển khoản: chọn tài khoản ngân hàng của công ty để chi / nhận tiền.');
      bankDelta = plan.batch.bankInTotal - plan.batch.bankTotal;
    } else if (plan.batch.bankTotal || plan.batch.bankInTotal) {
      if (!payBank?.id) throw new Error('Đợt này có khoản chuyển khoản: chọn tài khoản ngân hàng của công ty để chi / nhận tiền.');
      const bsnap = await tx.get(doc(db, C.banks, payBank.id));
      if (!bsnap.exists()) throw new Error('Không tìm thấy tài khoản ngân hàng đã chọn');
      bankBefore = { id: bsnap.id, ...bsnap.data() };
      bankAfter = Math.round(Number(bankBefore.depositBalance) || 0) + plan.batch.bankInTotal - plan.batch.bankTotal;
      if (bankAfter < 0)
        throw new Error(`Số dư tiền gửi ${bankBefore.name} trên app (${fmtVND(bankBefore.depositBalance || 0)}) không đủ chi chuyển khoản ${fmtVND(plan.batch.bankTotal - plan.batch.bankInTotal)}. Cập nhật số dư theo sao kê hoặc chọn tài khoản khác.`);
    }

    const bankInfo = bankBefore
      ? { payBank: { id: bankBefore.id, name: bankBefore.name || '', accountNo: bankBefore.accountNo || '', accountName: bankBefore.accountName || '' }, bankBalanceBefore: Math.round(Number(bankBefore.depositBalance) || 0), bankBalanceAfter: bankAfter }
      : bankDelta
        ? { payBank: { id: payBank.id, name: payBank.name || '', accountNo: payBank.accountNo || '', accountName: payBank.accountName || '' } }
        : {};
    audit.create(C.batches, { ...plan.batch, ...bankInfo, posterName: actor.name || actor.email }, { id: batchId });
    for (const g of plan.generated) {
      const src = byId[g.data.sourceId];
      audit.create(
        C.vouchers,
        {
          ...g.data,
          requestedBy: src?.requestedBy || actor.email,
          items: [],
          advanceId: '',
          advanceNo: '',
          advanceAmount: 0,
          expenseAccount: '',
          dueDate: '',
          attachments: [],
          approvedByName: src?.approvedByName || '',
          approvedOn: src?.approvedOn || '',
          rejectReason: '',
          settledAmount: 0,
          cashEntryIds: [],
          generatedIds: [],
        },
        { id: g.id },
      );
    }
    for (const u of plan.voucherUpdates) audit.update(C.vouchers, u.id, u.patch, u.before);
    for (const c of plan.cashEntries) audit.create(C.cash, c.data, { id: c.id });
    for (const [id, a] of Object.entries(plan.advanceUpdates)) audit.update(C.vouchers, id, { settledAmount: a.settledAmount }, a.before);
    if (bankBefore) audit.update(C.banks, bankBefore.id, { depositBalance: bankAfter }, bankBefore);
    // lastBatchId: luật bảo mật đối chiếu số cộng / trừ với đợt chốt sổ tạo trong cùng giao dịch
    if (bankDelta) audit.adjust(C.banks, payBank.id, 'depositBalance', bankDelta, { lastBatchId: batchId });
    for (const k of keys) {
      if (plan.counters[k] !== counters[k]) tx.set(doc(db, C.counters, k), { value: plan.counters[k], updatedBy: actor.email, updatedAt: serverTimestamp() });
    }
    audit.summary = `Chốt sổ ${plan.batchCode}: ${vouchers.length} chứng từ — thu ${fmtVND(plan.batch.receiptsTotal)}, chi ${fmtVND(plan.batch.paymentsTotal)}${plan.batch.bankCount ? `, chuyển khoản ${fmtVND(plan.batch.bankTotal)}` : ''}`;
    audit.logData = { code: plan.batchCode, voucherNos: plan.batch.docNos, receiptsTotal: plan.batch.receiptsTotal, paymentsTotal: plan.batch.paymentsTotal, net: plan.batch.net };
    return { batchId, batch: { id: batchId, ...plan.batch, ...bankInfo, posterName: actor.name || actor.email }, docs: plan.docs };
  });
}

/** HỦY KẾT CHUYỂN / ĐẢO BÚT TOÁN một chứng từ — chỉ Chủ doanh nghiệp */
export async function reverseVoucher({ actor, id, reason }) {
  const date = todayISO();
  return runAuditedTx(actor, { summary: '', primaryPath: `${C.vouchers}/${id}` }, async (tx, audit) => {
    const vs = await tx.get(doc(db, C.vouchers, id));
    if (!vs.exists()) throw new Error('Chứng từ không còn tồn tại');
    const v = { id: vs.id, ...vs.data() };
    const gens = (await Promise.all((v.generatedIds || []).map((g) => tx.get(doc(db, C.vouchers, g))))).filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }));
    const cash = (await Promise.all((v.cashEntryIds || []).map((c) => tx.get(doc(db, C.cash, c))))).filter((s) => s.exists()).map((s) => ({ id: s.id, ...s.data() }));
    const s = settlement(v);
    let advance = null;
    if (v.type === 'TT' && v.advanceId && s.B > 0) {
      const as = await tx.get(doc(db, C.vouchers, v.advanceId));
      if (as.exists()) advance = { id: as.id, ...as.data() };
    }
    const bs = v.postingBatchId ? await tx.get(doc(db, C.batches, v.postingBatchId)) : null;
    // Chứng từ chuyển khoản: trả lại số dư tiền gửi của tài khoản đã dùng trong đợt
    const flow = bankFlow(v);
    const payBankId = bs?.exists() ? bs.data().payBank?.id : '';
    let bankDoc = null;
    if ((flow.in || flow.out) && payBankId) {
      const bk = await tx.get(doc(db, C.banks, payBankId));
      if (bk.exists()) bankDoc = { id: bk.id, ...bk.data() };
    }
    const plan = buildReversalPlan({ v, gens, cash, advance, reverseDate: date, reason, batchId: v.postingBatchId });

    for (const r of plan.reversals) audit.create(C.cash, r.data, { id: r.id });
    for (const g of plan.cancelGenerated) audit.update(C.vouchers, g.id, { status: 'CANCELLED', cancelledOn: date, cancelReason: String(reason || '').slice(0, 500) }, g.before);
    if (plan.advanceUpdate) audit.update(C.vouchers, plan.advanceUpdate.id, { settledAmount: plan.advanceUpdate.settledAmount }, plan.advanceUpdate.before);
    audit.update(C.vouchers, v.id, plan.voucherPatch, v);
    if (bankDoc) {
      const restored = Math.max(0, Math.round(Number(bankDoc.depositBalance) || 0) + flow.out - flow.in);
      audit.update(C.banks, bankDoc.id, { depositBalance: restored }, bankDoc);
    }
    if (bs?.exists()) {
      const b = { id: bs.id, ...bs.data() };
      const reversedIds = [...new Set([...(b.reversedIds || []), v.id])];
      audit.update(C.batches, b.id, { reversedIds, reversedCount: reversedIds.length, status: reversedIds.length >= (b.voucherIds || []).length ? 'REVERSED' : 'PARTIAL' }, b);
    }
    audit.summary = `Hủy chốt sổ ${describe(v)} — đảo ${plan.reversals.length} bút toán sổ quỹ${reason ? `: ${reason}` : ''}`;
    audit.logData = { voucherNo: v.no, reason, reversals: plan.reversals.map((r) => r.id) };
    return plan;
  });
}

/* ---------------- Ảnh / file đính kèm ---------------- */
const MAX_FILE_CHARS = 950000;

function readAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error(`Không đọc được file ${file.name}`));
    r.readAsDataURL(file);
  });
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Không mở được ảnh (định dạng không hỗ trợ)'));
    img.src = src;
  });
}

/** Nén ảnh: cạnh dài tối đa 1600px, JPEG; giảm dần đến khi vừa giới hạn lưu trữ */
export async function compressImage(file) {
  const src = await readAsDataUrl(file);
  const img = await loadImage(src);
  for (const [maxSide, q] of [
    [1600, 0.72],
    [1400, 0.62],
    [1100, 0.55],
    [900, 0.5],
  ]) {
    const scale = Math.min(1, maxSide / Math.max(img.naturalWidth, img.naturalHeight));
    const w = Math.max(1, Math.round(img.naturalWidth * scale));
    const h = Math.max(1, Math.round(img.naturalHeight * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);
    const out = canvas.toDataURL('image/jpeg', q);
    if (out.length < MAX_FILE_CHARS) return { dataUrl: out, type: 'image/jpeg', size: Math.round((out.length * 3) / 4) };
  }
  throw new Error(`Ảnh ${file.name} quá lớn, không nén được. Chụp lại với độ phân giải thấp hơn.`);
}

/** Tải một file lên (ảnh được nén; PDF tối đa ~700KB). Trả về thông tin đính kèm */
export async function uploadAttachment({ actor, voucherId, requestedBy, file }) {
  let payload;
  if (String(file.type).startsWith('image/')) payload = await compressImage(file);
  else if (file.type === 'application/pdf') {
    const dataUrl = await readAsDataUrl(file);
    if (dataUrl.length >= MAX_FILE_CHARS) throw new Error(`File ${file.name} lớn hơn 700KB. Hãy chụp ảnh chứng từ thay vì đính kèm PDF.`);
    payload = { dataUrl, type: 'application/pdf', size: file.size };
  } else throw new Error(`${file.name}: chỉ hỗ trợ ảnh (JPG, PNG, HEIC…) hoặc PDF`);
  const id = newId(C.voucherFiles);
  const name = String(file.name || 'chung-tu').slice(0, 200);
  await setDoc(doc(db, C.voucherFiles, id), {
    voucherId,
    requestedBy,
    name,
    type: payload.type,
    size: payload.size,
    dataUrl: payload.dataUrl,
    createdBy: actor.email,
    createdAt: serverTimestamp(),
  });
  return { id, name, type: payload.type, size: payload.size };
}

export async function removeAttachment(id) {
  await deleteDoc(doc(db, C.voucherFiles, id));
}

/** Đọc nội dung file đính kèm theo danh sách id */
export async function loadAttachments(list) {
  const out = [];
  for (const a of list || []) {
    try {
      const s = await getDoc(doc(db, C.voucherFiles, a.id));
      if (s.exists()) out.push({ id: s.id, ...s.data() });
    } catch {
      /* không có quyền / đã xóa: bỏ qua */
    }
  }
  return out;
}

/** Các bút toán sổ quỹ của một đợt (để đối chiếu) */
export async function loadBatchCash(batchId) {
  const s = await getDocs(query(collection(db, C.cash), where('postingBatchId', '==', batchId)));
  return s.docs.map((d) => ({ id: d.id, ...d.data() }));
}
