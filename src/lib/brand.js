import { useEffect, useState } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from './firebase.js';
import { APP_CONFIG } from '../firebase-config.js';

export const LOGO = './icons/icon.svg';

// Tên doanh nghiệp lưu trong settings/company (mọi thành viên đọc được, chỉ Chủ doanh nghiệp sửa)
let current = APP_CONFIG.companyName;
export const getCompanyName = () => current;

export function useCompanyName() {
  const [name, setName] = useState(current);
  useEffect(() => {
    if (!db) return undefined;
    return onSnapshot(
      doc(db, 'settings', 'company'),
      (s) => {
        const n = (s.exists() && s.data()?.companyName) || APP_CONFIG.companyName;
        current = n;
        setName(n);
      },
      () => {},
    );
  }, []);
  return name;
}

export function saveCompanyName(name) {
  return setDoc(doc(db, 'settings', 'company'), { companyName: name }, { merge: true });
}
