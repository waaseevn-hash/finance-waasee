/**
 * Người giữ tiền mặt của công ty (quỹ phụ).
 * Tài liệu settings/cashHolders: { list: [{ id, name, active }] } — chỉ Chủ DN / Đồng quản trị đọc, sửa.
 * "Két công ty" (id MAIN) luôn có; phiếu không ghi holderId được tính vào két.
 */
import { useEffect, useMemo, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from './firebase.js';
import { AuditedBatch, C } from './db.js';
import { MAIN_HOLDER } from './calc.js';

export const MAIN_DEFAULT = { id: MAIN_HOLDER, name: 'Két công ty', active: true };

function normalize(raw) {
  const list = Array.isArray(raw?.list) ? raw.list.filter((h) => h && typeof h.id === 'string' && h.id) : [];
  const main = list.find((h) => h.id === MAIN_HOLDER);
  const others = list.filter((h) => h.id !== MAIN_HOLDER).map((h) => ({ id: h.id, name: String(h.name || '').trim() || 'Người giữ tiền', active: h.active !== false }));
  return [{ ...MAIN_DEFAULT, name: String(main?.name || '').trim() || MAIN_DEFAULT.name, active: true }, ...others];
}

let state = { list: [MAIN_DEFAULT], raw: null, loaded: false };
const listeners = new Set();
let unsub = null;

function ensureListener() {
  if (unsub || !db) return;
  unsub = onSnapshot(
    doc(db, C.settings, 'cashHolders'),
    (s) => {
      const raw = s.exists() ? s.data() : null;
      state = { list: normalize(raw), raw, loaded: true };
      listeners.forEach((fn) => fn(state));
    },
    () => {
      unsub = null;
      state = { ...state, loaded: true };
      listeners.forEach((fn) => fn(state));
    },
  );
}

/**
 * @returns {{ all: Array, active: Array, name: (id) => string, loaded: boolean, raw: object|null }}
 *   all: kể cả người đã ngừng giữ (để hiện tên trên phiếu cũ); active: người đang giữ
 */
export function useCashHolders(enabled = true) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!enabled) return undefined;
    ensureListener();
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    fn();
    return () => {
      listeners.delete(fn);
    };
  }, [enabled]);
  // Đọc thẳng trạng thái chung (luôn mới nhất), tránh giá trị cũ lúc modal vừa mở
  const snap = state;
  return useMemo(() => holderView(snap), [snap]);
}

export function holderView(s) {
  const all = s.list;
  const map = new Map(all.map((h) => [h.id, h]));
  return {
    all,
    active: all.filter((h) => h.active),
    loaded: s.loaded,
    raw: s.raw,
    name: (id) => map.get(id || MAIN_HOLDER)?.name || 'Người giữ đã xóa',
  };
}

export const newHolderId = () => `H${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

/** Lưu danh sách người giữ (ghi nhật ký) */
export async function saveHolders(actor, list, raw, summary) {
  const clean = list.map((h) => ({ id: h.id, name: String(h.name || '').trim().slice(0, 120), active: h.id === MAIN_HOLDER ? true : h.active !== false }));
  const b = new AuditedBatch(actor);
  if (raw) b.update(C.settings, 'cashHolders', { list: clean }, { list: raw.list || [] }, summary);
  else b.create(C.settings, { list: clean }, summary, { id: 'cashHolders' });
  await b.commit();
}
