// Nhãn hiển thị dùng chung
export const PRIORITY = {
  P1: { label: 'P1 · Bắt buộc', short: 'P1', tone: 'red', hint: 'Lương, Thuế/BHXH, Đáo hạn NH, đối tác sống còn' },
  P2: { label: 'P2 · Quan trọng', short: 'P2', tone: 'orange', hint: 'Nhà cung cấp vật tư chính' },
  P3: { label: 'P3 · Có thể giãn', short: 'P3', tone: 'slate', hint: 'Có thể thương lượng trả sau' },
};

export const CERTAINTY = {
  SURE: { label: 'Chắc chắn về', tone: 'green' },
  MAYBE_LATE: { label: 'Có khả năng chậm', tone: 'amber' },
  DOUBTFUL: { label: 'Nợ khó đòi', tone: 'red' },
};

export const PAY_METHOD = {
  CASH: 'Tiền mặt',
  BANK: 'Chuyển khoản',
  OTHER: 'Khác (bù trừ…)',
};

/** Danh mục chi cố định hàng tháng cho Bảng điều phối */
export const FIXED_CATEGORIES = [
  { value: 'Lương', label: 'Lương nhân viên', priority: 'P1' },
  { value: 'Thuế/BHXH', label: 'Thuế / BHXH', priority: 'P1' },
  { value: 'Lãi vay NH', label: 'Lãi vay ngân hàng', priority: 'P1' },
  { value: 'Đáo hạn NH', label: 'Đáo hạn ngân hàng', priority: 'P1' },
  { value: 'Vận hành', label: 'Chi phí vận hành (điện, nước, thuê…)', priority: 'P2' },
  { value: 'Khác', label: 'Khoản chi khác', priority: 'P2' },
];
