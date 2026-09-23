import { NextResponse, type NextRequest } from 'next/server';
import { ZodError } from 'zod';
import { getDb } from '../../db/client';
import { formatTraceparent, log, newRequestId, newSpanId, newTraceId } from '../log';
import { getSessionContext, type AuthContext } from '../auth/context';
import { can, type Permission } from '../auth/rbac';
import { DomainError } from '../domain/errors';
import { recordRequestMetric } from '../telemetry/metrics';
import { checkEtagMatch, computeEtag } from './etag';

export { DomainError };

const TRACEPARENT_RE = /^00-[0-9a-f]{32}-[0-9a-f]{16}-[0-9a-f]{2}$/i;
const TRACE_ZERO = /^0+$/;

function parseTraceparent(header: string | null): string {
  if (!header || !TRACEPARENT_RE.test(header)) return newTraceId();
  const traceId = header.split('-')[1];
  const parentId = header.split('-')[2];
  if (TRACE_ZERO.test(traceId) || TRACE_ZERO.test(parentId)) return newTraceId();
  return traceId.toLowerCase();
}

export interface RouteMeta {
  op: string;
  method: string;
  permission?: Permission;
  public?: boolean;
  etag?: boolean;
}

export interface RouteResult<T> {
  status?: number;
  data: T;
  setCookie?: { name: string; value: string; options: Record<string, unknown> } | null;
  clearCookie?: string | null;
}

export type RouteHandler<T> = (ctx: AuthContext | null, requestId: string) => Promise<RouteResult<T>>;

function csrfFailure(req: NextRequest): boolean {
  if (req.method === 'GET' || req.method === 'HEAD') return false;
  const site = req.headers.get('sec-fetch-site');
  if (site === 'cross-site') return true;
  const origin = req.headers.get('origin');
  if (!origin) return false;
  const host = req.headers.get('host');
  try {
    return new URL(origin).host !== host;
  } catch {
    return true;
  }
}

export async function withRoute<T>(
  meta: RouteMeta,
  req: NextRequest,
  handler: RouteHandler<T>,
): Promise<NextResponse> {
  const requestId = newRequestId();
  const traceparent = req.headers.get('traceparent');
  const traceId = parseTraceparent(traceparent);
  const spanId = newSpanId();

  const started = Date.now();
  const path = new URL(req.url).pathname;

  const finish = (status: number, body: unknown, extra: Record<string, unknown> = {}, etag?: string) => {
    const durationMs = Date.now() - started;
    recordRequestMetric({ route: path, method: meta.method, status, durationMs });
    log(status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info', 'api_request', {
      traceId, spanId, requestId, op: meta.op, method: meta.method, path, status,
      durationMs, ...extra,
    });
    const headers: Record<string, string> = {
      'x-request-id': requestId,
      'traceparent': formatTraceparent(traceId, spanId),
      'Server-Timing': `app;dur=${durationMs}`,
    };
    if (etag) {
      headers['ETag'] = etag;
      headers['Cache-Control'] = 'private, no-cache, must-revalidate';
    }
    if (status === 304) return new NextResponse(null, { status, headers });
    return NextResponse.json(body, { status, headers });
  };

  try {
    if (csrfFailure(req)) {
      return finish(403, { ok: false, error: { code: 'CSRF_ORIGIN_MISMATCH', message: 'Cross-origin mutation rejected', requestId } });
    }

    let ctx: AuthContext | null = null;
    try {
      ctx = await getSessionContext();
    } catch {
      ctx = null;
    }

    if (!meta.public) {
      if (!ctx) {
        return finish(401, { ok: false, error: { code: 'UNAUTHENTICATED', message: 'Sign in required', requestId } });
      }
      if (meta.permission && !can(ctx.role, meta.permission)) {
        return finish(403, {
          ok: false,
          error: { code: 'FORBIDDEN', message: `Role '${ctx.role}' lacks permission '${meta.permission}'`, requestId },
        }, { userId: ctx.userId, orgId: ctx.orgId, errorCode: 'FORBIDDEN' });
      }
    }

    const result = await handler(ctx, requestId);
    const envelope = { ok: true, data: result.data };
    let etag: string | undefined;
    if (meta.etag && meta.method === 'GET') {
      etag = computeEtag(envelope);
      if (checkEtagMatch(req, etag)) {
        return finish(304, undefined, ctx ? { userId: ctx.userId, orgId: ctx.orgId } : {}, etag);
      }
    }
    const response = finish(result.status ?? 200, envelope, ctx ? { userId: ctx.userId, orgId: ctx.orgId } : {}, etag);
    if (result.setCookie) {
      response.cookies.set(result.setCookie.name, result.setCookie.value, result.setCookie.options as unknown as Parameters<NonNullable<ReturnType<typeof NextResponse.json>>['cookies']['set']>[2]);
    }
    if (result.clearCookie) {
      response.cookies.set(result.clearCookie, '', { path: '/', maxAge: 0 });
    }
    return response;
  } catch (err) {
    if (err instanceof ZodError) {
      return finish(400, {
        ok: false,
        error: { code: 'VALIDATION_ERROR', message: 'Invalid request body', details: err.issues, requestId },
      }, { errorCode: 'VALIDATION_ERROR' });
    }
    if (err instanceof DomainError) {
      return finish(err.status, {
        ok: false,
        error: { code: err.code, message: err.message, details: err.details, requestId },
      }, { errorCode: err.code });
    }
    log('error', 'api_unhandled', { requestId, op: meta.op, path, error: err instanceof Error ? err.stack : String(err) });
    return finish(500, { ok: false, error: { code: 'INTERNAL', message: 'Unexpected server error', requestId } }, { errorCode: 'INTERNAL' });
  }
}

export function requireDb() {
  return getDb();
}
