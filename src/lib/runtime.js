/**
 * Tiện ích nền tảng cho bản chạy độc lập (Firebase):
 *  - saveFile: tải file về máy (Excel, PDF, HTML)
 *  - resolveNames: tên hiển thị theo email từ danh sách thành viên
 */
import { collection, getDocs } from 'firebase/firestore';
import { db } from './firebase.js';

let namesCache = null;
let namesAt = 0;

/** { email: tên } của toàn bộ thành viên (đệm 60 giây) */
export async function memberNames() {
  if (namesCache && Date.now() - namesAt < 60000) return namesCache;
  try {
    const s = await getDocs(collection(db, 'members'));
    namesCache = Object.fromEntries(s.docs.map((d) => [d.id, d.data()?.displayName || '']));
    namesAt = Date.now();
  } catch {
    namesCache = namesCache || {};
  }
  return namesCache;
}

const shortEmail = (e) => (typeof e === 'string' && e.includes('@') ? e.split('@')[0] : e || '');

/** Tên hiển thị của danh sách email: { email: tên } */
export async function resolveNames(ids) {
  const uniq = [...new Set((ids || []).filter(Boolean))];
  if (!uniq.length) return {};
  const all = await memberNames();
  return Object.fromEntries(uniq.map((id) => [id, all[id] || shortEmail(id)]));
}

/** Tải file về máy. data: string | Uint8Array | Blob */
export async function saveFile(filename, data) {
  const type = filename.endsWith('.xlsx')
    ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    : filename.endsWith('.pdf')
      ? 'application/pdf'
      : filename.endsWith('.json')
        ? 'application/json'
        : 'text/html;charset=utf-8';
  const blob = data instanceof Blob ? data : new Blob([data], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  return { ok: true };
}
