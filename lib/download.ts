export function sanitizeFilename(name: string): string {
  // eslint-disable-next-line no-control-regex -- strip ASCII control chars from filenames
  const clean = name.replace(/[\\/:*?"<>|\u0000-\u001F-]+/g, '-').replace(/-{2,}/g, '-').trim();
  return clean.slice(0, 180) || 'download';
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = sanitizeFilename(filename);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function downloadText(filename: string, text: string, type = 'text/csv'): void {
  downloadBlob(filename, new Blob([text], { type: `${type};charset=utf-8` }));
}

export type CsvRow = (string | number | null | undefined)[];

export interface CsvOptions {
  delimiter?: string;
  quoteAlways?: boolean;
  mitigateFormulaInjection?: boolean;
}

type CsvWorkerResponse = { ok: true; csv: string } | { ok: false; error: string };

function needsQuote(s: string, delimiter: string): boolean {
  return s.includes('"') || s.includes('\n') || s.includes('\r') || s.includes(delimiter);
}

function escapeCell(v: string | number | null | undefined, delim: string, quoteAlways: boolean, mitigateFormula: boolean): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  let s = String(v);
  // eslint-disable-next-line no-control-regex -- detect leading C0 controls before formula chars
  if (mitigateFormula && /^[\s\u0000-\u001F]*[=+\-@]/.test(s)) s = `'${s}`;
  const needQuote = quoteAlways || needsQuote(s, delim);
  return needQuote ? `"${s.replace(/"/g, '""')}"` : s;
}

function buildCsvSync(rows: CsvRow[], delimiter: string, quoteAlways: boolean, mitigateFormula: boolean): string {
  if (!Array.isArray(rows)) throw new TypeError('Invalid CSV input');
  if (typeof delimiter !== 'string' || delimiter.length !== 1 || /["\r\n]/.test(delimiter)) throw new TypeError('Invalid CSV input');
  return `\uFEFF${rows.map((r) => {
    if (!Array.isArray(r)) throw new TypeError('Invalid CSV row');
    return r.map((c) => escapeCell(c, delimiter, quoteAlways, mitigateFormula)).join(delimiter);
  }).join('\r\n')}`;
}

export async function buildCsvViaWorker(rows: CsvRow[], delimiter = ',', opts: CsvOptions = {}): Promise<string> {
  const delim = opts.delimiter ?? delimiter;
  const quoteAlways = opts.quoteAlways ?? false;
  const mitigateFormula = opts.mitigateFormulaInjection ?? false;
  if (typeof delim !== 'string' || delim.length !== 1 || /["\r\n]/.test(delim)) throw new TypeError('Invalid CSV input');
  if (!Array.isArray(rows)) throw new TypeError('Invalid CSV input');
  if (typeof window === 'undefined' || !('Worker' in window)) return buildCsvSync(rows, delim, quoteAlways, mitigateFormula);
  let worker: Worker;
  try {
    worker = new Worker(new URL('./workers/download.worker.ts', import.meta.url));
  } catch {
    return buildCsvSync(rows, delim, quoteAlways, mitigateFormula);
  }
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('worker-timeout'));
    }, 30_000);
    worker.onmessage = (ev: MessageEvent<CsvWorkerResponse>) => {
      clearTimeout(timeout);
      worker.terminate();
      const data = ev.data;
      if (data.ok) resolve(data.csv);
      else resolve(buildCsvSync(rows, delim, quoteAlways, mitigateFormula));
    };
    worker.onerror = (e: ErrorEvent) => {
      clearTimeout(timeout);
      worker.terminate();
      resolve(buildCsvSync(rows, delim, quoteAlways, mitigateFormula));
      void e;
    };
    worker.postMessage({ rows, delimiter: delim, quoteAlways, mitigateFormulaInjection: mitigateFormula });
  });
}

export async function exportCsvViaWorker(filename: string, rows: CsvRow[], delimiter = ',', opts: CsvOptions = {}): Promise<void> {
  const csv = await buildCsvViaWorker(rows, delimiter, opts);
  downloadText(filename, csv);
}

interface SaveFilePickerHandle {
  createWritable(): Promise<{ write(data: Blob | string): Promise<void>; close(): Promise<void> }>;
}

declare global {
  interface Window {
    showSaveFilePicker?: (options?: { suggestedName?: string; types?: { description: string; accept: Record<string, string[]> }[] }) => Promise<SaveFilePickerHandle>;
  }
}

export async function saveAsViaPickerOrDownload(filename: string, blob: Blob, mimeType?: string): Promise<'picker' | 'download' | 'cancelled'> {
  if (typeof window !== 'undefined' && 'showSaveFilePicker' in window && window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({ suggestedName: sanitizeFilename(filename), types: [{ description: 'Export file', accept: { [mimeType ?? 'text/csv']: ['.csv', '.txt'] } }] });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return 'picker';
    } catch (err) {
      if (err instanceof DOMException && err.name === 'AbortError') return 'cancelled';
      throw err;
    }
  }
  downloadBlob(filename, blob);
  return 'download';
}
