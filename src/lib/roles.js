// Phân quyền phía giao diện. Quyền THẬT được thực thi ở firestore.rules —
// file này chỉ để ẩn/hiện chức năng cho đúng vai trò.
export const ROLES = { OWNER: 'OWNER', CO_OWNER: 'CO_OWNER', STAFF: 'STAFF' };

export const ROLE_LABEL = {
  OWNER: 'Chủ doanh nghiệp',
  CO_OWNER: 'Đồng quản trị',
  STAFF: 'Kế toán công nợ',
};

const MANAGERS = [ROLES.OWNER, ROLES.CO_OWNER];
const ALL = [ROLES.OWNER, ROLES.CO_OWNER, ROLES.STAFF];

const PERMS = {
  viewTreasury: MANAGERS, // Tiền mặt két, Vay ngân hàng, Bảng điều phối
  viewPartners: ALL, // Công nợ phải thu / phải trả
  editPartners: ALL,
  deletePartners: MANAGERS, // Xóa nhà cung cấp trong danh bạ
  deleteDebts: ALL, // Xóa khoản công nợ phải thu / phải trả (kèm lịch sử thanh toán) — cả Kế toán
  deletePayments: MANAGERS,
  linkCashbook: MANAGERS,
  approvePayments: MANAGERS, // Duyệt chi công nợ phải trả
  manageMembers: MANAGERS, // Thêm / đổi vai trò / khóa / xóa thành viên (không đụng được tài khoản Chủ DN)
  viewAudit: MANAGERS, // Xem nhật ký thao tác
  deleteSnapshots: [ROLES.OWNER],
  viewVouchers: ALL, // Lập chứng từ thu chi nội bộ (STAFF chỉ thấy chứng từ của mình)
  approveVouchers: MANAGERS, // Duyệt / từ chối chứng từ
  postVouchers: MANAGERS, // Kết xuất in phiếu & kết chuyển sổ quỹ
  reverseVouchers: [ROLES.OWNER], // Hủy kết chuyển / đảo bút toán
};

export function can(role, perm) {
  return !!role && (PERMS[perm] || []).includes(role);
}

/** Các màn hình và quyền cần có */
export const ROUTES = [
  { key: 'dashboard', label: 'Tổng quan', short: 'Tổng quan', perm: 'viewPartners' },
  { key: 'cash', label: 'Tiền mặt trong két', short: 'Két', perm: 'viewTreasury' },
  { key: 'bank', label: 'Vay & Hạn mức NH', short: 'Ngân hàng', perm: 'viewTreasury' },
  { key: 'partners', label: 'Công nợ đối tác', short: 'Công nợ', perm: 'viewPartners' },
  { key: 'vouchers', label: 'Chứng từ thu chi', short: 'Chứng từ', perm: 'viewVouchers' },
  { key: 'planner', label: 'Điều phối tháng', short: 'Điều phối', perm: 'viewTreasury' },
  { key: 'admin', label: 'Phân quyền & Nhật ký', short: 'Quản trị', perm: 'manageMembers' },
];
