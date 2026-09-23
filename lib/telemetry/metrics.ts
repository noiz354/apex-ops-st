interface MetricEntry {
  route: string;
  method: string;
  status: number;
  durationMs: number;
  timestamp: number;
}

const MAX_WINDOW_ENTRIES = 5000;
const entries: MetricEntry[] = [];

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) throw new RangeError('empty');
  const idx = Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1));
  return sorted[idx];
}

export function recordRequestMetric(metric: {
  route: string;
  method: string;
  status: number;
  durationMs: number;
}): void {
  if (!Number.isFinite(metric.durationMs) || metric.durationMs < 0) throw new RangeError('Invalid duration');
  if (!Number.isInteger(metric.status) || metric.status < 100 || metric.status > 599) throw new RangeError('Invalid status');
  const route = metric.route.length > 200 ? metric.route.slice(0, 200) : metric.route;
  entries.push({ ...metric, route, timestamp: Date.now() });
  if (entries.length > MAX_WINDOW_ENTRIES) entries.splice(0, entries.length - MAX_WINDOW_ENTRIES);
}

export interface RouteRedSummary {
  route: string;
  totalRequests: number;
  errorCount: number;
  serverErrorCount: number;
  errorRatePct: number;
  avgDurationMs: number;
  p95DurationMs: number;
  lastSeenIso: string;
  demo?: boolean;
}

export function getRedMetrics(): {
  windowSeconds: number;
  totalRequests: number;
  globalErrorRatePct: number;
  routes: RouteRedSummary[];
} {
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  const activeEntries = entries.filter((e) => e.timestamp <= now && e.timestamp >= now - windowMs);
  const byRoute = new Map<string, MetricEntry[]>();
  for (const entry of activeEntries) {
    const list = byRoute.get(entry.route) ?? [];
    list.push(entry);
    byRoute.set(entry.route, list);
  }
  const routes: RouteRedSummary[] = [];
  let globalErrors = 0;
  let globalServerErrors = 0;
  for (const [route, routeEntries] of byRoute.entries()) {
    const total = routeEntries.length;
    const errors = routeEntries.filter((e) => e.status >= 400).length;
    const serverErrors = routeEntries.filter((e) => e.status >= 500).length;
    globalErrors += errors;
    globalServerErrors += serverErrors;
    const durations = routeEntries.map((e) => e.durationMs).sort((a, b) => a - b);
    const sumDuration = durations.reduce((a, b) => a + b, 0);
    const avgDuration = Math.round((sumDuration / Math.max(1, total)) * 10) / 10;
    const p95Duration = durations.length ? percentile(durations, 0.95) : avgDuration;
    const lastTimestamp = routeEntries.length ? Math.max(...routeEntries.map((e) => e.timestamp)) : now;
    routes.push({
      route,
      totalRequests: total,
      errorCount: errors,
      serverErrorCount: serverErrors,
      errorRatePct: Number(((errors / total) * 100).toFixed(1)),
      avgDurationMs: avgDuration,
      p95DurationMs: p95Duration,
      lastSeenIso: new Date(lastTimestamp).toISOString(),
    });
  }
  if (routes.length === 0) {
    return { windowSeconds: windowMs / 1000, totalRequests: 0, globalErrorRatePct: 0, routes: [] };
  }
  void globalServerErrors;
  const totalReqs = activeEntries.length;
  const totalErrs = globalErrors;
  return {
    windowSeconds: windowMs / 1000,
    totalRequests: totalReqs,
    globalErrorRatePct: Number(((totalErrs / Math.max(1, totalReqs)) * 100).toFixed(2)),
    routes,
  };
}

/**
 * 
 * This is for demo purposes, will be removed after release 
 * @param fixedIso 
 * @returns 
 */
export function getDemoRedMetrics(fixedIso?: string): {
  windowSeconds: number;
  totalRequests: number;
  globalErrorRatePct: number;
  routes: RouteRedSummary[];
} {
  const iso = fixedIso ?? '2026-01-01T00:00:00.000Z';
  const routes: RouteRedSummary[] = [
    { route: '/api/work-orders', totalRequests: 142, errorCount: 0, serverErrorCount: 0, errorRatePct: 0.0, avgDurationMs: 42.1, p95DurationMs: 88.4, lastSeenIso: iso, demo: true },
    { route: '/api/service-requests', totalRequests: 86, errorCount: 1, serverErrorCount: 1, errorRatePct: 1.1, avgDurationMs: 38.6, p95DurationMs: 74.0, lastSeenIso: iso, demo: true },
    { route: '/api/audit-trail', totalRequests: 215, errorCount: 0, serverErrorCount: 0, errorRatePct: 0.0, avgDurationMs: 18.2, p95DurationMs: 34.5, lastSeenIso: iso, demo: true },
    { route: '/api/health', totalRequests: 420, errorCount: 0, serverErrorCount: 0, errorRatePct: 0.0, avgDurationMs: 4.8, p95DurationMs: 12.1, lastSeenIso: iso, demo: true },
  ];
  const totalReqs = routes.reduce((a, b) => a + b.totalRequests, 0);
  const totalErrs = routes.reduce((a, b) => a + b.errorCount, 0);
  return {
    windowSeconds: 15 * 60,
    totalRequests: totalReqs,
    globalErrorRatePct: Number(((totalErrs / Math.max(1, totalReqs)) * 100).toFixed(2)),
    routes,
  };
}
