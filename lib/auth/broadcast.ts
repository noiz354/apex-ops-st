import { has } from '../platform/capability';

export type AuthSignalType = 'LOGOUT' | 'SESSIONS_REVOKED';
export interface AuthSignal {
  type: AuthSignalType;
  at: number;
}

const CHANNEL = 'apex-auth';
const SENTINEL_KEY = 'apex_auth_signal';

export function postAuthSignal(type: AuthSignalType): void {
  const signal: AuthSignal = { type, at: Date.now() };
  if (has.broadcastChannel()) {
    try {
      const ch = new BroadcastChannel(CHANNEL);
      ch.postMessage(signal);
      ch.close();
      return;
    } catch { void 0; }
  }
  try {
    localStorage.setItem(SENTINEL_KEY, JSON.stringify(signal));
  } catch { void 0; }
}

export function subscribeAuthSignals(cb: (signal: AuthSignal) => void): () => void {
  if (has.broadcastChannel()) {
    const ch = new BroadcastChannel(CHANNEL);
    ch.onmessage = (e: MessageEvent) => {
      const d = e.data as AuthSignal | null;
      if (d && typeof d.type === 'string' && Date.now() - d.at < 30_000) cb(d);
    };
    return () => ch.close();
  }
  if (typeof window === 'undefined') return () => {};
  const onStorage = (e: StorageEvent) => {
    if (e.key !== SENTINEL_KEY || !e.newValue) return;
    try {
      const d = JSON.parse(e.newValue) as AuthSignal;
      if (Date.now() - d.at < 30_000) cb(d);
    } catch { void 0; }
  };
  window.addEventListener('storage', onStorage);
  return () => window.removeEventListener('storage', onStorage);
}

export function purgeLocalState(): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith('apex')) doomed.push(k);
    }
    doomed.forEach((k) => localStorage.removeItem(k));
  } catch { void 0; }
  try {
    if (has.indexedDb()) indexedDB.deleteDatabase('apexops_field');
  } catch { void 0; }
}
