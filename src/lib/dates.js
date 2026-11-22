// Tiện ích ngày tháng — mọi ngày được lưu dạng chuỗi 'YYYY-MM-DD' (giờ địa phương)
const pad = (n) => String(n).padStart(2, '0');

export function todayISO(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function currentMonth(d = new Date()) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}`;
}

export function isValidISO(iso) {
  return typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(iso);
}

function toUTC(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

/** Số ngày từ `fromISO` đến `toISO` (dương nếu toISO ở sau) */
export function daysBetween(fromISO, toISO) {
  return Math.round((toUTC(toISO) - toUTC(fromISO)) / 86400000);
}

export function addDays(iso, n) {
  const t = new Date(toUTC(iso) + n * 86400000);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

/** Khoảng ngày của một tháng 'YYYY-MM' */
export function monthRange(ym) {
  const [y, m] = ym.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${ym}-01`, end: `${ym}-${pad(last)}`, days: last };
}

export function shiftMonth(ym, delta) {
  const [y, m] = ym.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}`;
}

export function monthLabel(ym) {
  if (!ym) return '';
  const [y, m] = ym.split('-');
  return `Tháng ${Number(m)}/${y}`;
}

export function fmtDate(iso) {
  if (!iso) return '—';
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

/** Hiển thị Timestamp của Firestore (hoặc Date) dạng 'dd/mm/yyyy HH:MM' */
export function fmtDateTime(ts) {
  if (!ts) return '—';
  let d;
  if (typeof ts.toDate === 'function') d = ts.toDate();
  else if (ts instanceof Date) d = ts;
  else if (typeof ts.seconds === 'number') d = new Date(ts.seconds * 1000);
  else d = new Date(ts);
  if (Number.isNaN(d.getTime())) return '—';
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** Diễn giải số ngày còn lại */
export function describeDays(days) {
  if (days == null) return '';
  if (days === 0) return 'Hôm nay';
  if (days > 0) return `Còn ${days} ngày`;
  return `Quá ${-days} ngày`;
}
