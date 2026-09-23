'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type UIEvent } from 'react';

export interface WindowSlice<T> {
  items: T[];
  offset: number;
  topPad: number;
  bottomPad: number;
  onScroll: (e: UIEvent<HTMLElement>) => void;
  containerRef: React.RefObject<HTMLElement | null>;
  total: number;
  windowed: boolean;
}

export interface UseWindowOptions {
  rowHeight: number;
  overscan?: number;
  threshold?: number;
  initialHeight?: number;
}

export function useWindow<T>(all: T[], opts: UseWindowOptions): WindowSlice<T> {
  const { rowHeight, overscan = 8, threshold = 60, initialHeight = 640 } = opts;
  if (!Number.isFinite(rowHeight) || rowHeight <= 0 || !Number.isInteger(overscan) || overscan < 0 || !Number.isInteger(threshold) || threshold < 0 || !Number.isFinite(initialHeight) || initialHeight <= 0) throw new RangeError('Invalid window config');
  const containerRef = useRef<HTMLElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [height, setHeight] = useState(initialHeight);
  const total = all.length;
  const windowed = total > threshold;
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setHeight(el.clientHeight || initialHeight);
    measure();
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure);
      ro.observe(el);
      return () => ro.disconnect();
    }
    window.addEventListener('resize', measure);
    return () => window.removeEventListener('resize', measure);
  }, [initialHeight]);
  const prevLen = useRef(total);
  useEffect(() => {
    if (prevLen.current !== total) {
      prevLen.current = total;
      const el = containerRef.current;
      if (el) {
        const maxScrollTop = Math.max(0, total * rowHeight - height);
        const next = Math.min(el.scrollTop, maxScrollTop);
        el.scrollTop = next;
        setScrollTop(next);
      } else {
        setScrollTop((st) => Math.min(st, Math.max(0, total * rowHeight - height)));
      }
    }
  }, [total, rowHeight, height]);
  const onScroll = useCallback((e: UIEvent<HTMLElement>) => setScrollTop(e.currentTarget.scrollTop), []);
  return useMemo(() => {
    if (!windowed) return { items: all, offset: 0, topPad: 0, bottomPad: 0, onScroll, containerRef, total, windowed: false };
    const visible = Math.ceil(height / rowHeight);
    const windowSize = visible + overscan * 2;
    const start = Math.max(0, Math.floor(scrollTop / rowHeight) - overscan);
    const realStart = Math.min(start, Math.max(0, total - windowSize));
    const realEnd = Math.min(total, realStart + windowSize);
    return { items: all.slice(realStart, realEnd), offset: realStart, topPad: realStart * rowHeight, bottomPad: (total - realEnd) * rowHeight, onScroll, containerRef, total, windowed: true };
  }, [all, height, overscan, rowHeight, scrollTop, total, windowed]);
}
