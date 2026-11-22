/**
 * Duyệt chi công nợ phải trả (lệnh chi).
 *   Chủ doanh nghiệp / Đồng quản trị bấm "Duyệt chi" trên một khoản phải trả → chọn Chi hết hoặc Chi 1 phần.
 *   Lệnh đã duyệt hiện ở tab "Lệnh chi đã duyệt" (kế toán chuyển khoản theo đó) và ở Bảng tổng hợp chi trả tháng.
 *   Kế toán chuyển tiền xong bấm "Đã chuyển tiền" → ghi nhận thanh toán, lệnh chuyển sang DONE.
 * Tài liệu approvals/<id>:
 *   { payableId, partnerName, description, supplierId, mode: 'FULL'|'PART', amount, outstandingAtApproval,
 *     note, approvedOn, status: 'OPEN'|'DONE'|'CANCELLED', paidAmount, paidOn, paymentId }
 */
import { approvalAmount, openApprovalsByPayable, remaining } from './calc.js';
import { findSupplier } from '../components/forms/supplierForms.jsx';

export const APPROVAL_KEYS = ['id', 'payableId', 'partnerName', 'description', 'supplierId', 'mode', 'amount', 'outstandingAtApproval', 'note', 'approvedOn', 'status', 'paidAmount', 'paidOn', 'paymentId', '_auditId'];
export const pickApproval = (a) => Object.fromEntries(APPROVAL_KEYS.filter((k) => a?.[k] !== undefined).map((k) => [k, a[k]]));

export const APPROVAL_MODE = { FULL: 'Chi hết', PART: 'Chi 1 phần' };

/** Lệnh chi đang chờ chuyển tiền, kèm công nợ, NCC và số tiền thực tế phải chuyển */
export function openPayOrders(approvals = [], ap = [], suppliers = []) {
  const byId = new Map(ap.map((r) => [r.id, r]));
  return approvals
    .filter((a) => a.status === 'OPEN')
    .map((a) => {
      const debt = byId.get(a.payableId) || null;
      const rem = debt ? remaining(debt) : 0;
      const supplier = findSupplier(suppliers, { supplierId: a.supplierId || debt?.supplierId, partnerName: a.partnerName || debt?.partnerName });
      return { ...a, debt, outstanding: rem, payAmount: approvalAmount(a, rem), supplier };
    })
    .filter((o) => o.debt && o.payAmount > 0)
    .sort((x, y) => (x.approvedOn || '').localeCompare(y.approvedOn || '') || (x.partnerName || '').localeCompare(y.partnerName || ''));
}

export { openApprovalsByPayable };
