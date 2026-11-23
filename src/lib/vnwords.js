/**
 * Đọc số tiền VNĐ thành chữ tiếng Việt theo cách viết trên chứng từ kế toán.
 *   1.250.000          -> "Một triệu hai trăm năm mươi nghìn đồng"
 *   1.005.000          -> "Một triệu không trăm linh năm nghìn đồng"
 *   21.000             -> "Hai mươi mốt nghìn đồng"
 *   115.000            -> "Một trăm mười lăm nghìn đồng"
 *   1.000.000.000      -> "Một tỷ đồng"
 *   2.000.000.000.000  -> "Hai nghìn tỷ đồng"
 * Quy ước: "linh" khi hàng chục bằng 0 (một trăm linh năm), "mốt" sau hàng chục từ 20,
 * "lăm" cho chữ số 5 đứng sau hàng chục, "mười" cho 10–19, "không trăm" khi một nhóm 3 chữ số
 * đứng sau nhóm lớn hơn mà hàng trăm bằng 0.
 */
const DIGITS = ['không', 'một', 'hai', 'ba', 'bốn', 'năm', 'sáu', 'bảy', 'tám', 'chín'];

/** Đọc một nhóm 3 chữ số (1–999). full = nhóm đứng sau nhóm lớn hơn -> luôn đọc hàng trăm */
function readTriple(n, full) {
  const tram = Math.floor(n / 100);
  const chuc = Math.floor((n % 100) / 10);
  const dv = n % 10;
  const out = [];
  const hasHundreds = tram > 0 || full;
  if (hasHundreds) out.push(DIGITS[tram], 'trăm');
  if (chuc === 0) {
    if (dv > 0) out.push(...(hasHundreds ? ['linh', DIGITS[dv]] : [DIGITS[dv]]));
  } else if (chuc === 1) {
    out.push('mười');
    if (dv === 5) out.push('lăm');
    else if (dv > 0) out.push(DIGITS[dv]);
  } else {
    out.push(DIGITS[chuc], 'mươi');
    if (dv === 1) out.push('mốt');
    else if (dv === 5) out.push('lăm');
    else if (dv > 0) out.push(DIGITS[dv]);
  }
  return out.join(' ');
}

/** Đọc phần nhỏ hơn 1 tỷ (triệu – nghìn – đơn vị) */
function readBelowBillion(n, hasHigher) {
  const groups = [
    [Math.floor(n / 1e6), 'triệu'],
    [Math.floor((n % 1e6) / 1e3), 'nghìn'],
    [n % 1e3, ''],
  ];
  const parts = [];
  let started = hasHigher;
  for (const [g, unit] of groups) {
    if (g === 0) continue;
    parts.push(unit ? `${readTriple(g, started)} ${unit}` : readTriple(g, started));
    started = true;
  }
  return parts.join(' ');
}

/** Đọc số nguyên không âm thành chữ (chữ thường, chưa có "đồng") */
export function readNumberVi(value) {
  const n = Math.floor(Math.abs(Number(value) || 0));
  if (n === 0) return 'không';
  const high = Math.floor(n / 1e9);
  const low = n % 1e9;
  if (high === 0) return readBelowBillion(low, false);
  const head = `${readNumberVi(high)} tỷ`;
  return low > 0 ? `${head} ${readBelowBillion(low, true)}` : head;
}

/** "Một triệu hai trăm năm mươi nghìn đồng" (viết hoa chữ đầu) */
export function moneyToWords(value) {
  const n = Math.round(Number(value) || 0);
  const words = `${n < 0 ? 'âm ' : ''}${readNumberVi(n)} đồng`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
