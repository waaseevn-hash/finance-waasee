/**
 * Sao lưu toàn bộ dữ liệu ra một file .json (chỉ Chủ doanh nghiệp).
 * Định dạng "dong-tien-backup" — cùng định dạng mà mục "Chuyển dữ liệu" đọc được để nhập lại
 * (tiền mặt, ngân hàng, khoản vay, công nợ, thanh toán, lệnh chi, danh bạ, kế hoạch, cài đặt, nhật ký).
 * File chứa thêm chứng từ nội bộ, ảnh chứng từ, đợt kết chuyển, bộ đếm số phiếu, thành viên để lưu trữ đầy đủ.
 */
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase.js';
import { saveFile } from './runtime.js';

export const BACKUP_COLLECTIONS = [
  'members',
  'cash_entries',
  'banks',
  'loans',
  'receivables',
  'payables',
  'payments',
  'partners',
  'approvals',
  'plans',
  'plan_snapshots',
  'settings',
  'internal_vouchers',
  'voucher_files',
  'posting_batches',
  'counters',
  'audit_archive',
];

/** Đổi Timestamp của Firestore thành số mili-giây để ghi JSON */
function plain(v) {
  if (v === null || v === undefined) return v;
  if (typeof v?.toMillis === 'function') return v.toMillis();
  if (Array.isArray(v)) return v.map(plain);
  if (typeof v === 'object') {
    const o = {};
    for (const [k, x] of Object.entries(v)) o[k] = plain(x);
    return o;
  }
  return v;
}

export async function exportBackup(onProgress) {
  const out = { format: 'dong-tien-backup', version: 2, source: 'firebase', exportedAt: Date.now(), collections: {}, settings: {}, audit: [], people: {} };
  const counts = {};
  const names = [...BACKUP_COLLECTIONS, 'audit_logs'];
  for (const [i, c] of names.entries()) {
    onProgress?.({ done: i, total: names.length, current: c });
    const snap = await getDocs(collection(db, c));
    const rows = snap.docs.map((d) => ({ id: d.id, ...plain(d.data()) }));
    counts[c] = rows.length;
    if (c === 'audit_logs') out.audit = rows;
    else out.collections[c] = rows;
  }
  for (const m of out.collections.members || []) out.people[m.email || m.id] = m.displayName || m.email || m.id;
  const settings = Object.fromEntries((out.collections.settings || []).map((s) => [s.id, s]));
  if (settings.company?.companyName) out.settings.companyName = settings.company.companyName;
  if (settings.company) out.settings.company = settings.company;
  if (settings.planner) out.settings.planner = settings.planner;
  out.counts = counts;
  const stamp = new Date(out.exportedAt + 7 * 3600 * 1000).toISOString().slice(0, 16).replace('T', '_').replace(':', 'h');
  const text = JSON.stringify(out);
  await saveFile(`dong-tien-backup_${stamp}.json`, new TextEncoder().encode(text));
  onProgress?.({ done: names.length, total: names.length, current: '' });
  return { counts, bytes: text.length };
}
