import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react';
import { Button, Modal, cx } from './ui.jsx';

/* ============================ TOAST ============================ */
const ToastContext = createContext(() => {});

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const seq = useRef(0);

  const push = useCallback((message, type = 'success') => {
    seq.current += 1;
    const id = seq.current;
    setItems((xs) => [...xs, { id, message, type }]);
    setTimeout(() => setItems((xs) => xs.filter((x) => x.id !== id)), type === 'error' ? 7000 : 3500);
  }, []);

  const api = useMemo(
    () => ({
      success: (m) => push(m, 'success'),
      error: (m) => push(m, 'error'),
      info: (m) => push(m, 'info'),
    }),
    [push],
  );

  const ICON = { success: CircleCheck, error: CircleAlert, info: Info };
  const TONE = {
    success: 'border-emerald-200 bg-white text-slate-800 [&_svg.lead]:text-emerald-600',
    error: 'border-rose-200 bg-white text-slate-800 [&_svg.lead]:text-rose-600',
    info: 'border-blue-200 bg-white text-slate-800 [&_svg.lead]:text-blue-600',
  };

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="fixed z-[70] top-3 inset-x-3 sm:inset-x-auto sm:right-4 sm:top-auto sm:bottom-4 flex flex-col gap-2 sm:w-96 pointer-events-none">
        {items.map((t) => {
          const Icon = ICON[t.type];
          return (
            <div key={t.id} className={cx('pointer-events-auto flex items-start gap-3 rounded-xl border px-4 py-3 shadow-lg text-sm', TONE[t.type])}>
              <Icon className="lead h-5 w-5 shrink-0 mt-px" />
              <span className="flex-1">{t.message}</span>
              <button type="button" onClick={() => setItems((xs) => xs.filter((x) => x.id !== t.id))} className="text-slate-400 hover:text-slate-700">
                <X className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

/* =========================== CONFIRM =========================== */
const ConfirmContext = createContext(async () => false);

/**
 * const confirm = useConfirm();
 * if (await confirm({ title, message, confirmText, tone: 'danger' })) { ... }
 */
export function ConfirmProvider({ children }) {
  const [state, setState] = useState(null);
  const resolver = useRef(null);

  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => {
        resolver.current = resolve;
        setState(opts);
      }),
    [],
  );

  const close = (val) => {
    resolver.current?.(val);
    resolver.current = null;
    setState(null);
  };

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      <Modal
        open={!!state}
        onClose={() => close(false)}
        title={state?.title || 'Xác nhận'}
        size="sm"
        z="z-[60]"
        footer={
          <>
            <Button onClick={() => close(false)}>{state?.cancelText || 'Hủy'}</Button>
            <Button variant={state?.tone === 'danger' ? 'danger' : 'primary'} onClick={() => close(true)}>
              {state?.confirmText || 'Đồng ý'}
            </Button>
          </>
        }
      >
        <div className="flex gap-3">
          {state?.tone === 'danger' && (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-rose-50 text-rose-600">
              <TriangleAlert className="h-5 w-5" />
            </span>
          )}
          <div className="text-sm text-slate-600 leading-relaxed">{state?.message}</div>
        </div>
      </Modal>
    </ConfirmContext.Provider>
  );
}

export function useConfirm() {
  return useContext(ConfirmContext);
}
