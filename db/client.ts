import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle, type PgliteDatabase } from 'drizzle-orm/pglite';
import * as schema from './schema';

export type Db = PgliteDatabase<typeof schema>;
export type Tx = Parameters<Parameters<Db['transaction']>[0]>[0];

export const DEFAULT_DATA_DIR = '.data/pg';

declare global {
  var __apexDb: Db | undefined;
  var __apexPglite: PGlite | undefined;
  var __apexDbInit: Promise<Db> | undefined;
}

function prepare(dataDir: string): PGlite {
  const abs = resolve(dataDir);
  mkdirSync(abs, { recursive: true });
  return new PGlite(abs);
}

export function getDb(): Db {
  if (globalThis.__apexDb) return globalThis.__apexDb;
  if (globalThis.__apexDbInit) throw new Error('DB init in progress — await getDbAsync() or serialize startup');
  const pglite = prepare(process.env.PGDATA_DIR || DEFAULT_DATA_DIR);
  globalThis.__apexPglite = pglite;
  globalThis.__apexDb = drizzle(pglite, { schema });
  return globalThis.__apexDb;
}

export async function getDbAsync(): Promise<Db> {
  if (globalThis.__apexDb) return globalThis.__apexDb;
  if (globalThis.__apexDbInit) return globalThis.__apexDbInit;
  globalThis.__apexDbInit = (async () => {
    const pglite = prepare(process.env.PGDATA_DIR || DEFAULT_DATA_DIR);
    globalThis.__apexPglite = pglite;
    const db = drizzle(pglite, { schema });
    globalThis.__apexDb = db;
    return db;
  })();
  try {
    return await globalThis.__apexDbInit;
  } catch (err) {
    globalThis.__apexDbInit = undefined;
    globalThis.__apexDb = undefined;
    globalThis.__apexPglite = undefined;
    throw err;
  }
}

export function createDb(dataDir: string): { db: Db; close: () => Promise<void> } {
  const client = prepare(dataDir);
  const db = drizzle(client, { schema });
  return { db, close: () => client.close() };
}
