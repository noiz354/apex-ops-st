import { has } from '../platform/capability';

export interface RumEvent {
  kind: 'webvital' | 'mark' | 'longtask' | 'error';
  name: string;
  value: number;
  ts: number;
  route: string;
  meta?: Record<string, unknown>;
}

const MAX_BUFFER = 40;
const FLUSH_INTERVAL_MS = 5000;
const MAX_EVENTS_PER_SESSION = 200;

let initialized = false;
let buffer: RumEvent[] = [];
let sentCount = 0;
let flushTimer: number | undefined;
let clsValue = 0;
let worstInpMs = 0;
let lcpReported = false;

export function normalizeRoute(pathname: string): string {
  return pathname
    .split('/')
    .map((seg) => (/^\d+$/.test(seg) ? ':id' : seg))
    .join('/');
}

function currentRoute(): string {
  try {
    return normalizeRoute(window.location.pathname);
  } catch {
    return 'unknown';
  }
}

function push(e: Omit<RumEvent, 'ts' | 'route'>): void {
  if (sentCount + buffer.length >= MAX_EVENTS_PER_SESSION) return;
  buffer.push({ ...e, ts: Date.now(), route: currentRoute() });
  if (buffer.length >= MAX_BUFFER) flush();
  else schedule();
}

export function mark(name: string, value = 0, meta?: Record<string, unknown>): void {
  push({ kind: 'mark', name, value, meta });
}

function schedule(): void {
  if (flushTimer !== undefined) return;
  flushTimer = window.setTimeout(flush, FLUSH_INTERVAL_MS);
}

export function flush(): void {
  if (flushTimer !== undefined) {
    clearTimeout(flushTimer);
    flushTimer = undefined;
  }
  if (clsValue > 0) {
    buffer.push({ kind: 'webvital', name: 'CLS', value: Math.round(clsValue * 1000) / 1000, ts: Date.now(), route: currentRoute() });
    clsValue = 0;
  }
  if (worstInpMs > 0) {
    buffer.push({ kind: 'webvital', name: 'INP', value: Math.round(worstInpMs), ts: Date.now(), route: currentRoute() });
    worstInpMs = 0;
  }
  if (buffer.length === 0) return;
  const events = buffer;
  buffer = [];
  sentCount += events.length;
  const payload = JSON.stringify({ events });
  try {
    if (has.sendBeacon() && navigator.sendBeacon('/api/telemetry/rum', new Blob([payload], { type: 'application/json' }))) return;
  } catch { void 0; }
  fetch('/api/telemetry/rum', { method: 'POST', body: payload, headers: { 'content-type': 'application/json' }, keepalive: true }).catch(() => {});
}

export function initRum(): () => void {
  if (initialized || typeof window === 'undefined') return () => {};
  initialized = true;
  const observers: PerformanceObserver[] = [];
  try {
    if (has.performanceObserver('largest-contentful-paint')) {
      const po = new PerformanceObserver((list) => {
        const entries = list.getEntries();
        const last = entries[entries.length - 1];
        if (last && !lcpReported) {
          lcpReported = true;
          push({ kind: 'webvital', name: 'LCP', value: Math.round(last.startTime) });
        }
      });
      po.observe({ type: 'largest-contentful-paint', buffered: true });
      observers.push(po);
    }
    if (has.performanceObserver('layout-shift')) {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries() as unknown as Array<{ hadRecentInput?: boolean; value?: number }>) {
          if (!entry.hadRecentInput) clsValue += entry.value ?? 0;
        }
      });
      po.observe({ type: 'layout-shift', buffered: true });
      observers.push(po);
    }
    if (has.performanceObserver('event')) {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          const dur = entry.duration ?? 0;
          if (dur > worstInpMs) worstInpMs = dur;
        }
      });
      try {
        po.observe({ type: 'event', buffered: true, durationThreshold: 16 } as PerformanceObserverInit);
      } catch {
        po.observe({ type: 'event', buffered: true });
      }
      observers.push(po);
    }
    if (has.performanceObserver('longtask')) {
      const po = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) push({ kind: 'longtask', name: 'longtask', value: Math.round(entry.duration) });
      });
      po.observe({ type: 'longtask', buffered: true });
      observers.push(po);
    }
  } catch { void 0; }
  const onError = (e: ErrorEvent) => push({ kind: 'error', name: 'window_error', value: 1, meta: { message: String(e.message).slice(0, 200) } });
  const onRejection = (e: PromiseRejectionEvent) => push({ kind: 'error', name: 'unhandled_rejection', value: 1, meta: { message: String(e.reason instanceof Error ? e.reason.message : e.reason).slice(0, 200) } });
  const onPageHide = () => flush();
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') flush();
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);
  window.addEventListener('pagehide', onPageHide);
  document.addEventListener('visibilitychange', onVisibility);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
    window.removeEventListener('pagehide', onPageHide);
    document.removeEventListener('visibilitychange', onVisibility);
    for (const po of observers) po.disconnect();
    flush();
    initialized = false;
  };
}
