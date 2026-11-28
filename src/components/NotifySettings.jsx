/**
 * CẤU HÌNH THÔNG BÁO ĐẨY VỀ ĐIỆN THOẠI (chỉ Chủ doanh nghiệp)
 * Kênh: Telegram Bot riêng chỉ để báo tin + Webhook tùy chọn.
 * Thông báo trình duyệt / số trên biểu tượng app bật riêng trên từng máy (chuông thông báo).
 */
import { useEffect, useState } from 'react';
import { BellRing, CircleCheck, MessageCircle, Search, Send, TriangleAlert } from 'lucide-react';
import { useAuth } from '../context/AuthContext.jsx';
import { friendlyError } from '../lib/db.js';
import { NOTIFY_DEFAULTS, findChats, loadNotifyConfig, localPermission, localSupported, requestLocalPermission, saveNotifyConfig, sendTest } from '../lib/notify.js';
import { useToast } from './feedback.jsx';
import { Badge, Button, Card, CardHeader, Field, Input, cx } from './ui.jsx';

function Toggle({ checked, onChange, label, hint }) {
  return (
    <label className="flex cursor-pointer items-start gap-3 py-2">
      <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-5 w-5 shrink-0 rounded border-slate-300 accent-ink-900" />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-ink-900">{label}</span>
        {hint && <span className="block text-xs text-slate-500">{hint}</span>}
      </span>
    </label>
  );
}

const resultText = (r) => (r == null ? '' : r.ok === true ? 'đã gửi' : r.ok === null ? 'đã gửi (không đọc được phản hồi — kiểm tra Telegram)' : `lỗi: ${r.error}`);

export function NotifySettings() {
  const { actor } = useAuth();
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [busy, setBusy] = useState('');
  const [chats, setChats] = useState(null);
  const [testMsg, setTestMsg] = useState(null);
  const [perm, setPerm] = useState(localPermission());
  const [showToken, setShowToken] = useState(false);

  useEffect(() => {
    loadNotifyConfig(true).then((c) => setCfg({ ...NOTIFY_DEFAULTS, ...c }));
  }, []);
  if (!cfg) return null;
  const set = (k) => (v) => setCfg((c) => ({ ...c, [k]: v?.target ? v.target.value : v }));

  const save = async () => {
    setBusy('save');
    try {
      await saveNotifyConfig(actor, cfg);
      toast.success(cfg.enabled ? 'Đã lưu — thông báo đẩy đang bật' : 'Đã lưu — thông báo đẩy đang tắt');
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy('');
    }
  };
  const test = async () => {
    setBusy('test');
    setTestMsg(null);
    try {
      const r = await sendTest(cfg, actor.name || actor.email);
      const ok = r.boss?.ok !== false && r.staff?.ok !== false;
      setTestMsg({ ok, text: `Nhóm duyệt chi: ${resultText(r.boss)}${r.staff ? ` · Nhóm kế toán: ${resultText(r.staff)}` : ''}` });
    } finally {
      setBusy('');
    }
  };
  const find = async () => {
    setBusy('find');
    setChats(null);
    try {
      const list = await findChats(cfg.botToken.trim());
      setChats(list);
      if (!list.length) toast.info('Chưa thấy nhóm nào. Thêm bot vào nhóm, gửi một tin bất kỳ trong nhóm rồi bấm lại.');
    } catch (ex) {
      toast.error(ex.message);
    } finally {
      setBusy('');
    }
  };

  return (
    <Card>
      <CardHeader
        title="Cấu hình thông báo đẩy về điện thoại"
        subtitle="Telegram Bot riêng chỉ để báo tin — Sếp nhận đề xuất mới, kế toán nhận khoản đã duyệt / từ chối"
        icon={BellRing}
        iconClass="bg-vermilion-50 text-vermilion-700"
        actions={cfg.enabled ? <Badge tone="green">Đang bật</Badge> : <Badge>Đang tắt</Badge>}
      />
      <div className="space-y-4 px-4 pb-5 sm:px-5">
        <details className="rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
          <summary className="cursor-pointer font-semibold text-ink-900">Cách tạo bot (5 phút, làm một lần)</summary>
          <ol className="mt-2 list-decimal space-y-1 pl-5">
            <li>
              Trong Telegram tìm <b>@BotFather</b> → gõ <code>/newbot</code> → đặt tên (VD: Waasee Duyệt chi) → nhận <b>Bot Token</b> dạng <code>123456789:AA…</code>, dán vào ô bên dưới.
            </li>
            <li>Tạo nhóm “Duyệt chi” gồm Sếp, Đồng quản trị và thêm bot vào nhóm. Muốn kế toán nhận riêng thì tạo thêm nhóm “Kế toán chi tiền” có bot.</li>
            <li>Gửi một tin bất kỳ vào mỗi nhóm, rồi bấm <b>Tìm Chat ID</b> và chọn nhóm.</li>
            <li>
              Bấm <b>Gửi thử thông báo</b>. Thấy tin trong nhóm là xong; bật “Đang dùng thông báo đẩy” rồi <b>Lưu</b>.
            </li>
          </ol>
          <p className="mt-2 text-xs text-slate-500">
            Bot chỉ dùng để gửi tin, không đọc được dữ liệu của app. Mọi thành viên đăng nhập app đều cần đọc token để gửi thông báo khi họ thao tác, vì vậy chỉ dùng bot này cho việc báo tin.
          </p>
        </details>

        <Toggle checked={cfg.enabled} onChange={set('enabled')} label="Đang dùng thông báo đẩy" hint="Tắt thì app vẫn hiện chuông và số đỏ, chỉ không gửi Telegram / Webhook" />

        <Field label="Bot Token">
          <div className="flex gap-2">
            <Input type={showToken ? 'text' : 'password'} value={cfg.botToken} onChange={set('botToken')} placeholder="123456789:AA…" autoComplete="off" className="font-mono" />
            <Button onClick={() => setShowToken((x) => !x)}>{showToken ? 'Ẩn' : 'Hiện'}</Button>
          </div>
        </Field>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Chat ID nhóm duyệt chi (Sếp)" hint="Nhận đề xuất mới cần duyệt">
            <Input value={cfg.bossChatId} onChange={set('bossChatId')} placeholder="-100…" className="font-mono" />
          </Field>
          <Field label="Chat ID nhóm kế toán" hint="Nhận khoản đã duyệt / từ chối. Bỏ trống = gửi vào nhóm duyệt chi">
            <Input value={cfg.staffChatId} onChange={set('staffChatId')} placeholder="-100…" className="font-mono" />
          </Field>
        </div>
        <div>
          <Button size="sm" icon={Search} loading={busy === 'find'} disabled={!!busy || !cfg.botToken.trim()} onClick={find}>
            Tìm Chat ID
          </Button>
          {chats && chats.length > 0 && (
            <ul className="mt-2 divide-y divide-slate-100 rounded-xl border border-slate-200 text-sm">
              {chats.map((c) => (
                <li key={c.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
                  <MessageCircle className="h-4 w-4 text-slate-400" />
                  <span className="min-w-0 flex-1 truncate font-medium text-ink-900">{c.title}</span>
                  <code className="text-xs text-slate-500">{c.id}</code>
                  <Button size="xs" onClick={() => set('bossChatId')(c.id)}>
                    Nhóm Sếp
                  </Button>
                  <Button size="xs" onClick={() => set('staffChatId')(c.id)}>
                    Nhóm kế toán
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <Field label="Webhook (không bắt buộc)" hint="Nhận dữ liệu mỗi sự kiện dạng JSON — dùng với Zapier, Make, Google Apps Script…">
          <Input value={cfg.webhookUrl} onChange={set('webhookUrl')} placeholder="https://…" />
        </Field>

        <div className="rounded-xl border border-slate-200 px-3">
          <Toggle checked={cfg.onProposed} onChange={set('onProposed')} label="Có đề xuất chi mới" hint="Gửi vào nhóm duyệt chi, kèm link mở thẳng ngăn duyệt nhanh" />
          <Toggle checked={cfg.onApproved} onChange={set('onApproved')} label="Sếp duyệt (toàn bộ hoặc một phần)" hint="Gửi cho kế toán, kèm số Sếp chốt" />
          <Toggle checked={cfg.onRejected} onChange={set('onRejected')} label="Sếp từ chối / hoãn" hint="Gửi cho kế toán, kèm lý do" />
        </div>

        {testMsg && (
          <p className={cx('flex items-start gap-2 rounded-xl px-3 py-2 text-sm', testMsg.ok ? 'bg-jade-50 text-jade-900' : 'bg-rose-50 text-rose-800')}>
            {testMsg.ok ? <CircleCheck className="mt-0.5 h-4 w-4 shrink-0" /> : <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />}
            {testMsg.text}
          </p>
        )}
        <div className="flex flex-wrap justify-end gap-2">
          <Button icon={Send} loading={busy === 'test'} disabled={!!busy || !cfg.botToken.trim() || !cfg.bossChatId.trim()} onClick={test}>
            Gửi thử thông báo
          </Button>
          <Button variant="primary" loading={busy === 'save'} disabled={!!busy} onClick={save}>
            Lưu cấu hình
          </Button>
        </div>

        {localSupported() && (
          <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 pt-4 text-sm">
            <span className="flex-1 text-slate-600">
              Thông báo trên máy này (khi app đang mở hoặc đã cài lên màn hình chính):{' '}
              <b className="text-ink-900">{perm === 'granted' ? 'đã bật' : perm === 'denied' ? 'đã chặn — mở cài đặt trình duyệt để cho phép' : 'chưa bật'}</b>
            </span>
            {perm === 'default' && (
              <Button size="sm" onClick={async () => setPerm(await requestLocalPermission())}>
                Bật trên máy này
              </Button>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
