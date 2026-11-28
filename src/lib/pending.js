/**
 * Danh sách "chờ Sếp duyệt" và "Sếp đã duyệt — cần chi ngay" dùng chung cho chuông thông báo,
 * ngăn duyệt nhanh, Tổng quan, trang Tiền mặt và màn hình Việc cần làm của kế toán.
 * Hàm thuần (không gọi Firebase) để kiểm thử được.
 */
import { remaining } from './calc.js';
import { monthRange, currentMonth, daysBetween } from './dates.js';
import { flowEffect, isBank, requestedAmount, voucherAmount, bankEffect, cashEffect } from './vouchers.js';
import { approvalAmount } from './calc.js';

/** Khoản phải trả đang được Sếp cho hoãn (Từ chối ở ngăn duyệt nhanh) */
export const isHeld = (debt, today) => !!debt?.holdUntil && debt.holdUntil > today;

/**
 * Các khoản chờ Sếp duyệt:
 *  - Đề xuất chi nội bộ đang "Chờ duyệt"
 *  - Công nợ phải trả còn nợ, đến hạn trong tháng này (kể cả quá hạn), chưa có lệnh duyệt chi, không đang hoãn
 * @returns {Array<{key, kind:'V'|'AP', id, who, what, amount, out, inn, date, dueDate, overdue, priority, bank, v?, debt?}>}
 */
export function pendingApprovals({ vouchers = [], ap = [], approvals = [], today, scope = 'month' }) {
  const { end } = monthRange(today ? String(today).slice(0, 7) : currentMonth());
  const openPay = new Set(approvals.filter((a) => a.status === 'OPEN').map((a) => a.payableId));
  const v = vouchers
    .filter((x) => !x.auto && x.status === 'PENDING')
    .map((x) => {
      const e = flowEffect(x);
      return {
        key: `V:${x.id}`,
        kind: 'V',
        id: x.id,
        v: x,
        who: x.person || '—',
        what: x.reason || '',
        amount: requestedAmount(x),
        out: e.out,
        inn: e.in,
        bank: isBank(x),
        date: x.submittedOn || x.date || '',
        attachments: x.attachments || [],
      };
    });
  const d = ap
    .filter((r) => remaining(r) > 0 && !openPay.has(r.id) && !isHeld(r, today))
    .filter((r) => scope === 'all' || (r.dueDate && r.dueDate <= end))
    .map((r) => ({
      key: `AP:${r.id}`,
      kind: 'AP',
      id: r.id,
      debt: r,
      who: r.partnerName,
      what: r.description || 'Công nợ phải trả',
      amount: remaining(r),
      out: remaining(r),
      inn: 0,
      dueDate: r.dueDate || '',
      overdue: r.dueDate && r.dueDate < today ? daysBetween(r.dueDate, today) : 0,
      priority: r.priority || 'P2',
      date: r.dueDate || '',
    }));
  // Đề xuất nội bộ trước (theo ngày gửi), rồi công nợ: P1 trước, hạn sớm trước
  v.sort((a, b) => a.date.localeCompare(b.date));
  d.sort((a, b) => (a.priority === 'P1' ? 0 : 1) - (b.priority === 'P1' ? 0 : 1) || (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));
  return [...v, ...d];
}

/** Tiền đã cam kết nhưng chưa chi: đề xuất đã duyệt chưa chốt sổ + lệnh chi công nợ chưa chuyển */
export function committedOut({ vouchers = [], approvals = [], ap = [] }) {
  let out = 0;
  let inn = 0;
  for (const x of vouchers) {
    if (x.auto || x.status !== 'APPROVED') continue;
    const e = flowEffect(x);
    out += e.out;
    inn += e.in;
  }
  const byId = new Map(ap.map((r) => [r.id, r]));
  for (const a of approvals) {
    if (a.status !== 'OPEN') continue;
    const debt = byId.get(a.payableId);
    if (debt) out += approvalAmount(a, remaining(debt));
  }
  return { out, in: inn, net: inn - out };
}

/** Gắn "duyệt khoản này xong còn lại" — duyệt lần lượt từ trên xuống */
export function withRunning(items, startBalance) {
  let run = startBalance;
  return items.map((it) => {
    run += (it.inn || 0) - (it.out || 0);
    return { ...it, after: run };
  });
}

/**
 * Sếp đã duyệt — kế toán cần chi ngay:
 *  - Đề xuất nội bộ "Đã duyệt" chưa báo đã chi
 *  - Lệnh duyệt chi công nợ phải trả đang chờ chuyển tiền (orders = openPayOrders(...))
 */
export function toPayItems({ vouchers = [], orders = [] }) {
  const v = vouchers
    .filter((x) => !x.auto && x.status === 'APPROVED' && !x.paidAt)
    .map((x) => ({
      key: `V:${x.id}`,
      kind: 'V',
      id: x.id,
      v: x,
      who: x.person || '—',
      what: x.reason || '',
      amount: voucherAmount(x),
      requested: requestedAmount(x),
      out: cashEffect(x).out + bankEffect(x),
      inn: flowEffect(x).in,
      bank: isBank(x),
      payee: isBank(x) ? { name: x.payeeName || x.person, account: x.payeeAccount, bank: x.payeeBank, branch: x.payeeBranch } : null,
      date: x.approvedOn || '',
    }));
  const o = orders.map((a) => ({
    key: `AP:${a.id}`,
    kind: 'AP',
    id: a.id,
    order: a,
    who: a.partnerName,
    what: a.description || 'Công nợ phải trả',
    amount: a.payAmount,
    out: a.payAmount,
    inn: 0,
    bank: !!a.supplier?.bankAccount,
    payee: a.supplier?.bankAccount ? { name: a.supplier.accountHolder || a.supplier.name || a.partnerName, account: a.supplier.bankAccount, bank: a.supplier.bankName, branch: a.supplier.bankBranch } : null,
    date: a.approvedOn || '',
  }));
  return [...v, ...o].sort((a, b) => a.date.localeCompare(b.date));
}
