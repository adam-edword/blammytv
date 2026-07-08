import type { LiveData } from "./model";

/**
 * Disk persistence for the live catalog (IndexedDB): lets a fresh app launch
 * hydrate the guide instantly from the last successful load — Telly-style —
 * while a background refresh replaces it. IDB's structured clone stores the
 * programmes Map and Dates natively (no JSON round-trip of a ~15MB graph).
 *
 * One record, overwritten on every save; the caller's cache key (playlist
 * config fingerprint) rides along, so a config change reads as a miss and
 * nothing stale survives a playlist edit. Every path degrades to null/no-op
 * (node tests have no indexedDB; private-mode browsers may reject opens).
 */

const DB = "blammytv";
const STORE = "liveCache";
const RECORD = "live";
const DB_VERSION = 1;

export interface DiskCached {
  key: string;
  at: number;
  data: LiveData;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE))
          req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function diskGet(key: string): Promise<DiskCached | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const rq = tx.objectStore(STORE).get(RECORD);
      rq.onsuccess = () => {
        const v = rq.result as DiskCached | undefined;
        resolve(v && v.key === key ? v : null);
        db.close();
      };
      rq.onerror = () => {
        resolve(null);
        db.close();
      };
    } catch {
      db.close();
      resolve(null);
    }
  });
}

export async function diskPut(record: DiskCached): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record, RECORD);
      tx.oncomplete = () => {
        db.close();
        resolve();
      };
      tx.onerror = () => {
        db.close();
        resolve();
      };
    } catch {
      db.close();
      resolve();
    }
  });
}
