import { randomBytes } from 'crypto';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

export interface LogFields {
  traceId?: string;
  spanId?: string;
  requestId?: string;
  userId?: string;
  orgId?: string;
  op?: string;
  method?: string;
  path?: string;
  status?: number;
  durationMs?: number;
  errorCode?: string;
  [key: string]: unknown;
}

function currentLogLevel(): LogLevel {
  const envLevel = (process.env.LOG_LEVEL || 'info').toLowerCase() as LogLevel;
  return LEVEL_PRIORITY[envLevel] !== undefined ? envLevel : 'info';
}

export function log(level: LogLevel, msg: string, fields: LogFields = {}): void {
  const threshold = LEVEL_PRIORITY[currentLogLevel()];
  if (LEVEL_PRIORITY[level] < threshold) return;

  const line = JSON.stringify({
    ts: new Date().toISOString(),
    level,
    msg,
    trace_id: fields.traceId ?? fields.requestId ?? newTraceId(),
    span_id: fields.spanId ?? newSpanId(),
    ...fields,
  });

  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

export function newRequestId(): string {
  return crypto.randomUUID();
}

export function newTraceId(): string {
  return randomBytes(16).toString('hex');
}

export function newSpanId(): string {
  return randomBytes(8).toString('hex');
}

export function formatTraceparent(traceId: string, spanId: string): string {
  return `00-${traceId}-${spanId}-01`;
}

