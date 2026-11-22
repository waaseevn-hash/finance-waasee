import { useEffect, useState } from 'react';
import { resolveNames } from '../lib/runtime.js';

/** Tên thành viên theo email */
export function useNames(ids) {
  const key = [...new Set((ids || []).filter(Boolean))].sort().join(',');
  const [map, setMap] = useState({});
  useEffect(() => {
    let alive = true;
    if (!key) return undefined;
    resolveNames(key.split(',')).then((m) => alive && setMap(m));
    return () => {
      alive = false;
    };
  }, [key]);
  return map;
}

export function Who({ id, fallback = 'Người dùng' }) {
  const names = useNames([id]);
  return <>{(id && names[id]) || fallback}</>;
}
