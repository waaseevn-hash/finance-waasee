/**
 * =====================================================================
 *  CẤU HÌNH FIREBASE
 * =====================================================================
 *  Firebase Console > Project settings > Your apps > Web app > Config.
 *  Các thông số này KHÔNG phải mật khẩu: dữ liệu được bảo vệ bởi
 *  Firestore Security Rules (firestore.rules) + danh sách trắng email.
 * =====================================================================
 */
export const firebaseConfig = {
  apiKey: 'DAN_API_KEY_VAO_DAY',
  authDomain: 'ten-du-an.firebaseapp.com',
  projectId: 'ten-du-an',
  storageBucket: 'ten-du-an.firebasestorage.app',
  messagingSenderId: '000000000000',
  appId: '1:000000000000:web:0000000000000000',
};

/** Gmail của Chủ doanh nghiệp — phải trùng với OWNER trong firestore.rules */
export const OWNER_EMAIL = 'waaseevn@gmail.com';

/** Thành viên được tạo sẵn khi Chủ doanh nghiệp đăng nhập lần đầu (sau đó quản lý trong trang Phân quyền) */
export const INITIAL_MEMBERS = [{ email: 'duchau.waasee@gmail.com', role: 'STAFF', displayName: 'Kế toán' }];

/** Thông tin hiển thị */
export const APP_CONFIG = {
  companyName: 'Công ty của tôi',
  appName: 'Quản lý Dòng tiền',
};
