import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase.js';
import { APP_CONFIG } from '../firebase-config.js';

export const LOGO = './icons/icon.svg';

/** Thông tin doanh nghiệp in trên chứng từ (settings/company — mọi thành viên đọc, chỉ Chủ DN sửa) */
export const COMPANY_DEFAULTS = {
  companyName: 'Công ty Cổ phần Thiết kế và Kinh doanh Thiết bị Waasee',
  address: 'Số 1, ngõ 66, đường Giáp Bát, phường Tương Mai, Hoàng Mai, Hà Nội',
  taxCode: '',
  regulation: 'Thông tư số 200/2014/TT-BTC ngày 22/12/2014 của Bộ Tài chính',
  director: '',
  chiefAccountant: '',
  cashier: '',
  bookNo: '01',
  addressee: 'Giám đốc Công ty',
};

let current = { ...COMPANY_DEFAULTS, companyName: APP_CONFIG.companyName === 'Công ty của tôi' ? COMPANY_DEFAULTS.companyName : APP_CONFIG.companyName };
const listeners = new Set();
let unsub = null;

function ensureListener() {
  if (unsub || !db) return;
  unsub = onSnapshot(
    doc(db, 'settings', 'company'),
    (s) => {
      const d = s.exists() ? s.data() || {} : {};
      const merged = { ...COMPANY_DEFAULTS };
      for (const k of Object.keys(COMPANY_DEFAULTS)) {
        if (typeof d[k] === 'string' && d[k].trim()) merged[k] = d[k];
      }
      // Tên mặc định cũ của bản thử nghiệm: coi như chưa khai báo
      if (merged.companyName.trim() === 'Công ty của tôi') merged.companyName = COMPANY_DEFAULTS.companyName;
      current = merged;
      listeners.forEach((fn) => fn(merged));
    },
    () => {
      unsub = null;
    },
  );
}

export const getCompanyName = () => current.companyName;
export const getCompany = () => current;

export function useCompany() {
  const [c, setC] = useState(current);
  useEffect(() => {
    ensureListener();
    listeners.add(setC);
    setC(current);
    return () => {
      listeners.delete(setC);
    };
  }, []);
  return c;
}

export function useCompanyName() {
  return useCompany().companyName;
}

export function saveCompanyName(name) {
  return setDoc(doc(db, 'settings', 'company'), { companyName: name }, { merge: true });
}

export function saveCompany(patch) {
  const clean = {};
  for (const k of Object.keys(COMPANY_DEFAULTS)) {
    if (patch[k] !== undefined) clean[k] = String(patch[k] || '').trim().slice(0, 300);
  }
  return setDoc(doc(db, 'settings', 'company'), clean, { merge: true });
}
