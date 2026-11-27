/** Minimal promise wrapper over IndexedDB, used by the background service worker. */

const DB_NAME = 'bili2ytb';
const DB_VERSION = 3;
export type StoreName = 'comments' | 'files' | 'lists' | 'videos';

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  dbPromise ??= new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('comments')) db.createObjectStore('comments');
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files');
      if (!db.objectStoreNames.contains('lists')) db.createObjectStore('lists');
      if (!db.objectStoreNames.contains('videos')) db.createObjectStore('videos');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error);
    };
  });
  return dbPromise;
}

function wrap<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(store: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
  return (await open()).transaction(store, mode).objectStore(store);
}

export async function idbGet<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
  return wrap((await tx(store, 'readonly')).get(key)) as Promise<T | undefined>;
}

export async function idbPut(store: StoreName, key: IDBValidKey, value: unknown): Promise<void> {
  await wrap((await tx(store, 'readwrite')).put(value, key));
}

export async function idbDelete(store: StoreName, key: IDBValidKey): Promise<void> {
  await wrap((await tx(store, 'readwrite')).delete(key));
}

/** Deletes entries for which `expired(value)` is true. */
export async function idbPrune<T>(store: StoreName, expired: (v: T) => boolean): Promise<number> {
  const os = await tx(store, 'readwrite');
  return new Promise((resolve, reject) => {
    let n = 0;
    const req = os.openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return resolve(n);
      if (expired(cur.value as T)) {
        cur.delete();
        n++;
      }
      cur.continue();
    };
    req.onerror = () => reject(req.error);
  });
}
