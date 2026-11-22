import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from 'firebase/auth';
import { doc, onSnapshot, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import { auth, db, googleProvider, isConfigured } from '../lib/firebase.js';
import { INITIAL_MEMBERS, OWNER_EMAIL } from '../firebase-config.js';
import { AuditedBatch, C } from '../lib/db.js';

const AuthContext = createContext(null);

/**
 * Trạng thái: unconfigured | loading | signedOut | checking | denied | ready
 * "ready" chỉ khi email nằm trong bảng members và active = true.
 * Hồ sơ thành viên được lắng nghe realtime: Chủ doanh nghiệp khóa quyền là
 * màn hình của người đó đóng ngay lập tức.
 * Lần đăng nhập đầu tiên của Chủ doanh nghiệp (OWNER_EMAIL) tự tạo hồ sơ OWNER.
 */
export function AuthProvider({ children }) {
  const [state, setState] = useState({ status: isConfigured ? 'loading' : 'unconfigured', user: null, member: null });

  useEffect(() => {
    if (!isConfigured) return undefined;
    let unsubMember = null;
    const unsubAuth = onAuthStateChanged(auth, (u) => {
      if (unsubMember) {
        unsubMember();
        unsubMember = null;
      }
      if (!u) {
        setState({ status: 'signedOut', user: null, member: null });
        return;
      }
      const email = String(u.email || u.providerData?.find((x) => x?.email)?.email || '').toLowerCase();
      if (!email) {
        // Tài khoản Google chưa trả về địa chỉ Gmail -> không xác định được quyền
        setState({ status: 'denied', user: u, member: null, error: 'no-email' });
        return;
      }
      const ref = doc(db, C.members, email);
      let touched = false;
      let bootstrapping = false;
      setState({ status: 'checking', user: u, member: null });
      unsubMember = onSnapshot(
        ref,
        (snap) => {
          if (!snap.exists() && email === OWNER_EMAIL.toLowerCase()) {
            if (bootstrapping) return;
            bootstrapping = true;
            // Khởi tạo lần đầu: hồ sơ Chủ doanh nghiệp
            setDoc(ref, {
              email,
              displayName: u.displayName || email,
              photoURL: u.photoURL || '',
              role: 'OWNER',
              active: true,
              createdAt: serverTimestamp(),
              lastSeenAt: serverTimestamp(),
            })
              .then(async () => {
                // Tạo sẵn các thành viên ban đầu (kế toán…), có ghi nhật ký
                const list = INITIAL_MEMBERS.filter((x) => x.email && x.email.toLowerCase() !== email);
                if (!list.length) return;
                const b = new AuditedBatch({ email, name: u.displayName || email });
                for (const x of list) {
                  const em = x.email.toLowerCase();
                  b.create(C.members, { email: em, displayName: x.displayName || em, role: x.role, active: true }, `Cấp quyền ban đầu cho ${em}`, { id: em });
                }
                await b.commit();
              })
              .catch((err) => setState({ status: 'denied', user: u, member: null, error: err?.code }));
            return;
          }
          const m = snap.exists() ? { id: snap.id, ...snap.data() } : null;
          if (m && m.active === true && !touched) {
            touched = true;
            // Cập nhật tên / ảnh hiển thị & lần truy cập gần nhất (chỉ các trường này)
            updateDoc(ref, { displayName: u.displayName || m.displayName || email, photoURL: u.photoURL || '', lastSeenAt: serverTimestamp() }).catch(() => {});
          }
          setState({ status: m && m.active === true ? 'ready' : 'denied', user: u, member: m });
        },
        (err) => setState({ status: 'denied', user: u, member: null, error: err?.code }),
      );
    });
    return () => {
      unsubAuth();
      if (unsubMember) unsubMember();
    };
  }, []);

  const value = useMemo(() => {
    const u = state.user;
    const email = u ? String(u.email || u.providerData?.find((x) => x?.email)?.email || '').toLowerCase() : '';
    const name = state.member?.displayName || u?.displayName || email;
    return {
      ...state,
      me: u ? { id: email, email, name, avatarUrl: u.photoURL || '' } : null,
      actor: u ? { email, name } : null,
      role: state.status === 'ready' ? state.member?.role : null,
      async signIn() {
        try {
          await signInWithPopup(auth, googleProvider);
        } catch (err) {
          if (String(err?.code).includes('popup-blocked')) {
            await signInWithRedirect(auth, googleProvider);
            return;
          }
          throw err;
        }
      },
      signOut: () => signOut(auth),
    };
  }, [state]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  return useContext(AuthContext);
}
