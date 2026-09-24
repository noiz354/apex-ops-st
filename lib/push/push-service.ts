import webPush from 'web-push';
import { and, eq } from 'drizzle-orm';
import { getDb } from '@/db/client';
import { log } from '../log';
import { auditEvents, pushSubscriptions } from '@/db/schema';
import type { Tx } from '@/db/client';

export interface PushSubInput {
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
}

const ENV_PUBLIC = 'WEBPUSH_PUBLIC_VAPID_KEY';
const ENV_PRIVATE = 'WEBPUSH_PRIVATE_VAPID_KEY';

let _keys: { publicKey: string; privateKey: string } | null = null;

export function isPushConfigured(): boolean {
  return Boolean(process.env[ENV_PUBLIC] && process.env[ENV_PRIVATE]);
}

export function getVapidKeys(): { publicKey: string; privateKey: string } {
  const pub = process.env[ENV_PUBLIC];
  const priv = process.env[ENV_PRIVATE];
  if (pub && priv) return { publicKey: pub, privateKey: priv };
  if (!_keys) {
    _keys = webPush.generateVAPIDKeys();
    log('warn', 'ephemeral VAPID keys generated — set env for stability; subs will NOT survive restart', { op: 'push.ephemeral_keys' });
  }
  return _keys;
}

export function getPublicVapidKey(): string {
  return getVapidKeys().publicKey;
}

function getStatusCode(err: unknown): number | undefined {
  if (typeof err !== 'object' || err === null || !('statusCode' in err)) return undefined;
  const s = (err as { statusCode?: unknown }).statusCode;
  return typeof s === 'number' ? s : undefined;
}

function initWebPush() {
  const k = getVapidKeys();
  webPush.setVapidDetails('mailto:ops@apex-cmms.local', k.publicKey, k.privateKey);
}

async function audit(tx: Tx, orgId: string, action: string, userId: string, entityId: string) {
  await tx.insert(auditEvents).values({
    organizationId: orgId,
    actorUserId: userId,
    actorName: 'push-service',
    action,
    entityType: 'push_subscription',
    entityId,
  });
}

export async function subscribePush(orgId: string, userId: string, input: PushSubInput) {
  const db = getDb();
  return db.transaction(async (tx) => {
    const existing = await tx
      .select()
      .from(pushSubscriptions)
      .where(eq(pushSubscriptions.endpoint, input.endpoint))
      .limit(1);
    if (existing[0]) {
      await tx
        .update(pushSubscriptions)
        .set({ userId, organizationId: orgId, p256dh: input.p256dh, auth: input.auth, userAgent: input.userAgent, lastUsedAt: new Date() })
        .where(eq(pushSubscriptions.id, existing[0].id));
      await audit(tx, orgId, 'PUSH_SUB_UPDATED', userId, existing[0].id);
      return existing[0].id;
    }
    const [row] = await tx
      .insert(pushSubscriptions)
      .values({
        organizationId: orgId,
        userId,
        endpoint: input.endpoint,
        p256dh: input.p256dh,
        auth: input.auth,
        userAgent: input.userAgent,
      })
      .returning({ id: pushSubscriptions.id });
    await audit(tx, orgId, 'PUSH_SUB_CREATED', userId, row.id);
    return row.id;
  });
}

export async function unsubscribePush(orgId: string, userId: string, endpoint: string) {
  const db = getDb();
  const rows = await db
    .delete(pushSubscriptions)
    .where(and(eq(pushSubscriptions.endpoint, endpoint), eq(pushSubscriptions.organizationId, orgId), eq(pushSubscriptions.userId, userId)))
    .returning({ id: pushSubscriptions.id });
  return rows.length > 0;
}

export async function sendP1PushToUser(
  orgId: string,
  userId: string,
  payload: { title: string; body: string; url: string },
): Promise<{ sent: number; pruned: number; unconfigured?: boolean }> {
  if (!isPushConfigured()) {
    log('warn', 'P1 push skipped — VAPID keys not configured', { op: 'push.send' });
    return { sent: 0, pruned: 0, unconfigured: true };
  }
  initWebPush();
  const db = getDb();
  const subs = await db
    .select()
    .from(pushSubscriptions)
    .where(and(eq(pushSubscriptions.organizationId, orgId), eq(pushSubscriptions.userId, userId)));
  const body = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-72.png',
    tag: `apex-p1-${Date.now()}`,
  });
  let sent = 0;
  let pruned = 0;
  for (const sub of subs) {
    try {
      await webPush.sendNotification(
        {
          endpoint: sub.endpoint,
          keys: { p256dh: sub.p256dh, auth: sub.auth },
        },
        body,
        { TTL: 300, urgency: 'high' },
      );
      await db.update(pushSubscriptions).set({ lastUsedAt: new Date() }).where(eq(pushSubscriptions.id, sub.id));
      sent++;
    } catch (err) {
      const status = getStatusCode(err);
      if (status === 404 || status === 410) {
        await db.delete(pushSubscriptions).where(eq(pushSubscriptions.id, sub.id));
        pruned++;
      } else {
        log('warn', 'sendNotification failed', { op: 'push.send', status, error: (err as Error)?.message });
      }
    }
  }
  return { sent, pruned };
}

export function p1PushUrl(): string {
  return '/notifications';
}
