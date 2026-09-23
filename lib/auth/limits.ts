import { sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { rateLimits } from '../../db/schema';
import { log } from '../log';

interface Bucket {
  count: number;
  resetAt: number;
}

const buckets = new Map<string, Bucket>();
const MAX_BUCKETS = 2000;

function sweepBuckets(now = Date.now()): void {
  for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
  if (buckets.size > MAX_BUCKETS) {
    const overflow = buckets.size - MAX_BUCKETS;
    let i = 0;
    for (const k of buckets.keys()) {
      if (i++ >= overflow) break;
      buckets.delete(k);
    }
  }
}

export interface RateLimitResult {
  ok: boolean;
  retryAfterSec: number;
  remaining?: number;
}

export function rateLimit(key: string, max: number, windowMs: number): RateLimitResult {
  if (!Number.isFinite(max) || max <= 0 || !Number.isInteger(max) || !Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError('Invalid rate limit config');
  const now = Date.now();
  sweepBuckets(now);
  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfterSec: 0, remaining: max - 1 };
  }
  bucket.count += 1;
  if (bucket.count > max) return { ok: false, retryAfterSec: Math.ceil((bucket.resetAt - now) / 1000), remaining: 0 };
  return { ok: true, retryAfterSec: 0, remaining: Math.max(0, max - bucket.count) };
}

export async function rateLimitShared(db: Db, key: string, max: number, windowMs: number): Promise<RateLimitResult> {
  if (!Number.isFinite(max) || max <= 0 || !Number.isInteger(max) || !Number.isFinite(windowMs) || windowMs <= 0) throw new RangeError('Invalid rate limit config');
  const now = new Date();
  const resetAt = new Date(now.getTime() + windowMs);
  try {
    const [row] = await db
      .insert(rateLimits)
      .values({ key, count: 1, resetAt })
      .onConflictDoUpdate({
        target: rateLimits.key,
        set: {
          count: sql`CASE WHEN ${rateLimits.resetAt} <= now() THEN 1 ELSE ${rateLimits.count} + 1 END`,
          resetAt: sql`CASE WHEN ${rateLimits.resetAt} <= now() THEN ${resetAt} ELSE ${rateLimits.resetAt} END`,
        },
      })
      .returning();
    if (!row) return rateLimit(key, max, windowMs);
    const isExceeded = row.count > max;
    const retryAfterSec = Math.max(0, Math.ceil((row.resetAt.getTime() - now.getTime()) / 1000));
    return { ok: !isExceeded, retryAfterSec: isExceeded ? retryAfterSec : 0, remaining: Math.max(0, max - row.count) };
  } catch (err) {
    log('warn', 'rate_limit_shared_fallback', { key, error: err instanceof Error ? err.message : String(err) });
    return rateLimit(key, max, windowMs);
  }
}

export function _resetLimits(): void {
  buckets.clear();
}
