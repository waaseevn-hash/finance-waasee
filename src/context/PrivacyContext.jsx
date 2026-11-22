import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const PrivacyContext = createContext({ hidden: false, toggle: () => {} });
const KEY = 'cf_privacy_mode';

function readInitial() {
  try {
    return window.localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

/** Chế độ riêng tư: thêm class "privacy-on" vào <html> để làm mờ mọi phần tử .money */
export function PrivacyProvider({ children }) {
  const [hidden, setHidden] = useState(readInitial);

  useEffect(() => {
    document.documentElement.classList.toggle('privacy-on', hidden);
    try {
      window.localStorage.setItem(KEY, hidden ? '1' : '0');
    } catch {
      /* trình duyệt chặn lưu trữ: bỏ qua */
    }
  }, [hidden]);

  const value = useMemo(() => ({ hidden, toggle: () => setHidden((h) => !h) }), [hidden]);
  return <PrivacyContext.Provider value={value}>{children}</PrivacyContext.Provider>;
}

export function usePrivacy() {
  return useContext(PrivacyContext);
}
