/**
 * Shared CSV export pipeline: build in a worker (quoting/injection-safe,
 * BOM + CRLF) then save via the File System picker with download fallback.
 *
 * The `@/lib/download` chunk stays lazy — this module re-exports nothing
 * at module scope so importing it never pulls the worker loader eagerly.
 */

import type { CsvRow } from '@/lib/download';

export type CsvTable = CsvRow[];

export async function exportTableCsv(
  filename: string,
  table: CsvTable,
  delimiter = ',',
): Promise<void> {
  const { buildCsvViaWorker, saveAsViaPickerOrDownload } = await import('@/lib/download');
  const csv = await buildCsvViaWorker(table, delimiter);
  await saveAsViaPickerOrDownload(
    filename,
    new Blob([csv], { type: 'text/csv;charset=utf-8' }),
    'text/csv',
  );
}
