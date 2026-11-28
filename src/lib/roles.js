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
  viewVouchers: ALL, // Lập đề xuất chi (STAFF thấy đề xuất của mình + mọi khoản đã duyệt để đi chi)
  approveVouchers: MANAGERS, // Duyệt / từ chối đề xuất
  payVouchers: ALL, // Kế toán báo "Đã chi tiền" cho khoản đã duyệt
  postVouchers: ALL, // Chốt sổ: ghi sổ quỹ / tiền gửi, cấp phiếu TT200 (kế toán thực hiện)
  reverseVouchers: [ROLES.OWNER], // Hủy chốt sổ / đảo bút toán
  viewWork: [ROLES.STAFF], // Màn hình Việc cần làm (hàng đợi tác vụ của kế toán)
  notifySettings: [ROLES.OWNER], // Cấu hình thông báo đẩy về điện thoại
  accountingView: [ROLES.STAFF], // Thấy mã tài khoản, Nợ/Có, quyển số, định khoản
};

export function can(role, perm) {
  return !!role && (PERMS[perm] || []).includes(role);
}

/** Các màn hình và quyền cần có. staffLabel / staffShort: tên hiển thị riêng cho Kế toán. */
export const ROUTES = [
  { key: 'work', label: 'Việc cần làm', short: 'Việc làm', perm: 'viewWork' },
  { key: 'dashboard', label: 'Tổng quan', short: 'Tổng quan', perm: 'viewPartners' },
  { key: 'cash', label: 'Tiền mặt và tiền gửi ngân hàng', short: 'Tiền', perm: 'viewTreasury' },
  { key: 'bank', label: 'Vay & Hạn mức NH', short: 'Ngân hàng', perm: 'viewTreasury' },
  { key: 'partners', label: 'Công nợ đối tác', short: 'Công nợ', perm: 'viewPartners' },
  { key: 'vouchers', label: 'Đề xuất & Duyệt chi', short: 'Duyệt chi', staffLabel: 'Đề xuất chi & Chứng từ', staffShort: 'Chứng từ', perm: 'viewVouchers' },
  { key: 'planner', label: 'Điều phối tháng', short: 'Điều phối', perm: 'viewTreasury' },
  { key: 'admin', label: 'Phân quyền & Cài đặt', short: 'Quản trị', perm: 'manageMembers' },
];

/** Tên màn hình theo vai trò */
export const routeLabel = (r, role) => (role === ROLES.STAFF && r.staffLabel ? r.staffLabel : r.label);
export const routeShort = (r, role) => (role === ROLES.STAFF && r.staffShort ? r.staffShort : r.short);
/** Màn hình mở đầu khi đăng nhập */
export const homeRoute = (role) => (role === ROLES.STAFF ? 'work' : 'dashboard');
