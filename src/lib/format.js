// Định dạng & đọc số tiền VNĐ
const nf0 = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

export function fmtNum(n) {
  return nf0.format(Math.round(Number(n) || 0));
}

export function fmtVND(n) {
  return `${fmtNum(n)} ₫`;
}

/** 1.250.000.000 -> "1,25 tỷ" (dùng cho gợi ý đọc nhanh) */
export function fmtCompact(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  const s = v < 0 ? '-' : '';
  const f = (x) =>
    new Intl.NumberFormat('vi-VN', { maximumFractionDigits: x >= 100 ? 0 : x >= 10 ? 1 : 2 }).format(x);
  if (a >= 1e9) return `${s}${f(a / 1e9)} tỷ`;
  if (a >= 1e6) return `${s}${f(a / 1e6)} triệu`;
  if (a >= 1e3) return `${s}${f(a / 1e3)} nghìn`;
  return `${s}${fmtNum(a)}`;
}

export function fmtPct(x, digits = 1) {
  return `${new Intl.NumberFormat('vi-VN', { maximumFractionDigits: digits }).format(Number(x) || 0)}%`;
}

const UNITS = {
  k: 1e3, n: 1e3, 'nghìn': 1e3, 'ngàn': 1e3,
  tr: 1e6, m: 1e6, 'triệu': 1e6, trieu: 1e6,
  'tỷ': 1e9, ty: 1e9, 'tỉ': 1e9, ti: 1e9, b: 1e9,
};

/**
 * Đọc chuỗi người dùng nhập thành số nguyên VNĐ.
 *  "1.250.000"  -> 1250000
 *  "150tr"      -> 150000000
 *  "1,5 tỷ"     -> 1500000000
 *  "500k"       -> 500000
 * Trả về null nếu không đọc được.
 */
export function parseMoney(input) {
  if (typeof input === 'number') return Number.isFinite(input) ? Math.round(input) : null;
  if (input == null) return null;
  const s = String(input).normalize('NFC').trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return null;
  const m = s.match(/^([\d.,]+)(k|n|nghìn|ngàn|tr|m|triệu|trieu|tỷ|ty|tỉ|ti|b)?$/u);
  if (!m) return null;
  const [, num, unit] = m;
  const mult = unit ? UNITS[unit] : 1;
  let value;
  if (mult === 1) {
    const digits = num.replace(/\D/g, '');
    if (!digits) return null;
    value = Number(digits);
  } else {
    const seps = (num.match(/[.,]/g) || []).length;
    let n = num;
    if (seps === 1) n = num.replace(',', '.');
    else if (seps > 1) n = num.replace(/\./g, '').replace(',', '.');
    value = parseFloat(n) * mult;
  }
  if (!Number.isFinite(value)) return null;
  return Math.round(value);
}

export function normalizeText(s) {
  return String(s || '')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/g, 'd')
    .replace(/Đ/g, 'D')
    .toLowerCase();
}

/** Tìm kiếm không dấu */
export function matchSearch(text, query) {
  if (!query) return true;
  return normalizeText(text).includes(normalizeText(query));
}

export function isEmail(s) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(s || '').trim());
}
