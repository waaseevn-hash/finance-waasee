/**
 * DỊCH VỤ THÔNG BÁO — chạy được trên gói Firebase Spark (không cần Cloud Functions)
 *
 * Lớp 1 — Tin nhắn đẩy tức thì qua Telegram Bot (và/hoặc Webhook): chính máy người thao tác gửi tin
 *          ngay sau khi lưu (gửi đề xuất → báo Sếp; Sếp duyệt / từ chối → báo kế toán).
 *          Cấu hình ở settings/notify (Chủ DN sửa; thành viên đọc được để máy kế toán cũng gửi được).
 *          Nên dùng một bot RIÊNG chỉ để báo tin: lộ token cũng chỉ gửi được tin vào nhóm, không đụng dữ liệu.
 * Lớp 2 — Thông báo của trình duyệt + số đếm trên biểu tượng app (PWA) khi app đang mở / chạy nền.
 *
 * Muốn chuyển sang Firebase Cloud Messaging (gói Blaze): thay phần thân sendChannels() bằng lời gọi
 * Cloud Function; các nơi gọi notifyEvent() giữ nguyên.
 */
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase.js';
import { C } from './db.js';
import { fmtVND } from './format.js';

export const NOTIFY_DEFAULTS = {
  enabled: false,
  botToken: '',
  bossChatId: '', // Sếp / nhóm duyệt chi — nhận đề xuất mới
  staffChatId: '', // Kế toán — nhận khoản đã duyệt / từ chối (trống = gửi vào nhóm duyệt chi)
  webhookUrl: '', // tùy chọn: nhận JSON mỗi sự kiện (Zapier, Make, Apps Script…)
  onProposed: true,
  onApproved: true,
  onRejected: true,
};

const ref = () => doc(db, C.settings, 'notify');
let cache = null;
let cacheAt = 0;

/** Đọc cấu hình (lưu tạm 60 giây) */
export async function loadNotifyConfig(force = false) {
  if (!force && cache && Date.now() - cacheAt < 60_000) return cache;
  try {
    const s = await getDoc(ref());
    cache = { ...NOTIFY_DEFAULTS, ...(s.exists() ? s.data() : {}) };
  } catch {
    cache = { ...NOTIFY_DEFAULTS };
  }
  cacheAt = Date.now();
  return cache;
}

/** Lưu cấu hình (chỉ Chủ DN — luật bảo mật chặn người khác). Không ghi token vào nhật ký. */
export async function saveNotifyConfig(actor, cfg) {
  const clean = {
    enabled: !!cfg.enabled,
    botToken: String(cfg.botToken || '').trim().slice(0, 200),
    bossChatId: String(cfg.bossChatId || '').trim().slice(0, 40),
    staffChatId: String(cfg.staffChatId || '').trim().slice(0, 40),
    webhookUrl: String(cfg.webhookUrl || '').trim().slice(0, 500),
    onProposed: cfg.onProposed !== false,
    onApproved: cfg.onApproved !== false,
    onRejected: cfg.onRejected !== false,
    updatedBy: actor.email,
    updatedAt: serverTimestamp(),
  };
  await setDoc(ref(), clean);
  cache = { ...NOTIFY_DEFAULTS, ...clean };
  cacheAt = Date.now();
}

/** Đường link mở thẳng một màn hình của app (mặc định: ngăn duyệt nhanh) */
export function appLink(hash = 'approve') {
  try {
    return `${window.location.href.split('#')[0]}#${hash}`;
  } catch {
    return '';
  }
}

const escHtml = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Gửi một tin Telegram. Trả về { ok, error? }; ok = null khi đã gửi nhưng không đọc được phản hồi. */
export async function sendTelegram(token, chatId, html) {
  if (!token || !chatId) return { ok: false, error: 'Thiếu Bot Token hoặc Chat ID' };
  const body = new URLSearchParams({ chat_id: String(chatId), text: html, parse_mode: 'HTML', disable_web_page_preview: 'true' });
  try {
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/sendMessage`, { method: 'POST', body });
    const j = await res.json().catch(() => null);
    if (j && j.ok === false) return { ok: false, error: j.description || `Lỗi ${res.status}` };
    return { ok: j ? !!j.ok : res.ok };
  } catch {
    // Trình duyệt chặn đọc phản hồi (CORS) — tin vẫn đã được gửi đi
    return { ok: null };
  }
}

async function sendWebhook(url, payload) {
  if (!url) return;
  try {
    await fetch(url, { method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, body: JSON.stringify(payload) });
  } catch {
    /* bỏ qua */
  }
}

const TITLE = {
  PROPOSED: '🧾 Đề xuất chi mới — chờ Sếp duyệt',
  APPROVED: '✅ Sếp đã duyệt — kế toán chi ngay',
  REJECTED: '⛔ Sếp từ chối / hoãn',
  TEST: '🔔 Thử thông báo',
};

/** Soạn nội dung tin nhắn */
export function composeMessage(type, d = {}) {
  const lines = [`<b>${TITLE[type] || type}</b>`];
  if (d.who) lines.push(`Người đề nghị / đối tác: <b>${escHtml(d.who)}</b>`);
  if (d.what) lines.push(`Nội dung: ${escHtml(d.what)}`);
  if (Number.isFinite(d.amount)) lines.push(`Số tiền: <b>${escHtml(fmtVND(d.amount))}</b>${d.requested && d.requested !== d.amount ? ` (đề nghị ${escHtml(fmtVND(d.requested))})` : ''}`);
  if (d.method) lines.push(`Hình thức: ${escHtml(d.method)}`);
  if (d.reason) lines.push(`Lý do: ${escHtml(d.reason)}`);
  if (d.by) lines.push(`Thao tác: ${escHtml(d.by)}`);
  if (d.count > 1) lines.push(`(${d.count} khoản)`);
  const link = appLink(type === 'PROPOSED' ? 'approve' : 'work-2');
  if (link) lines.push(`<a href="${escHtml(link)}">${type === 'PROPOSED' ? 'Mở ngăn duyệt nhanh' : 'Mở danh sách cần chi'}</a>`);
  return lines.join('\n');
}

async function sendChannels(cfg, type, d) {
  const html = composeMessage(type, d);
  const chat = type === 'PROPOSED' || type === 'TEST' ? cfg.bossChatId : cfg.staffChatId || cfg.bossChatId;
  const out = await sendTelegram(cfg.botToken, chat, html);
  await sendWebhook(cfg.webhookUrl, { type, ...d, link: appLink(type === 'PROPOSED' ? 'approve' : 'work-2'), at: new Date().toISOString() });
  return out;
}

/**
 * Báo một sự kiện. Không bao giờ ném lỗi (thông báo hỏng không được làm hỏng thao tác chính).
 * @param {'PROPOSED'|'APPROVED'|'REJECTED'} type
 * @param {{who?, what?, amount?, requested?, method?, reason?, by?, count?}} data
 */
export async function notifyEvent(type, data) {
  try {
    const cfg = await loadNotifyConfig();
    if (!cfg.enabled) return;
    if (type === 'PROPOSED' && !cfg.onProposed) return;
    if (type === 'APPROVED' && !cfg.onApproved) return;
    if (type === 'REJECTED' && !cfg.onRejected) return;
    await sendChannels(cfg, type, data || {});
  } catch {
    /* bỏ qua */
  }
}

/** Gửi thử với cấu hình đang nhập (chưa cần lưu): gửi vào nhóm Sếp và (nếu khác) nhóm Kế toán */
export async function sendTest(cfg, actorName) {
  const c = { ...NOTIFY_DEFAULTS, ...cfg };
  const html = composeMessage('TEST', { what: 'Kết nối thông báo đẩy của app Quản lý Dòng tiền đã hoạt động.', by: actorName });
  const boss = await sendTelegram(c.botToken, c.bossChatId, html);
  const staff = c.staffChatId && c.staffChatId !== c.bossChatId ? await sendTelegram(c.botToken, c.staffChatId, html) : null;
  await sendWebhook(c.webhookUrl, { type: 'TEST', by: actorName, link: appLink('approve'), at: new Date().toISOString() });
  return { boss, staff };
}

/**
 * Tìm Chat ID: đọc các tin gần đây bot nhận được (getUpdates).
 * Người dùng thêm bot vào nhóm rồi gửi một tin bất kỳ trước khi bấm.
 * Trả về [{ id, title, type }] hoặc ném lỗi dễ hiểu.
 */
export async function findChats(token) {
  if (!token) throw new Error('Nhập Bot Token trước');
  let j;
  try {
    const res = await fetch(`https://api.telegram.org/bot${encodeURIComponent(token)}/getUpdates?limit=100`);
    j = await res.json();
  } catch {
    throw new Error('Không gọi được Telegram từ trình duyệt này. Làm theo cách lấy Chat ID thủ công bên dưới.');
  }
  if (!j?.ok) throw new Error(j?.description === 'Unauthorized' ? 'Bot Token không đúng' : j?.description || 'Telegram báo lỗi');
  const map = new Map();
  for (const u of j.result || []) {
    const chat = u.message?.chat || u.channel_post?.chat || u.my_chat_member?.chat || u.edited_message?.chat;
    if (!chat) continue;
    const title = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || String(chat.id);
    map.set(String(chat.id), { id: String(chat.id), title, type: chat.type });
  }
  return [...map.values()];
}

/* ===================== Lớp 2: thông báo trình duyệt + số trên biểu tượng app ===================== */

export const localSupported = () => typeof window !== 'undefined' && 'Notification' in window;
export const localPermission = () => (localSupported() ? Notification.permission : 'unsupported');

export async function requestLocalPermission() {
  if (!localSupported()) return 'unsupported';
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

/** Hiện một thông báo của hệ điều hành (qua service worker nếu có — cần cho Android) */
export async function showLocal(title, body, { tag = 'dong-tien', hash = 'approve' } = {}) {
  if (localPermission() !== 'granted') return;
  const opts = { body, tag, icon: './icons/icon-192.png', badge: './icons/icon-192.png', data: { url: `./#${hash}` } };
  try {
    const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
    if (reg?.showNotification) return void (await reg.showNotification(title, opts));
    const n = new Notification(title, opts);
    n.onclick = () => {
      window.focus();
      window.location.hash = hash;
      n.close();
    };
  } catch {
    /* bỏ qua */
  }
}

/** Số đếm trên biểu tượng app đã cài (Android / máy tính) */
export function setBadge(count) {
  try {
    if (!('setAppBadge' in navigator)) return;
    if (count > 0) navigator.setAppBadge(count);
    else navigator.clearAppBadge?.();
  } catch {
    /* bỏ qua */
  }
}
