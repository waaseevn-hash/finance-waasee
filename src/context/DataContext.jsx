import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { C, friendlyError, subscribeCollection, subscribeWhere } from '../lib/db.js';
import { can } from '../lib/roles.js';

const DataContext = createContext(null);

const EMPTY = { cash: [], banks: [], loans: [], ar: [], ap: [], suppliers: [], approvals: [], vouchers: [], batches: [] };

/**
 * Đồng bộ thời gian thực các bộ sưu tập chính.
 * STAFF chỉ đăng ký công nợ — không hề tải dữ liệu két/ngân hàng
 * (và rules cũng chặn nếu cố tình gọi).
 */
export function DataProvider({ children }) {
  const { role, status, me } = useAuth();
  const email = me?.email || '';
  const [data, setData] = useState(EMPTY);
  const [loaded, setLoaded] = useState({});
  const [error, setError] = useState(null);
  const [voucherError, setVoucherError] = useState(null);

  useEffect(() => {
    if (status !== 'ready' || !role) return undefined;
    setData(EMPTY);
    setLoaded({});
    setError(null);
    const subs = [];
    const sub = (key, coll) =>
      subs.push(
        subscribeCollection(
          coll,
          (rows) => {
            setData((d) => ({ ...d, [key]: rows }));
            setLoaded((l) => (l[key] ? l : { ...l, [key]: true }));
          },
          (err) => setError(friendlyError(err)),
        ),
      );
    if (can(role, 'viewTreasury')) {
      sub('cash', C.cash);
      sub('banks', C.banks);
      sub('loans', C.loans);
    }
    sub('ar', C.ar);
    sub('ap', C.ap);
    sub('suppliers', C.partners);
    sub('approvals', C.approvals);
    // Chứng từ nội bộ: lỗi (vd luật bảo mật chưa cập nhật) không làm hỏng các màn hình khác
    setVoucherError(null);
    const onRows = (key) => (rows) => {
      setData((d) => ({ ...d, [key]: rows }));
      setLoaded((l) => (l[key] ? l : { ...l, [key]: true }));
    };
    const onVErr = (key) => (err) => {
      setVoucherError(friendlyError(err));
      setLoaded((l) => ({ ...l, [key]: true }));
    };
    if (can(role, 'approveVouchers')) {
      subs.push(subscribeCollection(C.vouchers, onRows('vouchers'), onVErr('vouchers')));
      subs.push(subscribeCollection(C.batches, onRows('batches'), onVErr('batches')));
    } else if (email) {
      // Kế toán: đề xuất của mình + mọi khoản Sếp đã duyệt / đã chốt sổ (để đi chi và lưu chứng từ)
      const parts = { own: null, approved: null, posted: null };
      const merge = () => {
        if (Object.values(parts).some((x) => x === null)) return;
        const byId = new Map();
        for (const list of Object.values(parts)) for (const v of list) byId.set(v.id, v);
        onRows('vouchers')([...byId.values()]);
      };
      const part = (k) => (rows) => {
        parts[k] = rows;
        merge();
      };
      // Luật chưa cập nhật: phần đã duyệt / đã chốt báo lỗi thì vẫn hiện đề xuất của mình
      const soft = (k) => () => {
        parts[k] = [];
        merge();
      };
      subs.push(subscribeWhere(C.vouchers, 'requestedBy', email, part('own'), onVErr('vouchers')));
      subs.push(subscribeWhere(C.vouchers, 'status', 'APPROVED', part('approved'), soft('approved')));
      subs.push(subscribeWhere(C.vouchers, 'status', 'POSTED', part('posted'), soft('posted')));
      subs.push(subscribeCollection(C.batches, onRows('batches'), () => setLoaded((l) => ({ ...l, batches: true }))));
    }
    return () => subs.forEach((u) => u());
  }, [role, status, email]);

  const value = useMemo(() => {
    const need = can(role, 'viewTreasury') ? ['cash', 'banks', 'loans', 'ar', 'ap', 'suppliers', 'approvals'] : ['ar', 'ap', 'suppliers', 'approvals'];
    return { ...data, loaded, ready: need.every((k) => loaded[k]), vouchersReady: !!loaded.vouchers && !!loaded.batches, error, voucherError };
  }, [data, loaded, error, voucherError, role]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  return useContext(DataContext);
}
