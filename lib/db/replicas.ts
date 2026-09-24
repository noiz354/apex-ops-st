import type { Db } from '../../db/client';
import { getDb } from '../../db/client';

export type QueryRole = 'primary' | 'replica';

export function getDatabaseHandle(_role: QueryRole = 'primary'): Db {
  return getDb();
}

export function getReadDb(): Db {
  return getDatabaseHandle('replica');
}
