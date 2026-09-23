import { cookies } from 'next/headers';
import { getDb } from '../../db/client';
import { log } from '../log';
import { COOKIE_NAME, verifySession, type AuthContext } from './session';

export async function getSessionContext(): Promise<AuthContext | null> {
  try {
    const store = await cookies();
    const token = store.get(COOKIE_NAME)?.value;
    if (!token) return null;
    return await verifySession(getDb(), token);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const digest = (err as { digest?: string } | null)?.digest;
    if (digest === 'DYNAMIC_SERVER_USAGE' || msg.includes('Dynamic server usage')) throw err;
    log('error', 'session_context_failed', { error: msg });
    return null;
  }
}

export type { AuthContext };
