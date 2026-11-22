import { useCallback, useEffect, useMemo, useState } from 'react';
import { collection, getDocs, limit, onSnapshot, orderBy, query } from 'firebase/firestore';
import { Calculator, ChevronDown, ChevronRight, Crown, FileSpreadsheet, History, Lock, Search, ShieldCheck, Trash2, LockOpen, UserCog, UserPlus, Users } from 'lucide-react';
import { db } from '../lib/firebase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AuditedBatch, C, COLLECTION_LABEL, friendlyError } from '../lib/db.js';
import { ImportPanel } from '../components/ImportPanel.jsx';
import { fmtDate, fmtDateTime } from '../lib/dates.js';
import { fmtVND, matchSearch } from '../lib/format.js';
import { ROLE_LABEL } from '../lib/roles.js';
import { CERTAINTY, PAY_METHOD, PRIORITY } from '../lib/constants.js';
import { downloadXlsx } from '../lib/xlsx.js';
import { useConfirm, useToast } from '../components/feedback.jsx';
import { Who, useNames } from '../components/Who.jsx';
import { resolveNames } from '../lib/runtime.js';
import { saveCompanyName, useCompanyName } from '../lib/brand.js';
import { Badge, Button, Card, CardHeader, EmptyState, Input, PageHeader, Select, TableWrap, Tabs, cx, td, th } from '../components/ui.jsx';

/* ------------------------- Hiển thị giá trị nhật ký ------------------------- */
const FIELD_LABEL = {
  date: 'Ngày',
  type: 'Loại',
  amount: 'Số tiền',
  counterparty: 'Đối tượng',
  description: 'Nội dung',
  note: 'Ghi chú',
  name: 'Tên',
  creditLimit: 'Hạn mức',
  limitExpiry: 'Hạn hạn mức',
  depositBalance: 'Tiền gửi TK',
  bankId: 'Mã ngân hàng',
  contractNo: 'Số KUNN',
  disbursedDate: 'Ngày giải ngân',
  interestRate: 'Lãi suất (%/năm)',
  maturityDate: 'Ngày đáo hạn',
  status: 'Trạng thái',
  settledDate: 'Ngày tất toán',
  purpose: 'Mục đích',
  partnerName: 'Đối tác',
  total: 'Tổng công nợ',
  paid: 'Đã thanh toán',
  openingPaid: 'Đã TT trước khi nhập',
  dueDate: 'Hạn',
  certainty: 'Mức độ chắc chắn',
  priority: 'Ưu tiên',
  role: 'Vai trò',
  active: 'Đang kích hoạt',
  email: 'Email',
  displayName: 'Tên hiển thị',
  method: 'Hình thức',
  kind: 'Loại công nợ',
  parentId: 'Mã công nợ',
  cashEntryId: 'Phiếu quỹ liên kết',
  month: 'Tháng',
  version: 'Bản số',
  payTotal: 'Tổng chi',
  balance: 'Số dư sau chi',
  sources: 'Tổng nguồn',
  taxCode: 'Mã số thuế',
  bankAccount: 'Số tài khoản',
  bankName: 'Ngân hàng',
  bankBranch: 'Chi nhánh',
  accountHolder: 'Chủ tài khoản',
  contactName: 'Người liên hệ',
  phone: 'Điện thoại',
  address: 'Địa chỉ',
  supplierId: 'Mã nhà cung cấp',
  mode: 'Hình thức trả',
  label: 'Ghi chú',
  payableId: 'Mã công nợ phải trả',
  approvedOn: 'Ngày duyệt chi',
  outstandingAtApproval: 'Còn nợ lúc duyệt',
  paidAmount: 'Số đã chuyển',
  paidOn: 'Ngày chuyển tiền',
  paymentId: 'Mã thanh toán',
  approvalId: 'Mã lệnh duyệt chi',
};
const MONEY_FIELDS = new Set(['amount', 'creditLimit', 'depositBalance', 'total', 'paid', 'openingPaid', 'payTotal', 'balance', 'sources', 'paidAmount', 'outstandingAtApproval']);

function fmtValue(field, v) {
  if (v === null || v === undefined || v === '') return '—';
  if (MONEY_FIELDS.has(field) && typeof v === 'number') return fmtVND(v);
  if (typeof v === 'boolean') return v ? 'Có' : 'Không';
  if (field === 'type') return v === 'IN' ? 'Thu' : v === 'OUT' ? 'Chi' : v;
  if (field === 'status') return { ACTIVE: 'Đang vay', SETTLED: 'Đã tất toán', OPEN: 'Chờ chuyển tiền', DONE: 'Đã chuyển tiền', CANCELLED: 'Đã hủy duyệt' }[v] || v;
  if (field === 'mode') return { FULL: 'Chi hết / trả toàn bộ', PART: 'Chi 1 phần' }[v] || v;
  if (field === 'role') return ROLE_LABEL[v] || v;
  if (field === 'active') return v ? 'Đang hoạt động' : 'Đã khóa';
  if (field === 'priority') return PRIORITY[v]?.label || v;
  if (field === 'certainty') return CERTAINTY[v]?.label || v;
  if (field === 'method') return PAY_METHOD[v] || v;
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return fmtDate(v);
  if (typeof v === 'object') return JSON.stringify(v);
  return String(v);
}

const ACTION = {
  CREATE: { label: 'Thêm', tone: 'green' },
  UPDATE: { label: 'Sửa', tone: 'blue' },
  DELETE: { label: 'Xóa', tone: 'red' },
};

/* ------------------------------ Tên doanh nghiệp ------------------------------ */
function CompanyNameEditor() {
  const toast = useToast();
  const current = useCompanyName();
  const [v, setV] = useState(current);
  const [busy, setBusy] = useState(false);
  useEffect(() => setV(current), [current]);
  const save = async (e) => {
    e.preventDefault();
    if (!v.trim() || v.trim() === current) return;
    setBusy(true);
    try {
      await saveCompanyName(v.trim());
      toast.success('Đã lưu tên doanh nghiệp');
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={save} className="p-4 sm:p-5 space-y-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Tên doanh nghiệp (hiện trên trang & báo cáo)</p>
      <div className="flex gap-2">
        <Input value={v} onChange={(e) => setV(e.target.value)} />
        <Button type="submit" variant="primary" loading={busy}>
          Lưu
        </Button>
      </div>
    </form>
  );
}

/* ------------------------------ Thành viên & phân quyền ------------------------------ */
const ROLE_CHOICES = [
  { value: 'STAFF', title: 'Kế toán công nợ', desc: 'Phải thu, phải trả, lệnh chi đã duyệt, danh bạ NCC', icon: Calculator, ring: 'ring-orchid-500 bg-orchid-50', dot: 'bg-orchid-600' },
  { value: 'CO_OWNER', title: 'Đồng quản trị', desc: 'Toàn quyền dòng tiền, duyệt chi; trừ phân quyền và nhật ký', icon: Crown, ring: 'ring-sapphire-500 bg-sapphire-50', dot: 'bg-sapphire-600' },
];
const ROLE_TONE = { OWNER: 'dark', CO_OWNER: 'blue', STAFF: 'violet' };
const isGmailLike = (e) => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e);

function RolePicker({ value, onChange, disabled }) {
  return (
    <div role="radiogroup" aria-label="Vai trò" className="grid gap-2 sm:grid-cols-2">
      {ROLE_CHOICES.map((c) => {
        const on = value === c.value;
        return (
          <button
            key={c.value}
            type="button"
            role="radio"
            aria-checked={on}
            disabled={disabled}
            onClick={() => onChange(c.value)}
            className={cx(
              'relative text-left rounded-xl border px-3.5 py-3 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-sapphire-500',
              on ? `border-transparent ring-2 ${c.ring}` : 'border-slate-200 bg-white hover:border-slate-300',
            )}
          >
            <span className="flex items-center gap-2">
              <c.icon className="h-4 w-4 text-slate-700" />
              <span className="font-display font-semibold text-ink-900">{c.title}</span>
              {on && <span className={cx('ml-auto h-2.5 w-2.5 rounded-full', c.dot)} />}
            </span>
            <span className="mt-1 block text-xs text-slate-600 leading-snug">{c.desc}</span>
          </button>
        );
      })}
    </div>
  );
}

function AddMember({ members, actor }) {
  const toast = useToast();
  const [f, setF] = useState({ email: '', displayName: '', role: 'STAFF' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    const email = f.email.trim().toLowerCase();
    if (!isGmailLike(email)) return setErr('Nhập đúng địa chỉ Gmail, ví dụ: tenketoan@gmail.com');
    if (members?.some((m) => m.id === email)) return setErr('Gmail này đã có trong danh sách');
    setErr('');
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      b.create(C.members, { email, displayName: f.displayName.trim() || email, role: f.role, active: true }, `Cấp quyền ${ROLE_LABEL[f.role]} cho ${email}`, {
        id: email,
      });
      await b.commit();
      toast.success(`Đã cấp quyền cho ${email}. Gửi họ link app để đăng nhập bằng Gmail này.`);
      setF({ email: '', displayName: '', role: f.role });
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Card>
      <CardHeader title="Thêm thành viên" subtitle="Nhập Gmail và chọn vai trò — người đó đăng nhập bằng đúng Gmail này" icon={UserPlus} iconClass="bg-jade-50 text-jade-700" />
      <form onSubmit={submit} className="px-4 sm:px-5 pb-5 space-y-3">
        <div className="grid gap-2 sm:grid-cols-2">
          <Input type="email" value={f.email} onChange={(e) => setF((x) => ({ ...x, email: e.target.value }))} placeholder="Gmail, ví dụ: ketoan@gmail.com" autoComplete="off" />
          <Input value={f.displayName} onChange={(e) => setF((x) => ({ ...x, displayName: e.target.value }))} placeholder="Tên gọi (tùy chọn), ví dụ: Kế toán Lan" />
        </div>
        <RolePicker value={f.role} onChange={(role) => setF((x) => ({ ...x, role }))} disabled={busy} />
        {err && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{err}</p>}
        <div className="flex justify-end">
          <Button type="submit" variant="primary" icon={UserPlus} loading={busy}>
            Cấp quyền
          </Button>
        </div>
      </form>
    </Card>
  );
}

function MemberRow({ m, actor, self }) {
  const toast = useToast();
  const confirm = useConfirm();
  const [busy, setBusy] = useState(false);
  const isOwner = m.role === 'OWNER';
  const run = async (fn, okMsg) => {
    setBusy(true);
    try {
      const b = new AuditedBatch(actor);
      fn(b);
      await b.commit();
      toast.success(okMsg);
    } catch (ex) {
      toast.error(friendlyError(ex));
    } finally {
      setBusy(false);
    }
  };
  const setRole = (role) =>
    role !== m.role && run((b) => b.update(C.members, m.id, { role }, m, `Đổi vai trò ${m.email}: ${ROLE_LABEL[m.role]} → ${ROLE_LABEL[role]}`), `Đã đổi vai trò của ${m.displayName || m.email}`);
  const toggle = () =>
    run(
      (b) => b.update(C.members, m.id, { active: !m.active }, m, `${m.active ? 'Khóa' : 'Mở khóa'} quyền truy cập của ${m.email}`),
      m.active ? 'Đã khóa — người này bị đóng màn hình ngay' : 'Đã mở khóa',
    );
  const remove = async () => {
    const ok = await confirm({
      title: `Xóa ${m.displayName || m.email} khỏi hệ thống?`,
      message: 'Người này sẽ không đăng nhập được nữa. Dữ liệu họ đã nhập vẫn được giữ nguyên.',
      confirmText: 'Xóa quyền truy cập',
      tone: 'danger',
    });
    if (ok) run((b) => b.remove(C.members, m.id, m, `Thu hồi & xóa quyền truy cập của ${m.email}`), 'Đã xóa quyền truy cập');
  };
  return (
    <li className="px-4 sm:px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-display font-semibold text-ink-900 truncate">
            {m.displayName || m.email} {self && <span className="text-xs font-normal text-slate-500">(bạn)</span>}
          </p>
          <p className="text-xs text-slate-500 truncate">{m.email}</p>
          <p className="text-xs text-slate-400">{m.lastSeenAt ? `Truy cập gần nhất ${fmtDateTime(m.lastSeenAt)}` : 'Chưa đăng nhập lần nào'}</p>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge tone={ROLE_TONE[m.role] || 'slate'}>{ROLE_LABEL[m.role]}</Badge>
          {!m.active && <Badge tone="red">Đã khóa</Badge>}
        </div>
      </div>
      {!isOwner && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Select value={m.role} onChange={(e) => setRole(e.target.value)} disabled={busy} className="w-auto">
            {ROLE_CHOICES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.title}
              </option>
            ))}
          </Select>
          <Button size="sm" onClick={toggle} loading={busy} icon={m.active ? Lock : LockOpen}>
            {m.active ? 'Khóa' : 'Mở khóa'}
          </Button>
          <Button size="sm" variant="dangerGhost" icon={Trash2} onClick={remove} disabled={busy}>
            Xóa
          </Button>
        </div>
      )}
    </li>
  );
}

function AccessPanel() {
  const { member, me, actor } = useAuth();
  const toast = useToast();
  const [members, setMembers] = useState(null);
  useEffect(
    () =>
      onSnapshot(
        collection(db, C.members),
        (s) =>
          setMembers(
            s.docs
              .map((d) => ({ id: d.id, ...d.data() }))
              .sort((a, b) => (a.role === 'OWNER' ? -1 : b.role === 'OWNER' ? 1 : (a.email || '').localeCompare(b.email || ''))),
          ),
        (ex) => toast.error(friendlyError(ex)),
      ),
    [toast],
  );

  return (
    <div className="grid gap-4 xl:grid-cols-3 items-start">
      <div className="xl:col-span-2 space-y-4">
        <AddMember members={members} actor={actor} />
        <Card>
          <CardHeader title="Thành viên" subtitle="Đổi vai trò, khóa hoặc xóa quyền — áp dụng ngay trên mọi thiết bị" icon={Users} iconClass="bg-orchid-50 text-orchid-600" />
          {members === null ? (
            <EmptyState title="Đang tải…" />
          ) : (
            <ul className="divide-y divide-slate-100 border-t border-slate-100">
              {members.map((m) => (
                <MemberRow key={m.id} m={m} actor={actor} self={m.id === me?.email} />
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <CardHeader title="Mỗi vai trò được làm gì" icon={ShieldCheck} />
          <TableWrap className="border-t border-slate-100">
            <table className="w-full">
              <thead className="bg-slate-50/80">
                <tr>
                  <th className={th}>Vai trò</th>
                  <th className={th}>Thấy và làm được</th>
                  <th className={th}>Bị chặn</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 text-sm">
                <tr>
                  <td className={td}>
                    <Badge tone="dark">Chủ doanh nghiệp</Badge>
                  </td>
                  <td className={td}>Toàn bộ, duyệt chi, phân quyền, nhật ký thao tác</td>
                  <td className={td}>—</td>
                </tr>
                <tr>
                  <td className={td}>
                    <Badge tone="blue">Đồng quản trị</Badge>
                  </td>
                  <td className={td}>Tiền mặt, vay ngân hàng, công nợ, duyệt chi, danh bạ NCC, điều phối tháng</td>
                  <td className={td}>Phân quyền, nhật ký</td>
                </tr>
                <tr>
                  <td className={td}>
                    <Badge tone="violet">Kế toán công nợ</Badge>
                  </td>
                  <td className={td}>Phải thu / phải trả, lệnh chi đã duyệt → đã chuyển tiền, danh bạ nhà cung cấp</td>
                  <td className={td}>Két tiền mặt, ngân hàng, điều phối tháng, duyệt chi, phân quyền, nhật ký; không xóa công nợ</td>
                </tr>
              </tbody>
            </table>
          </TableWrap>
          <p className="m-4 sm:m-5 rounded-xl bg-jade-50 px-4 py-3 text-xs text-jade-900 leading-relaxed">
            Quyền được kiểm tra ngay trên máy chủ Firebase (luật bảo mật), không chỉ ẩn trên giao diện: Kế toán không thể đọc két tiền mặt hay số liệu ngân hàng
            kể cả khi dùng công cụ lập trình.
          </p>
        </Card>
      </div>

      <div className="space-y-4">
        <Card>
          <CompanyNameEditor />
          <CardHeader title="Bạn đang đăng nhập" icon={Users} className="border-t border-slate-100" />
          <div className="px-4 sm:px-5 pb-4">
            <p className="text-sm font-semibold text-slate-900">{me?.name || 'Bạn'}</p>
            <p className="text-xs text-slate-500">{me?.email}</p>
            <Badge tone="dark" className="mt-1">
              {ROLE_LABEL[member?.role]}
            </Badge>
          </div>
        </Card>
        <ImportPanel />
      </div>
    </div>
  );
}

/* --------------------------------- Nhật ký --------------------------------- */
const PAGE = 100;

function AuditLog() {
  const toast = useToast();
  const [logs, setLogs] = useState([]);
  const [size, setSize] = useState(PAGE);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [action, setAction] = useState('ALL');
  const [coll, setColl] = useState('ALL');
  const [actor, setActor] = useState('ALL');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState({});
  const [source, setSource] = useState('live');

  const load = useCallback(
    async (n) => {
      setLoading(true);
      try {
        const s = await getDocs(query(collection(db, source === 'live' ? C.audit : C.archive), orderBy('at', 'desc'), limit(n)));
        setLogs(s.docs.map((d) => ({ id: d.id, ...d.data() })));
        setHasMore(s.size === n);
      } catch (ex) {
        toast.error(friendlyError(ex));
      } finally {
        setLoading(false);
      }
    },
    [source, toast],
  );

  useEffect(() => {
    load(size);
  }, [load, size]);

  const liveNames = useNames(source === 'live' ? logs.map((l) => l.actorEmail) : []);
  const names = useMemo(
    () => (source === 'live' ? liveNames : Object.fromEntries(logs.map((l) => [l.actorEmail, l.actorName || 'Người dùng bản cũ']))),
    [source, liveNames, logs],
  );
  const actors = useMemo(() => [...new Set(logs.map((l) => l.actorEmail).filter(Boolean))].map((id) => ({ id })), [logs]);
  const rows = useMemo(
    () =>
      logs
        .filter((l) => action === 'ALL' || l.action === action)
        .filter((l) => coll === 'ALL' || l.collection === coll)
        .filter((l) => actor === 'ALL' || l.actorEmail === actor)
        .filter((l) => matchSearch(`${names[l.actorEmail] || ''} ${l.summary}`, q)),
    [logs, action, coll, actor, q, names],
  );

  const exportXlsx = async () => {
    try {
      const nm = source === 'live' ? await resolveNames(rows.map((l) => l.actorEmail)) : names;
      await downloadXlsx(`Nhat-ky-he-thong_${new Date().toISOString().slice(0, 10)}`, [
        {
          name: 'Nhật ký',
          colWidths: [18, 28, 8, 22, 60, 70],
          rows: [
            ['Thời gian', 'Người thực hiện', 'Hành động', 'Đối tượng', 'Nội dung', 'Thay đổi (cũ → mới)'],
            ...rows.map((l) => [
              fmtDateTime(l.at),
              nm[l.actorEmail] || '',
              ACTION[l.action]?.label || l.action,
              COLLECTION_LABEL[l.collection] || l.collection,
              l.summary,
              (l.changes || []).map((c) => `${FIELD_LABEL[c.field] || c.field}: ${fmtValue(c.field, c.from)} → ${fmtValue(c.field, c.to)}`).join(' | '),
            ]),
          ],
        },
      ]);
      toast.success('Đã xuất file Excel');
    } catch (ex) {
      if (ex?.code !== 'declined') toast.error(friendlyError(ex));
    }
  };

  const Details = ({ l }) => {
    if (l.action === 'UPDATE') {
      return (
        <ul className="space-y-0.5">
          {(l.changes || []).length === 0 && <li className="text-slate-400">Không có thay đổi giá trị</li>}
          {(l.changes || []).map((c) => (
            <li key={c.field}>
              <span className="text-slate-500">{FIELD_LABEL[c.field] || c.field}:</span>{' '}
              <span className="money line-through decoration-rose-300 text-rose-700/80">{fmtValue(c.field, c.from)}</span> →{' '}
              <span className="money font-medium text-emerald-700">{fmtValue(c.field, c.to)}</span>
            </li>
          ))}
        </ul>
      );
    }
    const obj = l.action === 'CREATE' ? l.after : l.before;
    if (!obj) return null;
    return (
      <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-0.5">
        {Object.entries(obj)
          .filter(([k]) => FIELD_LABEL[k])
          .map(([k, v]) => (
            <li key={k}>
              <span className="text-slate-500">{FIELD_LABEL[k]}:</span> <span className="money text-slate-800">{fmtValue(k, v)}</span>
            </li>
          ))}
      </ul>
    );
  };

  return (
    <Card>
      <div className="flex flex-col gap-3 p-4 border-b border-slate-100 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-center gap-2 text-sm text-slate-600">
          <History className="h-4 w-4 shrink-0" /> Mỗi thay đổi số liệu đều kèm một dòng nhật ký; không ai sửa hay xóa được nhật ký.
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Select
            value={source}
            onChange={(e) => {
              setSource(e.target.value);
              setSize(PAGE);
            }}
            className="w-auto"
          >
            <option value="live">Nhật ký app</option>
            <option value="archive">Nhật ký cũ (bản claude.ai)</option>
          </Select>
          <Select value={actor} onChange={(e) => setActor(e.target.value)} className="w-auto">
            <option value="ALL">Mọi người</option>
            {actors.map((a) => (
              <option key={a.id} value={a.id}>
                {names[a.id] || 'Người dùng'}
              </option>
            ))}
          </Select>
          <Select value={action} onChange={(e) => setAction(e.target.value)} className="w-auto">
            <option value="ALL">Mọi hành động</option>
            <option value="CREATE">Thêm</option>
            <option value="UPDATE">Sửa</option>
            <option value="DELETE">Xóa</option>
          </Select>
          <Select value={coll} onChange={(e) => setColl(e.target.value)} className="w-auto">
            <option value="ALL">Mọi đối tượng</option>
            {Object.entries(COLLECTION_LABEL)
              .filter(([k]) => k !== 'members')
              .map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
          </Select>
          <div className="relative min-w-[200px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Tìm nội dung…" className="pl-9" />
          </div>
          <Button icon={FileSpreadsheet} onClick={exportXlsx} disabled={!rows.length}>
            Xuất Excel
          </Button>
        </div>
      </div>

      {rows.length === 0 && !loading ? (
        <EmptyState icon={History} title="Chưa có nhật ký phù hợp" />
      ) : (
        <TableWrap>
          <table className="w-full">
            <thead className="bg-slate-50/80">
              <tr>
                <th className={cx(th, 'w-8')} />
                <th className={th}>Thời gian</th>
                <th className={th}>Người thực hiện</th>
                <th className={th}>Hành động</th>
                <th className={th}>Nội dung</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {rows.map((l) => (
                <FragmentRow
                  key={`${l.actorEmail}-${l.id}`}
                  l={l}
                  name={names[l.actorEmail]}
                  open={!!open[l.id]}
                  onToggle={() => setOpen((o) => ({ ...o, [l.id]: !o[l.id] }))}
                  Details={Details}
                />
              ))}
            </tbody>
          </table>
        </TableWrap>
      )}
      <div className="flex justify-center p-4 border-t border-slate-100">
        {hasMore ? (
          <Button onClick={() => setSize((n) => n + PAGE)} loading={loading}>
            Tải thêm
          </Button>
        ) : (
          <span className="text-xs text-slate-400">Đã hiển thị toàn bộ nhật ký ({logs.length} dòng)</span>
        )}
      </div>
    </Card>
  );
}

function FragmentRow({ l, name, open, onToggle, Details }) {
  const a = ACTION[l.action] || { label: l.action, tone: 'slate' };
  return (
    <>
      <tr className="hover:bg-slate-50/70 cursor-pointer" onClick={onToggle}>
        <td className={cx(td, 'text-slate-400')}>{open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</td>
        <td className={cx(td, 'whitespace-nowrap tabular-nums text-slate-500 text-xs')}>{fmtDateTime(l.at)}</td>
        <td className={cx(td, 'text-sm font-medium text-slate-800 whitespace-nowrap')}>{name || 'Người dùng'}</td>
        <td className={td}>
          <Badge tone={a.tone}>{a.label}</Badge>
          <p className="mt-1 text-[11px] text-slate-500 whitespace-nowrap">{COLLECTION_LABEL[l.collection] || l.collection}</p>
        </td>
        <td className={cx(td, 'min-w-[280px]')}>
          <span className="money">{l.summary}</span>
        </td>
      </tr>
      {open && (
        <tr className="bg-slate-50/60">
          <td />
          <td colSpan={4} className="px-3 pb-3 pt-1 text-xs">
            <Details l={l} />
          </td>
        </tr>
      )}
    </>
  );
}

export default function Admin() {
  const [tab, setTab] = useState('access');
  return (
    <div>
      <PageHeader icon={ShieldCheck} tone="ink" title="Phân quyền & Nhật ký hệ thống" subtitle="Chỉ Chủ doanh nghiệp nhìn thấy trang này" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'access', label: 'Thành viên & phân quyền', icon: UserCog },
          { value: 'audit', label: 'Nhật ký thao tác (Audit Log)', icon: History },
        ]}
      />
      <div className="mt-4">{tab === 'access' ? <AccessPanel /> : <AuditLog />}</div>
    </div>
  );
}
