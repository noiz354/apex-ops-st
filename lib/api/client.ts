export class ApiError extends Error {
  declare cause?: unknown;
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
    public readonly requestId?: string,
    public readonly details?: unknown,
    options?: { cause?: unknown },
  ) {
    super(message, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'ApiError';
    if (options?.cause !== undefined) this.cause = options.cause;
  }
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  headers?: Record<string, string>;
  timeoutMs?: number;
  signal?: AbortSignal;
  idempotencyKey?: string;
  traceparent?: string;
  credentials?: RequestCredentials;
}

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/;

const lastTrace: { current: string | null } = { current: null };
export function getLastTraceparent(): string | null {
  return lastTrace.current;
}

function getCrypto(): Crypto | undefined {
  const c = globalThis.crypto as Crypto | undefined;
  return c;
}

function randomHex(bytes: number): string {
  const g = getCrypto();
  if (g?.getRandomValues) {
    const buf = g.getRandomValues(new Uint8Array(bytes));
    return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
  }
  throw new Error('Secure random unavailable — crypto.getRandomValues required');
}

type AbortSignalWithTimeout = typeof AbortSignal & {
  timeout?: (ms: number) => AbortSignal;
};
type AbortSignalWithAny = typeof AbortSignal & {
  any?: (signals: AbortSignal[]) => AbortSignal;
};
type AbortSignalWithReason = AbortSignal & { reason?: unknown };

function getAbortReason(s: AbortSignal): unknown {
  return (s as AbortSignalWithReason).reason;
}

function makeTimeoutSignal(timeoutMs: number): { signal: AbortSignal; cancel: () => void } {
  const withTimeout = AbortSignal as AbortSignalWithTimeout;
  if (typeof withTimeout.timeout === 'function') {
    return { signal: withTimeout.timeout(timeoutMs), cancel: () => {} };
  }
  const controller = new AbortController();
  const t = setTimeout(() => controller.abort(new DOMException('TimeoutError', 'TimeoutError')), timeoutMs);
  return { signal: controller.signal, cancel: () => clearTimeout(t) };
}

function combineSignals(a: AbortSignal | undefined, b: AbortSignal): AbortSignal {
  if (!a) return b;
  if (a.aborted) return a;
  if (b.aborted) return b;
  const withAny = AbortSignal as AbortSignalWithAny;
  if (typeof withAny.any === 'function') return withAny.any([a, b]);
  const controller = new AbortController();
  const onAbort = () => {
    const reason = getAbortReason(a) ?? getAbortReason(b);
    try {
      controller.abort(reason);
    } catch {
      controller.abort();
    }
    a.removeEventListener('abort', onAbort);
    b.removeEventListener('abort', onAbort);
  };
  a.addEventListener('abort', onAbort);
  b.addEventListener('abort', onAbort);
  return controller.signal;
}

type ApiErrorBody = { code?: unknown; message?: unknown; details?: unknown };
type ApiEnvelope = { ok: unknown; data?: unknown; error?: ApiErrorBody };

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null;
}
function isEnvelope(v: unknown): v is ApiEnvelope {
  return isRecord(v) && 'ok' in v;
}

export async function apiFetch<T = unknown>(input: string, opts: ApiFetchOptions = {}): Promise<T> {
  const method = (opts.method ?? 'GET').toUpperCase();
  const timeoutMs = opts.timeoutMs ?? (method === 'GET' || method === 'HEAD' ? 15_000 : 30_000);
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new ApiError('BAD_TIMEOUT', 'timeoutMs harus angka positif', 0);
  }
  const timeout = makeTimeoutSignal(timeoutMs);
  const signal = combineSignals(opts.signal, timeout.signal);

  const headers = new Headers(opts.headers);
  const hasContentType = headers.has('content-type');

  let body: BodyInit | undefined;
  const rawBody = opts.body;
  const isJsonBody =
    rawBody !== undefined &&
    rawBody !== null &&
    !(rawBody instanceof FormData) &&
    !(rawBody instanceof Blob) &&
    !(rawBody instanceof ArrayBuffer) &&
    !(rawBody instanceof URLSearchParams) &&
    typeof rawBody !== 'string';
  if (isJsonBody) {
    if (!hasContentType) headers.set('content-type', 'application/json');
    body = JSON.stringify(rawBody);
  } else if (rawBody !== undefined && rawBody !== null) {
    body = rawBody as BodyInit;
  }

  if (method !== 'GET' && method !== 'HEAD') {
    if (!headers.has('idempotency-key')) {
      const g = getCrypto();
      const minted =
        opts.idempotencyKey ??
        (g && 'randomUUID' in g && typeof (g as Crypto & { randomUUID?: () => string }).randomUUID === 'function'
          ? (g as Crypto & { randomUUID: () => string }).randomUUID()
          : randomHex(16));
      headers.set('idempotency-key', minted);
    } else if (opts.idempotencyKey) {
      headers.set('idempotency-key', opts.idempotencyKey);
    }
  }

  const prev = opts.traceparent ?? lastTrace.current;
  const validPrev = prev !== null && prev !== undefined && TRACEPARENT_RE.test(prev);
  const traceId = validPrev ? prev!.split('-')[1] : randomHex(16);
  const parentId = randomHex(8);
  headers.set('traceparent', `00-${traceId}-${parentId}-01`);

  let res: Response;
  try {
    res = await fetch(input, { method, headers, body, signal, credentials: opts.credentials ?? 'same-origin' });
  } catch (err) {
    timeout.cancel();
    const abortedByCaller = opts.signal?.aborted === true;
    const name = err instanceof Error ? err.name : '';
    if (abortedByCaller || name === 'AbortError' || name === 'TimeoutError') {
      throw new ApiError(
        abortedByCaller ? 'ABORTED' : 'TIMEOUT',
        abortedByCaller ? 'Request dibatalkan.' : `Request timeout setelah ${Math.round(timeoutMs / 1000)}s — jaringan lambat/offline.`,
        0,
        undefined,
        undefined,
        { cause: err },
      );
    }
    throw new ApiError('NETWORK', 'Network error — server tidak terjangkau.', 0, undefined, undefined, { cause: err });
  }

  const tp = res.headers.get('traceparent');
  if (tp && TRACEPARENT_RE.test(tp)) lastTrace.current = tp;
  const requestId = res.headers.get('x-request-id') ?? undefined;

  if (res.status === 204 || res.status === 304) {
    timeout.cancel();
    if (res.ok) return null as T;
    throw new ApiError(`HTTP_${res.status}`, res.statusText || 'Request failed', res.status, requestId);
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch (err) {
    timeout.cancel();
    const name = err instanceof Error ? err.name : '';
    const abortedByCaller = opts.signal?.aborted === true;
    if (name === 'AbortError' || abortedByCaller) {
      throw new ApiError(abortedByCaller ? 'ABORTED' : 'TIMEOUT', abortedByCaller ? 'Request dibatalkan.' : `Request timeout setelah ${Math.round(timeoutMs / 1000)}s — jaringan lambat/offline.`, 0, requestId, undefined, { cause: err });
    }
    if (res.ok) {
      throw new ApiError('BAD_RESPONSE', 'Respons server bukan JSON yang valid.', res.status, requestId, undefined, { cause: err });
    }
    timeout.cancel();
    throw new ApiError(`HTTP_${res.status}`, res.statusText || 'Request failed', res.status, requestId);
  }
  timeout.cancel();

  if (isEnvelope(payload)) {
    if (res.ok) {
      if (payload.ok === true) return payload.data as T;
      if (payload.ok === false) {
        const e = payload.error;
        const code = typeof e?.code === 'string' && e.code ? e.code : `HTTP_${res.status}`;
        const message = typeof e?.message === 'string' && e.message ? e.message : res.statusText || 'Request failed';
        throw new ApiError(code, message, res.status, requestId, e?.details);
      }
      throw new ApiError('BAD_RESPONSE', 'Format respons tidak sesuai kontrak { ok, data }.', res.status, requestId, payload);
    }
    const e = payload.error;
    if (e && (typeof e.code === 'string' || typeof e.message === 'string')) {
      const code = typeof e.code === 'string' && e.code ? e.code : `HTTP_${res.status}`;
      const message = typeof e.message === 'string' && e.message ? e.message : res.statusText || 'Request failed';
      throw new ApiError(code, message, res.status, requestId, e.details);
    }
  } else if (res.ok) {
    throw new ApiError('BAD_RESPONSE', 'Format respons tidak sesuai kontrak { ok, data }.', res.status, requestId, payload);
  }

  throw new ApiError(`HTTP_${res.status}`, res.statusText || 'Request failed', res.status, requestId, isEnvelope(payload) ? payload.error : payload);
}
