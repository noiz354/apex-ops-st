import { createHash } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { Tx } from '../../db/client';
import { idempotencyKeys } from '../../db/schema';
import { DomainError } from '../domain/errors';

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(src).sort()) out[k] = canonical(src[k]);
    return out;
  }
  return value;
}

export function requestHash(body: unknown): string {
  return createHash('sha256').update(JSON.stringify(canonical(body ?? null))).digest('hex');
}

export interface IdempotentResult<T> {
  status: number;
  body: T;
  replayed: boolean;
}

export async function withIdempotency<T>(
  tx: Tx,
  orgId: string,
  key: string | null | undefined,
  scope: string,
  reqHash: string,
  fn: () => Promise<{ status?: number; body: T }>,
): Promise<IdempotentResult<T>> {
  if (!key) {
    const r = await fn();
    return { status: r.status ?? 200, body: r.body, replayed: false };
  }
  const existing = await tx
    .select()
    .from(idempotencyKeys)
    .where(and(eq(idempotencyKeys.organizationId, orgId), eq(idempotencyKeys.key, key)))
    .limit(1);
  if (existing[0]) {
    if (existing[0].requestHash !== reqHash || existing[0].scope !== scope) throw new DomainError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
    return { status: existing[0].responseStatus, body: existing[0].responseBody as T, replayed: true };
  }
  const r = await fn();
  const status = r.status ?? 200;
  try {
    await tx.insert(idempotencyKeys).values({
      organizationId: orgId,
      key,
      scope,
      requestHash: reqHash,
      responseStatus: status,
      responseBody: r.body as never,
    });
  } catch (e) {
    const code = (e as { code?: string })?.code;
    if (code === '23505') {
      const raced = await tx
        .select()
        .from(idempotencyKeys)
        .where(and(eq(idempotencyKeys.organizationId, orgId), eq(idempotencyKeys.key, key)))
        .limit(1);
      if (raced[0]) {
        if (raced[0].requestHash !== reqHash || raced[0].scope !== scope) throw new DomainError(422, 'IDEMPOTENCY_KEY_REUSED', 'Idempotency-Key was already used with a different request');
        return { status: raced[0].responseStatus, body: raced[0].responseBody as T, replayed: true };
      }
    }
    throw e;
  }
  return { status, body: r.body, replayed: false };
}
