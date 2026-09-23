export interface CsvOptions {
  delimiter?: string;
  quoteAlways?: boolean;
  mitigateFormulaInjection?: boolean;
}

type CsvWorkerRequest = CsvOptions & {
  rows: (string | number | null | undefined)[][];
};

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

self.onmessage = (ev: MessageEvent<CsvWorkerRequest>) => {
  const scope = self as unknown as { postMessage(m: CsvWorkerResponse): void };
  try {
    const { rows, delimiter = ',', quoteAlways = false, mitigateFormulaInjection = false } = ev.data;
    if (!Array.isArray(rows) || typeof delimiter !== 'string' || delimiter.length !== 1 || /["\r\n]/.test(delimiter)) throw new TypeError('Invalid CSV input');
    const lines = rows.map((r) => {
      if (!Array.isArray(r)) throw new TypeError('Invalid CSV row');
      return r.map((c) => escapeCell(c, delimiter, quoteAlways, mitigateFormulaInjection)).join(delimiter);
    });
    const csv: string = `\uFEFF${lines.join('\r\n')}`;
    scope.postMessage({ ok: true, csv });
  } catch (err) {
    scope.postMessage({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
};
