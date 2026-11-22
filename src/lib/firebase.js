import { initializeApp } from 'firebase/app';
import { GoogleAuthProvider, browserLocalPersistence, getAuth, setPersistence } from 'firebase/auth';
import { initializeFirestore } from 'firebase/firestore';
import { firebaseConfig } from '../firebase-config.js';

/** Đã dán cấu hình Firebase thật hay chưa */
export const isConfigured =
  typeof firebaseConfig.apiKey === 'string' && firebaseConfig.apiKey.length > 20 && !firebaseConfig.apiKey.startsWith('DAN_');

export const app = isConfigured ? initializeApp(firebaseConfig) : null;
export const auth = app ? getAuth(app) : null;
if (auth) setPersistence(auth, browserLocalPersistence).catch(() => {});

// Bộ nhớ đệm trong RAM (mặc định): không lưu số liệu tài chính xuống ổ đĩa của máy dùng chung.
export const db = app ? initializeFirestore(app, { ignoreUndefinedProperties: true }) : null;

export const googleProvider = new GoogleAuthProvider();
// Xin rõ quyền đọc địa chỉ Gmail: danh sách trắng và luật bảo mật đều dựa trên email
googleProvider.addScope('email');
googleProvider.addScope('profile');
googleProvider.setCustomParameters({ prompt: 'select_account' });
