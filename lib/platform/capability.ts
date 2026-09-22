export const has = {
  indexedDb: () => typeof indexedDB !== 'undefined',
  broadcastChannel: () => typeof BroadcastChannel !== 'undefined',
  sendBeacon: () => typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function',
  geolocation: () => typeof navigator !== 'undefined' && typeof navigator.geolocation?.getCurrentPosition === 'function',
  wakeLock: () => typeof navigator !== 'undefined' && typeof navigator.wakeLock?.request === 'function',
  vibration: () => typeof navigator !== 'undefined' && typeof navigator.vibrate === 'function',
  barcodeDetector: () => typeof window !== 'undefined' && 'BarcodeDetector' in window,
  serviceWorker: () => typeof navigator !== 'undefined' && 'serviceWorker' in navigator,
  eventSource: () => typeof EventSource !== 'undefined',
  worker: () => typeof Worker !== 'undefined',
  performanceObserver: (entryType?: string) => {
    if (typeof PerformanceObserver === 'undefined') return false;
    if (!entryType) return true;
    return PerformanceObserver.supportedEntryTypes?.includes(entryType) ?? false;
  },
  showSaveFilePicker: () => typeof window !== 'undefined' && 'showSaveFilePicker' in window,
  setAppBadge: () => typeof navigator !== 'undefined' && typeof navigator.setAppBadge === 'function',
  webAuthn: () => typeof PublicKeyCredential !== 'undefined',
} as const;
