import { has } from '../platform/capability';

const SYNC_TAG = 'apex-outbox-flush';

type BadgeNavigator = Navigator & { setAppBadge?: (count?: number) => Promise<void>; clearAppBadge?: () => Promise<void> };

interface SyncCapableRegistration extends ServiceWorkerRegistration {
  sync?: { register: (tag: string) => Promise<void> };
}

export async function registerOutboxSync(): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  try {
    if (!has.serviceWorker() || typeof ServiceWorkerRegistration === 'undefined' || !('sync' in ServiceWorkerRegistration.prototype)) return false;
    const reg = (await navigator.serviceWorker.ready) as SyncCapableRegistration;
    if (!reg.sync || typeof reg.sync.register !== 'function') return false;
    await reg.sync.register(SYNC_TAG);
    return true;
  } catch {
    return false;
  }
}

export async function updateOutboxBadge(count: number): Promise<boolean> {
  if (typeof navigator === 'undefined') return false;
  if (!Number.isInteger(count) || count < 0) {
    try {
      const n = navigator as BadgeNavigator;
      if (typeof n.clearAppBadge === 'function') await n.clearAppBadge();
    } catch {
      void 0;
    }
    return false;
  }
  const n = navigator as BadgeNavigator;
  if (typeof n.setAppBadge !== 'function') return false;
  try {
    if (count > 0) await n.setAppBadge(count);
    else if (typeof n.clearAppBadge === 'function') await n.clearAppBadge();
    else await n.setAppBadge(0);
    return true;
  } catch {
    return false;
  }
}
