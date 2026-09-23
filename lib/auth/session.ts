import { createHash, randomBytes } from 'node:crypto';
import { and, eq, ne, sql } from 'drizzle-orm';
import type { Db } from '../../db/client';
import { organizations, ROLES, sessions, users } from '../../db/schema';
import type { Role } from './rbac';

export const COOKIE_NAME = 'apex_session';
export const SESSION_TTL_DAYS = 7;
const LAST_SEEN_THROTTLE_MS = 60_000;

export interface AuthContext {
  userId: string;
  orgId: string;
  orgName: string;
  role: Role;
  name: string;
  initials: string;
  title: string;
  email: string;
}

export function sessionCookieOptions(): {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: '/';
  maxAge: number;
} {
  return { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/', maxAge: SESSION_TTL_DAYS * 24 * 60 * 60 };
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}

export async function createSession(db: Db, userId: string, organizationId: string, userAgent?: string | null): Promise<string> {
  const token = newSessionToken();
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 24 * 60 * 60 * 1000);
  await db.insert(sessions).values({ idHash: hashToken(token), userId, organizationId, expiresAt, userAgent: userAgent ?? null });
  return token;
}

function isValidRole(role: string): role is Role {
  return (ROLES as readonly string[]).includes(role);
}

export async function verifySession(db: Db, token: string | undefined | null): Promise<AuthContext | null> {
  if (!token) return null;
  const rows = await db
    .select({
      session: sessions,
      user: { id: users.id, name: users.name, initials: users.initials, title: users.title, email: users.email, role: users.role, isActive: users.isActive },
      org: { id: organizations.id, name: organizations.name },
    })
    .from(sessions)
    .innerJoin(users, eq(users.id, sessions.userId))
    .innerJoin(organizations, eq(organizations.id, sessions.organizationId))
    .where(and(eq(sessions.idHash, hashToken(token)), sql`${sessions.expiresAt} > now()`))
    .limit(1);
  const row = rows[0];
  if (!row || !row.user.isActive) return null;
  if (!isValidRole(row.user.role)) return null;
  const lastSeenRaw = row.session.lastSeenAt;
  const lastSeenMs = lastSeenRaw instanceof Date ? lastSeenRaw.getTime() : 0;
  if (Number.isFinite(lastSeenMs) && Date.now() - lastSeenMs > LAST_SEEN_THROTTLE_MS) {
    await db.update(sessions).set({ lastSeenAt: new Date() }).where(eq(sessions.idHash, row.session.idHash));
  }
  return { userId: row.user.id, orgId: row.org.id, orgName: row.org.name, role: row.user.role, name: row.user.name, initials: row.user.initials, title: row.user.title, email: row.user.email };
}

export async function revokeSession(db: Db, token: string | undefined | null): Promise<void> {
  if (!token) return;
  await db.delete(sessions).where(eq(sessions.idHash, hashToken(token)));
}

export async function revokeAllUserSessions(db: Db, userId: string, organizationId: string): Promise<number> {
  const deleted = await db.delete(sessions).where(and(eq(sessions.userId, userId), eq(sessions.organizationId, organizationId))).returning();
  return deleted.length;
}

export interface UserSessionSummary {
  idHashPrefix: string;
  userAgent: string | null;
  lastSeenAt: string;
  expiresAt: string;
  current: boolean;
}

export async function listUserSessions(db: Db, userId: string, organizationId: string, currentIdHash?: string): Promise<UserSessionSummary[]> {
  const rows = await db
    .select({ idHash: sessions.idHash, userAgent: sessions.userAgent, lastSeenAt: sessions.lastSeenAt, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.organizationId, organizationId)))
    .orderBy(sql`${sessions.lastSeenAt} desc`);
  return rows.map((r) => ({
    idHashPrefix: r.idHash.slice(0, 8),
    userAgent: r.userAgent,
    lastSeenAt: r.lastSeenAt.toISOString(),
    expiresAt: r.expiresAt.toISOString(),
    current: currentIdHash ? r.idHash === currentIdHash : false,
  }));
}

export async function revokeOtherUserSessions(db: Db, userId: string, organizationId: string, exceptIdHash: string): Promise<number> {
  const deleted = await db
    .delete(sessions)
    .where(and(eq(sessions.userId, userId), eq(sessions.organizationId, organizationId), ne(sessions.idHash, exceptIdHash)))
    .returning();
  return deleted.length;
}
