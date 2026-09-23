export type BarcodeScanResult = {
  rawValue: string;
  format: string;
  cornerPoints?: ReadonlyArray<{ x: number; y: number }>;
};

export interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<BarcodeScanResult[]>;
}

export interface DetectedBarcodeCtor {
  new (options?: { formats?: string[] }): BarcodeDetectorLike;
  getSupportedFormats?: () => Promise<string[]>;
}

type GlobalWithBarcode = { BarcodeDetector?: DetectedBarcodeCtor };

function getCtor(): DetectedBarcodeCtor | null {
  const ctor = (globalThis as GlobalWithBarcode).BarcodeDetector;
  return typeof ctor === 'function' ? ctor : null;
}

export function hasBarcodeDetector(): boolean {
  const Ctor = getCtor();
  if (!Ctor) return false;
  try {
    new Ctor();
    return true;
  } catch {
    return false;
  }
}

export const PREFERRED_FORMATS = ['code_128', 'qr_code', 'data_matrix', 'code_39', 'ean_13'] as const;

export async function supportedFormats(): Promise<string[]> {
  const Ctor = getCtor();
  if (!Ctor) return [];
  if (typeof Ctor.getSupportedFormats === 'function') {
    try {
      const supported = await Ctor.getSupportedFormats();
      const hit = PREFERRED_FORMATS.filter((f) => supported.includes(f));
      return hit.length > 0 ? hit : supported;
    } catch {
      void 0;
    }
  }
  return [...PREFERRED_FORMATS];
}

export function createBarcodeDetector(formats?: string[]): BarcodeDetectorLike | null {
  const Ctor = getCtor();
  if (!Ctor) return null;
  try {
    return formats && formats.length > 0 ? new Ctor({ formats }) : new Ctor();
  } catch {
    return null;
  }
}

function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

function normalizeConfirmFrames(v: unknown): number {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new RangeError('confirmFrames must be integer >= 1');
  return v;
}

function normalizeIntervalMs(v: unknown): number {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < 20) throw new RangeError('intervalMs must be finite >= 20');
  return v;
}

export async function scanFromVideo(
  video: HTMLVideoElement,
  signal: AbortSignal,
  opts: { confirmFrames?: number; intervalMs?: number; formats?: string[] } = {},
): Promise<BarcodeScanResult | null> {
  const detector = createBarcodeDetector(opts.formats);
  if (!detector) return null;

  const confirmFrames = opts.confirmFrames === undefined ? 2 : normalizeConfirmFrames(opts.confirmFrames);
  const intervalMs = opts.intervalMs === undefined ? 250 : normalizeIntervalMs(opts.intervalMs);
  let lastValue: string | null = null;
  let streak = 0;

  while (!signal.aborted) {
    if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA && video.videoWidth > 0) {
      let hits: BarcodeScanResult[];
      try {
        hits = await detector.detect(video);
      } catch {
        lastValue = null;
        streak = 0;
        if (signal.aborted) throw abortError();
        await new Promise<void>((r) => setTimeout(r, intervalMs));
        if (signal.aborted) throw abortError();
        continue;
      }
      if (signal.aborted) throw abortError();
      const candidates = hits.filter((h) => h.rawValue.trim().length >= 4);
      let matched: BarcodeScanResult | null = null;
      for (const c of candidates) {
        if (c.rawValue === lastValue) {
          streak += 1;
          if (streak >= confirmFrames) {
            matched = c;
            break;
          }
        } else {
          lastValue = c.rawValue;
          streak = 1;
          if (confirmFrames === 1) {
            matched = c;
            break;
          }
        }
      }
      if (!candidates.length) {
        lastValue = null;
        streak = 0;
      }
      if (matched) return matched;
    }
    await new Promise<void>((r) => setTimeout(r, intervalMs));
    if (signal.aborted) throw abortError();
  }
  throw abortError();
}

export function normalizeScannedAssetCode(raw: string): string {
  const trimmed = raw.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    try {
      const u = new URL(trimmed);
      const seg = u.pathname.split('/').filter(Boolean).pop();
      return (seg ?? trimmed).toUpperCase();
    } catch {
      return trimmed.toUpperCase();
    }
  }
  const seg = trimmed.split(/[/\s]+/).filter(Boolean).pop() ?? trimmed;
  return seg.toUpperCase();
}

const ASSET_CODE_RE = /^AST-[A-Z0-9-]{3,}$/;

export function isValidAssetCode(code: string): boolean {
  return ASSET_CODE_RE.test(code.trim().toUpperCase());
}
