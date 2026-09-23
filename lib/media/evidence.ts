export interface PreparedEvidence {
  blob: Blob;
  fileName: string;
  mimeType: string;
  fileSize: number;
  sha256Hash: string;
  wasResized: boolean;
  previewUrl: string;
  release(): void;
}

export async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) return '';
  try {
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, '0')).join('');
  } catch {
    void 0;
    return '';
  }
}

function validateResizeOpts(maxEdge: unknown, quality: unknown): { maxEdge: number; quality: number } {
  const e = maxEdge === undefined ? 1600 : (maxEdge as number);
  const q = quality === undefined ? 0.8 : (quality as number);
  if (typeof e !== 'number' || !Number.isFinite(e) || e < 32 || e > 8192) throw new RangeError('maxEdge must be finite 32..8192');
  if (typeof q !== 'number' || !Number.isFinite(q) || q <= 0 || q > 1) throw new RangeError('quality must be finite (0,1]');
  return { maxEdge: e, quality: q };
}

function jpegFilename(name: string): string {
  const base = name.replace(/\.[^/.]+$/, '') || 'evidence';
  return `${base}.jpg`;
}

async function tryResize(file: File, maxEdge: number, quality: number): Promise<Blob | null> {
  if (!file.type.startsWith('image/') || file.type === 'image/svg+xml') return null;
  if (typeof createImageBitmap !== 'function' || typeof document === 'undefined') return null;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxEdge / Math.max(bmp.width, bmp.height));
    if (scale >= 1) {
      bmp.close();
      return null;
    }
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      bmp.close();
      return null;
    }
    ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    return await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  } catch {
    void 0;
    return null;
  }
}

export async function prepareEvidence(
  file: File,
  opts: { maxEdge?: number; quality?: number } = {},
): Promise<PreparedEvidence> {
  const { maxEdge, quality } = validateResizeOpts(opts.maxEdge, opts.quality);
  const resized = await tryResize(file, maxEdge, quality);
  const blob = resized ?? file;
  const wasResized = resized !== null;

  let sha256Hash = '';
  try {
    sha256Hash = await sha256Hex(await blob.arrayBuffer());
  } catch {
    void 0;
  }

  const previewUrl = URL.createObjectURL(blob);
  const fileName = wasResized ? jpegFilename(file.name) : (file.name || 'evidence');
  const mimeType = wasResized ? 'image/jpeg' : file.type || 'application/octet-stream';

  return {
    blob,
    fileName,
    mimeType,
    fileSize: blob.size,
    sha256Hash,
    wasResized,
    previewUrl,
    release: () => URL.revokeObjectURL(previewUrl),
  };
}

export function toEvidenceFormData(prepared: PreparedEvidence, taskId?: string | null): FormData {
  const form = new FormData();
  form.append('file', prepared.blob, prepared.fileName);
  if (prepared.sha256Hash) form.append('sha256Hash', prepared.sha256Hash);
  if (taskId) form.append('taskId', taskId);
  return form;
}
