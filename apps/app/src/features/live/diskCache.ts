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

/** Short non-reversible digest of a cache key. The key fingerprints the
 * playlist config, which for Xtream includes the SERVER, USERNAME and
 * PASSWORD, so the key itself must never reach the console. The digest is
 * enough to answer the only question worth asking: is the fingerprint
 * stable across launches, or is it changing and missing every time? */
function digest(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export async function diskGet(key: string): Promise<DiskCached | null> {
  const db = await openDb();
  if (!db) {
    console.info("[live-cache] no IndexedDB available — disk cache disabled");
    return null;
  }
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readonly");
      const rq = tx.objectStore(STORE).get(RECORD);
      rq.onsuccess = () => {
        const v = rq.result as DiskCached | undefined;
        const hit = !!v && v.key === key;
        console.info(
          !v
            ? `[live-cache] MISS: nothing stored yet (want key ${digest(key)})`
            : hit
              ? `[live-cache] HIT: ${Math.round((Date.now() - v.at) / 60000)}min old, ` +
                `${v.data.channels.length} channels, ${v.data.programmes.size} guides`
              : `[live-cache] MISS: stored key ${digest(v.key)} != wanted ${digest(key)} ` +
                `— the playlist fingerprint changed, so every launch re-downloads`,
        );
        resolve(hit ? v : null);
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
    const t0 = Date.now();
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(record, RECORD);
      tx.oncomplete = () => {
        console.info(
          `[live-cache] wrote ${record.data.channels.length} channels + ` +
            `${record.data.programmes.size} guides in ${Date.now() - t0}ms ` +
            `(key ${digest(record.key)})`,
        );
        db.close();
        resolve();
      };
      // Loudly. A silent failure here is indistinguishable from a cache that
      // works, and the symptom is re-downloading the whole guide on every
      // single launch. QuotaExceededError is the one to expect: a big
      // provider's parsed guide is a large structured clone.
      tx.onerror = () => {
        console.warn(
          "[live-cache] WRITE FAILED — the guide will re-download on every " +
            "launch:",
          tx.error?.name ?? "unknown",
          tx.error?.message ?? "",
        );
        db.close();
        resolve();
      };
      tx.onabort = () => {
        console.warn(
          "[live-cache] write ABORTED — the guide will re-download on every " +
            "launch:",
          tx.error?.name ?? "unknown",
        );
        db.close();
        resolve();
      };
    } catch (e) {
      console.warn("[live-cache] write threw:", e);
      db.close();
      resolve();
    }
  });
}
