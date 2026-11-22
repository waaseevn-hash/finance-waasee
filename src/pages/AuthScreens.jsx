import { useState } from 'react';
import { LockKeyhole, LogOut, ShieldAlert, ShieldCheck, Wrench } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { APP_CONFIG } from '../firebase-config.js';
import { LOGO } from '../lib/brand.js';
import { friendlyError } from '../lib/db.js';
import { Button } from '../components/ui.jsx';

function Shell({ children }) {
  return (
    <div className="relative min-h-screen bg-ink-900 guilloche grid place-items-center px-4 py-10">
      <div className="relative w-full max-w-md">
        <div className="flex items-center gap-3 mb-6 justify-center">
          <img src={LOGO} alt="" className="h-11 w-11 rounded-xl ring-1 ring-white/15" />
          <div className="leading-tight">
            <p className="font-display text-base font-semibold text-white">{APP_CONFIG.appName}</p>
            <p className="text-xs text-white/60">Dữ liệu tài chính nội bộ</p>
          </div>
        </div>
        <div className="rounded-2xl bg-white p-6 sm:p-8 shadow-2xl">{children}</div>
      </div>
    </div>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 48 48" className="h-5 w-5" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

export function LoginScreen() {
  const { signIn } = useAuth();
  const iosApp =
    (/iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) &&
    (window.navigator.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const go = async () => {
    setBusy(true);
    setError('');
    try {
      await signIn();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-ink-900 text-white mb-4">
        <LockKeyhole className="h-6 w-6" />
      </span>
      <h1 className="font-display text-xl font-bold text-ink-900">Đăng nhập</h1>
      <p className="mt-1 text-sm text-slate-500 leading-relaxed">
        Hệ thống quản lý dòng tiền nội bộ. Chỉ Gmail đã được Chủ doanh nghiệp cấp quyền mới vào được.
      </p>
      <Button variant="secondary" size="lg" className="mt-6 w-full !h-12 text-[15px]" onClick={go} loading={busy}>
        {!busy && <GoogleMark />} Đăng nhập bằng Google
      </Button>
      {error && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>}
      {iosApp && (
        <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900 leading-relaxed">
          Trên iPhone, nếu đăng nhập không quay lại được app: xóa biểu tượng này, mở link bằng Safari, chọn Chia sẻ → Thêm vào MH chính và <b>tắt</b> “Mở dưới dạng ứng dụng web”.
        </p>
      )}
      <p className="mt-6 flex items-center gap-2 text-xs text-slate-400">
        <ShieldCheck className="h-4 w-4" /> Kết nối mã hóa · Phân quyền theo danh sách Gmail
      </p>
    </Shell>
  );
}

export function AccessDenied() {
  const { user, member, signOut, signIn, error } = useAuth();
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const locked = member && member.active !== true;
  const noEmail = error === 'no-email';
  const relogin = async () => {
    setBusy(true);
    setErr('');
    try {
      await signIn();
    } catch (e) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Shell>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-rose-50 text-rose-600 mb-4">
        <ShieldAlert className="h-6 w-6" />
      </span>
      {noEmail ? (
        <>
          <h1 className="font-display text-lg font-semibold text-ink-900">Chưa nhận được địa chỉ Gmail</h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Google chưa chia sẻ địa chỉ Gmail của tài khoản <b className="text-ink-900">{user?.displayName || ''}</b> cho app, nên chưa kiểm tra được quyền. Bấm đăng nhập lại và
            đồng ý cho app xem địa chỉ email.
          </p>
          <Button variant="primary" size="lg" className="mt-6 w-full" onClick={relogin} loading={busy}>
            Đăng nhập lại bằng Google
          </Button>
          {err && <p className="mt-3 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
        </>
      ) : (
        <>
          <h1 className="font-display text-lg font-semibold text-ink-900">{locked ? 'Tài khoản đã bị khóa' : 'Không có quyền truy cập'}</h1>
          <p className="mt-2 text-sm text-slate-600 leading-relaxed">
            Gmail <b className="text-ink-900">{user?.email || user?.providerData?.find((x) => x?.email)?.email}</b>{' '}
            {locked ? 'đã bị Chủ doanh nghiệp tạm khóa quyền truy cập.' : 'chưa được cấp quyền. Hệ thống không hiển thị bất kỳ số liệu nào.'}
          </p>
          <p className="mt-2 text-sm text-slate-500">Nếu bạn là người trong công ty, hãy nhờ Chủ doanh nghiệp thêm Gmail này ở trang Phân quyền.</p>
          {error && <p className="mt-2 text-xs text-slate-400">Mã lỗi: {error}</p>}
        </>
      )}
      <Button variant={noEmail ? 'secondary' : 'primary'} size="lg" icon={LogOut} className="mt-3 w-full" onClick={signOut}>
        Đăng xuất / Dùng Gmail khác
      </Button>
    </Shell>
  );
}

export function SetupNeeded() {
  return (
    <Shell>
      <span className="grid h-12 w-12 place-items-center rounded-2xl bg-amber-50 text-amber-600 mb-4">
        <Wrench className="h-6 w-6" />
      </span>
      <h1 className="font-display text-lg font-semibold text-ink-900">Chưa cấu hình Firebase</h1>
      <p className="mt-2 text-sm text-slate-600 leading-relaxed">
        Dán cấu hình Firebase vào <code className="rounded bg-slate-100 px-1.5 py-0.5 text-[13px]">src/firebase-config.js</code> rồi triển khai lại.
      </p>
    </Shell>
  );
}
