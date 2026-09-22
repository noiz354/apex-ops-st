import { has } from './capability';

interface WakeLockSentinelLike {
  released: boolean;
  release(): Promise<void>;
  addEventListener(type: 'release', listener: () => void): void;
}

export interface WakeLockController {
  acquire(): Promise<boolean>;
  release(): Promise<void>;
  readonly active: boolean;
}

export function createScreenWakeLock(): WakeLockController {
  let sentinel: WakeLockSentinelLike | null = null;
  let pending: Promise<boolean> | null = null;
  let desired = false;
  let generation = 0;

  if (!has.wakeLock()) {
    return {
      acquire: async () => false,
      release: async () => {},
      get active() {
        return false;
      },
    };
  }

  async function requestWakeLock(requestGeneration: number): Promise<boolean> {
    try {
      const acquired = (await (
        navigator as unknown as { wakeLock: { request(type: 'screen'): Promise<WakeLockSentinelLike> } }
      ).wakeLock.request('screen')) as WakeLockSentinelLike;
      if (!desired || requestGeneration !== generation) {
        await acquired.release().catch(() => {});
        return false;
      }
      sentinel = acquired;
      acquired.addEventListener('release', () => {
        if (sentinel === acquired) sentinel = null;
        if (desired && document.visibilityState === 'visible') void ensureWakeLock();
      });
      return !acquired.released;
    } catch {
      return false;
    }
  }

  function ensureWakeLock(): Promise<boolean> {
    if (!desired) return Promise.resolve(false);
    if (sentinel && !sentinel.released) return Promise.resolve(true);
    if (pending) return pending;
    const requestGeneration = generation;
    const request = requestWakeLock(requestGeneration);
    pending = request;
    void request.finally(() => {
      if (pending === request) pending = null;
    });
    return request;
  }

  function onVisibilityChange(): void {
    if (desired && document.visibilityState === 'visible') void ensureWakeLock();
  }

  return {
    acquire() {
      desired = true;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      document.addEventListener('visibilitychange', onVisibilityChange);
      return ensureWakeLock();
    },
    async release() {
      desired = false;
      generation++;
      document.removeEventListener('visibilitychange', onVisibilityChange);
      const current = sentinel;
      sentinel = null;
      if (current && !current.released) {
        try {
          await current.release();
        } catch (_err) {
          void _err;
        }
      }
    },
    get active() {
      return sentinel !== null && !sentinel.released;
    },
  };
}
