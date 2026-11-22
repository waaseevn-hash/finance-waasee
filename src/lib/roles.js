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
  deletePartners: MANAGERS,
  deletePayments: MANAGERS,
  linkCashbook: MANAGERS,
  approvePayments: MANAGERS, // Duyệt chi công nợ phải trả
  manageMembers: [ROLES.OWNER],
  viewAudit: [ROLES.OWNER],
  deleteSnapshots: [ROLES.OWNER],
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
  { key: 'planner', label: 'Điều phối tháng', short: 'Điều phối', perm: 'viewTreasury' },
  { key: 'admin', label: 'Phân quyền & Nhật ký', short: 'Quản trị', perm: 'manageMembers' },
];
