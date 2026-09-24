import { has } from '../platform/capability';

export const FIELD_DB_NAME = 'apexops_field';
const DB_VERSION = 2;
const STORE = 'outbox';

let dbPromise: Promise<IDBDatabase | null> | null = null;

export async function openFieldDb(): Promise<IDBDatabase | null> {
  if (!has.indexedDb()) return null;
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(FIELD_DB_NAME, DB_VERSION);
    } catch {
      dbPromise = null;
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const st = db.createObjectStore(STORE, { keyPath: 'id' });
        st.createIndex('by-status', 'status', { unique: false });
        st.createIndex('by-createdAt', 'createdAt', { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      resolve(null);
    };
    req.onblocked = () => {
      dbPromise = null;
      resolve(null);
    };
  });
  const db = await dbPromise;
  if (db === null) dbPromise = null;
  return db;
}

export async function idbGetAll<T>(): Promise<T[] | null> {
  const db = await openFieldDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const rq = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      rq.onsuccess = () => resolve((rq.result as T[]) ?? []);
      rq.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function idbSaveAll<T>(items: T[]): Promise<boolean> {
  const db = await openFieldDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, 'readwrite');
      const st = tx.objectStore(STORE);
      st.clear();
      for (const item of items) st.put(item);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
      tx.onabort = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}
