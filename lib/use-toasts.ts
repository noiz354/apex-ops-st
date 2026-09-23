import { useCallback, useEffect, useRef, useState } from 'react';

export interface Toast {
  id: number;
  ok: boolean;
  title: string;
  msg: string;
  retry?: boolean;
}

let toastSeq = 1;

export function useToasts(timeoutMs = 8000) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>());
  const push = useCallback(
    (ok: boolean, title: string, msg: string, retry = false) => {
      const id = toastSeq++;
      setToasts((prev) => {
        const next = [...prev, { id, ok, title, msg, retry }];
        const overflow = next.length - 3;
        if (overflow > 0) {
          for (let i = 0; i < overflow; i++) {
            const t = timers.current.get(next[i].id);
            if (t !== undefined) {
              clearTimeout(t);
              timers.current.delete(next[i].id);
            }
          }
          return next.slice(overflow);
        }
        return next;
      });
      const timer = setTimeout(() => {
        timers.current.delete(id);
        setToasts((t) => t.filter((x) => x.id !== id));
      }, timeoutMs);
      timers.current.set(id, timer);
    },
    [timeoutMs],
  );
  const dismiss = useCallback((id: number) => {
    const t = timers.current.get(id);
    if (t !== undefined) {
      clearTimeout(t);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);
  const defer = useCallback((fn: () => void, ms: number) => {
    const timer = setTimeout(fn, ms);
    return () => clearTimeout(timer);
  }, []);
  useEffect(
    () => () => {
      for (const t of timers.current.values()) clearTimeout(t);
      timers.current.clear();
    },
    [],
  );
  return { toasts, push, dismiss, defer };
}
