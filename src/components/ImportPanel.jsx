/**
 * Chuyển dữ liệu từ bản claude.ai sang app Firebase (chỉ Chủ doanh nghiệp).
 * Nhập lại nhiều lần vẫn an toàn: bản ghi đã có (cùng mã) sẽ được bỏ qua.
 */
import { useState } from 'react';
import { Timestamp, collection, doc, getDocs, setDoc, writeBatch } from 'firebase/firestore';
import { DatabaseZap, FileUp } from 'lucide-react';
import { db } from '../lib/firebase.js';
import { useAuth } from '../context/AuthContext.jsx';
import { AuditedBatch, C, COLLECTION_LABEL, friendlyError } from '../lib/db.js';
import { useToast } from './feedback.jsx';
import { Button, Card, CardHeader, cx } from './ui.jsx';

// Thứ tự nhập: bản ghi cha trước (thanh toán cần công nợ đã có)
const ORDER = ['banks', 'loans', 'cash_entries', 'partners', 'receivables', 'payables', 'payments', 'approvals', 'plan_snapshots'];
const DROP = new Set(['id', '_auditId', 'createdBy', 'updatedBy', 'createdByName', 'createdAt', 'updatedAt']);
const PER_BATCH = 4;

const toTs = (v) => (typeof v === 'number' && v > 0 ? Timestamp.fromMillis(v) : null);

function prepare(d, people) {
  const out = {};
  for (const [k, v] of Object.entries(d || {})) if (!DROP.has(k) && v !== undefined) out[k] = v;
  out.importedFrom = 'claude.ai';
  const who = d.createdBy && people?.[d.createdBy];
  if (who) out.importedCreatedByName = who;
  return out;
}

function summaryOf(coll, d) {
  const label = COLLECTION_LABEL[coll] || coll;
  const name = d.partnerName || d.name || d.contractNo || d.description || d.month || d.id;
  return `Nhập từ bản claude.ai — ${label}: ${name}`;
}

export function ImportPanel() {
  const { actor, role } = useAuth();
  const toast = useToast();
  const [file, setFile] = useState(null);
  const [data, setData] = useState(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null);
  const [result, setResult] = useState(null);
  if (role !== 'OWNER') return null;

  const pick = async (e) => {
    const f = e.target.files?.[0];
    setResult(null);
    if (!f) return;
    try {
      const j = JSON.parse(await f.text());
      if (j?.format !== 'dong-tien-backup' || !j.collections) throw new Error('File không đúng định dạng bản sao lưu của Quản lý Dòng tiền');
      setFile(f.name);
      setData(j);
    } catch (ex) {
      setData(null);
      toast.error(ex.message || 'Không đọc được file');
    }
  };

  const counts = data
    ? [...ORDER.map((k) => [k, (data.collections[k] || []).length]), ['plans', (data.collections.plans || []).length], ['audit', (data.audit || []).length]].filter(([, n]) => n > 0)
    : [];
  const total = counts.reduce((t, [, n]) => t + n, 0);

  const run = async () => {
    setBusy(true);
    const res = { created: 0, skipped: 0, failed: [] };
    let done = 0;
    const tick = (n = 1) => {
      done += n;
      setProgress({ done, total });
    };
    try {
      const people = data.people || {};
      // 1) Bản ghi tài chính — mỗi bản ghi kèm 1 dòng nhật ký "Nhập từ bản claude.ai"
      for (const coll of ORDER) {
        const list = data.collections[coll] || [];
        if (!list.length) continue;
        const existing = new Set((await getDocs(collection(db, coll))).docs.map((x) => x.id));
        const todo = list.filter((d) => {
          if (existing.has(d.id)) {
            res.skipped += 1;
            tick();
            return false;
          }
          return true;
        });
        for (let i = 0; i < todo.length; i += PER_BATCH) {
          const part = todo.slice(i, i + PER_BATCH);
          const tryBatch = async (items) => {
            const b = new AuditedBatch(actor);
            for (const d of items) b.create(coll, prepare(d, people), summaryOf(coll, d), { id: d.id, times: { createdAt: toTs(d.createdAt), updatedAt: toTs(d.updatedAt) } });
            await b.commit();
          };
          try {
            await tryBatch(part);
            res.created += part.length;
          } catch {
            // Thử từng bản ghi để biết bản ghi nào lỗi
            for (const d of part) {
              try {
                await tryBatch([d]);
                res.created += 1;
              } catch (ex) {
                res.failed.push(`${COLLECTION_LABEL[coll] || coll} — ${d.partnerName || d.name || d.contractNo || d.description || d.id}: ${friendlyError(ex)}`);
              }
            }
          }
          tick(part.length);
        }
      }
      // 2) Bản nháp kế hoạch tháng & cài đặt
      for (const p of data.collections.plans || []) {
        try {
          const { id, ...rest } = p;
          await setDoc(doc(db, C.plans, id), prepare(rest, people), { merge: true });
          res.created += 1;
        } catch (ex) {
          res.failed.push(`Bản nháp kế hoạch ${p.id}: ${friendlyError(ex)}`);
        }
        tick();
      }
      const st = data.settings || {};
      if (st.planner) await setDoc(doc(db, C.settings, 'planner'), { fixedTemplates: st.planner.fixedTemplates || [] }, { merge: true }).catch(() => {});
      if (st.companyName) await setDoc(doc(db, C.settings, 'company'), { companyName: st.companyName }, { merge: true }).catch(() => {});
      // 3) Nhật ký cũ — lưu riêng, chỉ đọc
      const logs = data.audit || [];
      if (logs.length) {
        const existing = new Set((await getDocs(collection(db, C.archive))).docs.map((x) => x.id));
        const todo = logs.filter((l) => !existing.has(l.id));
        res.skipped += logs.length - todo.length;
        tick(logs.length - todo.length);
        for (let i = 0; i < todo.length; i += 400) {
          const wb = writeBatch(db);
          for (const l of todo.slice(i, i + 400)) {
            const { id, ...rest } = l;
            wb.set(doc(db, C.archive, id), { ...rest, actorName: people[l.actorEmail] || rest.actorName || '', at: toTs(l.at) || Timestamp.now() });
          }
          try {
            await wb.commit();
            res.created += Math.min(400, todo.length - i);
          } catch (ex) {
            res.failed.push(`Nhật ký cũ: ${friendlyError(ex)}`);
          }
          tick(Math.min(400, todo.length - i));
        }
      }
      setResult(res);
      if (res.failed.length) toast.error(`Nhập xong, ${res.failed.length} mục bị lỗi — xem chi tiết bên dưới`);
      else toast.success(`Đã chuyển xong dữ liệu: ${res.created} mục mới, ${res.skipped} mục đã có`);
    } catch (ex) {
      toast.error(friendlyError(ex));
      setResult(res);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <CardHeader title="Chuyển dữ liệu từ bản claude.ai" subtitle="Làm một lần khi chuyển sang app riêng" icon={DatabaseZap} iconClass="bg-sapphire-50 text-sapphire-700" />
      <div className="px-4 sm:px-5 pb-5 space-y-3 text-sm">
        <ol className="list-decimal list-inside space-y-1 text-slate-600 leading-relaxed">
          <li>
            Mở bản cũ trên claude.ai → <b>Phân quyền &amp; Nhật ký</b> → <b>Tải bản sao lưu dữ liệu</b>.
          </li>
          <li>Chọn file vừa tải ở đây, rồi bấm Nhập dữ liệu.</li>
        </ol>
        <label className="flex cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-slate-300 px-3 py-4 text-slate-600 hover:border-sapphire-400 hover:bg-sapphire-50/40">
          <FileUp className="h-5 w-5" />
          <span>{file || 'Chọn file sao lưu (.json)'}</span>
          <input type="file" accept="application/json,.json" className="sr-only" onChange={pick} disabled={busy} />
        </label>
        {data && (
          <div className="rounded-xl bg-slate-50 px-3 py-2.5">
            <p className="text-xs text-slate-500">Sao lưu lúc {new Date(data.exportedAt).toLocaleString('vi-VN')}</p>
            <ul className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-slate-700">
              {counts.map(([k, n]) => (
                <li key={k} className="flex justify-between gap-2">
                  <span className="truncate">{k === 'audit' ? 'Nhật ký cũ' : COLLECTION_LABEL[k] || k}</span>
                  <b className="tabular-nums">{n}</b>
                </li>
              ))}
            </ul>
          </div>
        )}
        {progress && busy && (
          <div className="h-2 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={progress.done} aria-valuemax={progress.total}>
            <div className="h-full bg-sapphire-600 transition-all" style={{ width: `${Math.round((progress.done / Math.max(1, progress.total)) * 100)}%` }} />
          </div>
        )}
        <Button variant="primary" icon={DatabaseZap} className="w-full" onClick={run} disabled={!data} loading={busy}>
          Nhập dữ liệu
        </Button>
        {result && (
          <div className={cx('rounded-xl px-3 py-2.5 text-xs', result.failed.length ? 'bg-amber-50 text-amber-900' : 'bg-jade-50 text-jade-900')}>
            <p>
              Đã nhập <b>{result.created}</b> mục, bỏ qua <b>{result.skipped}</b> mục đã có.
            </p>
            {result.failed.length > 0 && (
              <ul className="mt-1 list-disc pl-4 space-y-0.5">
                {result.failed.map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
