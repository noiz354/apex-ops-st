import { and, eq } from 'drizzle-orm';
import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
  type WebAuthnCredential,
} from '@simplewebauthn/server';
import { getDb } from '@/db/client';
import { users, webauthnCredentials, mfaChallenges } from '@/db/schema';
import { ROLES } from '@/db/schema';
import { can } from '@/lib/auth/rbac';
import { createSession } from '@/lib/auth/session';
import { DomainError } from '@/lib/domain/errors';

export interface PasskeyRow {
  id: string;
  credentialId: string;
  publicKey: string;
  counter: number;
  transports: string[];
  friendlyName: string;
}

export type LoginVerifyResult =
  | { status: 'mfa_required'; challengeId: string }
  | { status: 'ok'; token: string; orgId: string };

interface PendingLogin {
  challenge: string;
  ts: number;
  userId: string;
  orgId: string;
  credentialId: string;
}
const pendingRegister = new Map<string, { challenge: string; ts: number }>();
const pendingLogin = new Map<string, PendingLogin>();


const REG_TIMEOUT_MS = 60_000;
const LOGIN_TIMEOUT_MS = 60_000;
const MAX_PENDING = 200;

function sweepRegister(): void {
  const now = Date.now();
  for (const [k, v] of pendingRegister) if (now - v.ts > REG_TIMEOUT_MS) pendingRegister.delete(k);
  if (pendingRegister.size > MAX_PENDING) {
    const overflow = pendingRegister.size - MAX_PENDING;
    let i = 0;
    for (const k of pendingRegister.keys()) { if (i++ >= overflow) break; pendingRegister.delete(k); }
  }
}

function sweepLogin(): void {
  const now = Date.now();
  for (const [k, v] of pendingLogin) if (now - v.ts > LOGIN_TIMEOUT_MS) pendingLogin.delete(k);
  if (pendingLogin.size > MAX_PENDING) {
    const overflow = pendingLogin.size - MAX_PENDING;
    let i = 0;
    for (const k of pendingLogin.keys()) { if (i++ >= overflow) break; pendingLogin.delete(k); }
  }
}

function rpInfo(req: Request): { rpID: string; origin: string } {
  try {
    const base = process.env.NEXT_PUBLIC_ORIGIN ?? new URL(req.url).origin;
    return { rpID: new URL(base).hostname, origin: base };
  } catch {
    const base = new URL(req.url).origin;
    return { rpID: new URL(base).hostname, origin: base };
  }
}

export async function listMyPasskeys(userId: string, orgId: string): Promise<PasskeyRow[]> {
  const db = getDb();
  const rows = await db
    .select()
    .from(webauthnCredentials)
    .where(and(eq(webauthnCredentials.userId, userId), eq(webauthnCredentials.organizationId, orgId)));
  return rows.map((r) => ({
    id: r.id,
    credentialId: r.credentialId,
    publicKey: r.publicKey,
    counter: Number(r.counter),
    transports: (r.transports ?? '').split(',').filter(Boolean),
    friendlyName: r.friendlyName,
  }));
}

export async function registrationOptions(userId: string, orgId: string, req: Request) {
  const db = getDb();
  const user = (await db.select().from(users).where(eq(users.id, userId)).limit(1))[0];
  if (!user) throw new DomainError(404, 'NOT_FOUND', 'User not found');
  const { rpID } = rpInfo(req);
  const existing = await listMyPasskeys(userId, orgId);
  const options = await generateRegistrationOptions({
    rpName: 'APEX CMMS',
    rpID,
    userID: new TextEncoder().encode(`${orgId}:${user.email}`),
    userName: user.email,
    userDisplayName: user.name,
    attestationType: 'none',
    timeout: REG_TIMEOUT_MS,
    authenticatorSelection: {
      residentKey: 'preferred',
      userVerification: 'preferred',
    },
    excludeCredentials: existing.map((c) => ({ id: c.credentialId, type: 'public-key' as const })),
  });
  sweepRegister();
  pendingRegister.set(userId, { challenge: options.challenge, ts: Date.now() });
  return options;
}

export async function verifyRegistration(userId: string, orgId: string, body: unknown, friendlyName: string, req: Request) {
  const db = getDb();
  const { rpID, origin } = rpInfo(req);
  const pending = pendingRegister.get(userId);
  if (!pending || Date.now() - pending.ts > REG_TIMEOUT_MS) {
    throw new DomainError(410, 'PASSKEY_REG_EXPIRED', 'Registration session expired — fetch new options');
  }
  const verification = await verifyRegistrationResponse({
    response: body as Parameters<typeof verifyRegistrationResponse>[0]['response'],
    expectedChallenge: pending.challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
  });
  if (!verification.verified || !verification.registrationInfo) {
    throw new DomainError(400, 'PASSKEY_REG_REJECTED', 'Attestation could not be verified');
  }
  pendingRegister.delete(userId);

  const ri: WebAuthnCredential = verification.registrationInfo.credential;
  const transports = ((ri.transports as string[] | undefined) ?? []).join(',');
  const [row] = await db
    .insert(webauthnCredentials)
    .values({
      organizationId: orgId,
      userId,
      credentialId: ri.id,
      publicKey: Buffer.from(ri.publicKey).toString('base64url'),
      counter: Number(ri.counter ?? 0),
      transports,

      friendlyName: friendlyName.slice(0, 80) || 'Passkey',
    })
    .returning({ id: webauthnCredentials.id });
  return { credentialId: row.id };
}

export async function registrationRoleAllowed(role: string): Promise<boolean> {
  return can(role as (typeof ROLES)[number], 'settings.manage');
}



export async function loginOptions(orgId: string, email: string, req: Request) {
  const db = getDb();
  const user = (
    await db
      .select()
      .from(users)
      .where(and(eq(users.email, email.trim().toLowerCase()), eq(users.organizationId, orgId)))
      .limit(1)
  )[0];
  if (!user) throw new DomainError(404, 'NOT_FOUND', 'Email not registered for this organization');
  const { rpID } = rpInfo(req);
  const creds = await listMyPasskeys(user.id, orgId);
  if (!creds.length) throw new DomainError(404, 'NOT_FOUND', 'No passkeys enrolled — use password + TOTP');
  const options = await generateAuthenticationOptions({
    rpID,
    timeout: LOGIN_TIMEOUT_MS,
    userVerification: 'preferred',
    allowCredentials: creds.map((c) => ({ id: c.credentialId, type: 'public-key' as const })),
  });
  sweepLogin();
  pendingLogin.set(options.challenge, {
    challenge: options.challenge,
    ts: Date.now(),
    userId: user.id,
    orgId,
    credentialId: '',
  });
  return options;
}

export async function verifyLogin(body: unknown, userAgent: string | null, req: Request): Promise<LoginVerifyResult> {
  const attestation = body as { id?: string };
  const credId = typeof attestation.id === 'string' ? attestation.id : '';
  const db = getDb();
  const cred = (
    await db
      .select()
      .from(webauthnCredentials)
      .where(eq(webauthnCredentials.credentialId, credId))
      .limit(1)
  )[0];
  if (!cred) throw new DomainError(404, 'NOT_FOUND', 'Unknown credential');

  const keys = Array.from(pendingLogin.entries()).find(
    ([, v]) => v.userId === cred.userId && v.orgId === cred.organizationId && Date.now() - v.ts <= LOGIN_TIMEOUT_MS,
  );
  if (!keys) throw new DomainError(410, 'PASSKEY_LOGIN_EXPIRED', 'No pending challenge — fetch new options');
  const [challenge] = keys;

  const user = (await db.select().from(users).where(eq(users.id, cred.userId)).limit(1))[0];
  if (!user) throw new DomainError(404, 'NOT_FOUND', 'User record missing');
  
  const { rpID, origin } = rpInfo(req);

  const verification = await verifyAuthenticationResponse({
    response: body as Parameters<typeof verifyAuthenticationResponse>[0]['response'],
    expectedChallenge: challenge,
    expectedOrigin: origin,
    expectedRPID: rpID,
    requireUserVerification: false,
    credential: {
      id: cred.credentialId,
      publicKey: Buffer.from(cred.publicKey, 'base64url'),
      counter: Number(cred.counter),
    },
  });
  if (!verification.verified) {
    throw new DomainError(401, 'PASSKEY_LOGIN_REJECTED', 'Assertion could not be verified');
  }
  pendingLogin.delete(challenge);

  await db
    .update(webauthnCredentials)
    .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
    .where(eq(webauthnCredentials.id, cred.id));

  if (!user.totpSecret) {
    const token = await createSession(db, cred.userId, cred.organizationId, userAgent);
    return { status: 'ok', token, orgId: cred.organizationId };
  }

  const [challengeRow] = await db
    .insert(mfaChallenges)
    .values({
      userId: cred.userId,
      organizationId: cred.organizationId,
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    })
    .returning({ id: mfaChallenges.id });
  return { status: 'mfa_required', challengeId: challengeRow.id };
}

export async function deletePasskey(userId: string, orgId: string, passkeyId: string): Promise<boolean> {
  const db = getDb();
  const rows = await db
    .delete(webauthnCredentials)
    .where(and(eq(webauthnCredentials.id, passkeyId), eq(webauthnCredentials.userId, userId), eq(webauthnCredentials.organizationId, orgId)))
    .returning({ id: webauthnCredentials.id });
  return rows.length > 0;
}
