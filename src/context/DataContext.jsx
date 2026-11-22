import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { useAuth } from './AuthContext.jsx';
import { C, friendlyError, subscribeCollection } from '../lib/db.js';
import { can } from '../lib/roles.js';

const DataContext = createContext(null);

const EMPTY = { cash: [], banks: [], loans: [], ar: [], ap: [], suppliers: [], approvals: [] };

/**
 * Đồng bộ thời gian thực các bộ sưu tập chính.
 * STAFF chỉ đăng ký công nợ — không hề tải dữ liệu két/ngân hàng
 * (và rules cũng chặn nếu cố tình gọi).
 */
export function DataProvider({ children }) {
  const { role, status } = useAuth();
  const [data, setData] = useState(EMPTY);
  const [loaded, setLoaded] = useState({});
  const [error, setError] = useState(null);

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
    return () => subs.forEach((u) => u());
  }, [role, status]);

  const value = useMemo(() => {
    const need = can(role, 'viewTreasury') ? ['cash', 'banks', 'loans', 'ar', 'ap', 'suppliers', 'approvals'] : ['ar', 'ap', 'suppliers', 'approvals'];
    return { ...data, loaded, ready: need.every((k) => loaded[k]), error };
  }, [data, loaded, error, role]);

  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData() {
  return useContext(DataContext);
}
