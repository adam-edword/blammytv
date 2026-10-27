/**
 * The last read of each playlist's movie and show lists, on disk (plan 028), so
 * a launch shows the library at once and refreshes behind it, as the guide
 * does (live/diskCache.ts).
 *
 * IndexedDB, in a database of its own. Live's is `blammytv`, opened at version
 * 1 by diskCache.ts: a second store there would be a version bump both modules
 * have to agree on. Never localStorage either, whose quota is a few megabytes
 * and one provider's movie list alone is 10.
 *
 * One record per playlist (its id is the record's key), carrying a SHA-256 of
 * the playlist's fingerprint (server, user name and password). A read for
 * another fingerprint is a miss, so an edited playlist never shows the old
 * account's lists, and the next save overwrites the record rather than leaving
 * it behind. The disk never holds the password, and the fingerprint is NEVER
 * logged, only its digest. 1.0.0 kept the fingerprint itself: such a record
 * matches nothing, and the next read of the panel replaces it.
 *
 * Every path degrades to null or nothing (node tests have no indexedDB, and a
 * private window may refuse to open one), and a failed write says so loudly:
 * the symptom of a cache that does not write is a ten megabyte download at
 * every launch.
 */

import type { XtreamPlaylist } from "../settings/playlists";
import type { XtLists } from "./library";

const DB = "blammytv-vod";
const STORE = "lists";
const DB_VERSION = 1;

/** What identifies the account a playlist's lists were read from. */
export function fingerprint(p: Pick<XtreamPlaylist, "server" | "username" | "password">): string {
  return JSON.stringify([p.server.trim().replace(/\/+$/, ""), p.username, p.password]);
}

/** A short non-reversible digest, for a log line or a cache key that must not
 * carry a credential (live/diskCache.ts keeps the same one). */
export function digest(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** The fingerprint as a record keeps it: SHA-256, in hex. Null where the page
 * has no SubtleCrypto (an insecure origin), and then nothing is read or written
 * rather than writing the fingerprint itself. */
async function seal(fp: string): Promise<string | null> {
  try {
    const h = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(fp));
    return Array.from(new Uint8Array(h), (b) => b.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}

interface DiskRecord {
  /** `seal(fingerprint)`. */
  fp: string;
  at: number;
  lists: XtLists;
}

function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  return new Promise((resolve) => {
    try {
      const req = indexedDB.open(DB, DB_VERSION);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
      req.onblocked = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

/** Whether a record read back has the shape of one. Whatever else is in the
 * database (an older build's, a damaged write) is a miss. */
function sane(v: DiskRecord): boolean {
  const l = v.lists as Partial<XtLists> | undefined;
  return (
    typeof v.at === "number" &&
    !!l &&
    Array.isArray(l.movies) &&
    Array.isArray(l.shows) &&
    Array.isArray(l.movieFolders) &&
    Array.isArray(l.showFolders)
  );
}

/** The lists read for this playlist and fingerprint, with when they were read,
 * or null for a miss of any kind. */
export async function diskGet(pid: string, fp: string): Promise<{ at: number; lists: XtLists } | null> {
  const want = await seal(fp);
  if (!want) return null;
  // From open to the lists unpacked: what the launch path holds the main thread for.
  const t0 = performance.now();
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const rq = db.transaction(STORE, "readonly").objectStore(STORE).get(pid);
      rq.onsuccess = () => {
        const v = rq.result as DiskRecord | undefined;
        const hit = v && v.fp === want && sane(v) ? v : null;
        const ms = Math.round(performance.now() - t0);
        console.info(
          !v
            ? `[xt-vod] disk MISS: nothing stored yet (want ${digest(fp)}) in ${ms}ms`
            : hit
              ? `[xt-vod] disk HIT: ${Math.round((Date.now() - hit.at) / 60000)}min old, ` +
                `${hit.lists.movies.length} movies, ${hit.lists.shows.length} shows, read in ${ms}ms`
              : `[xt-vod] disk MISS: stored ${digest(String(v.fp))} != wanted ${digest(want)} in ${ms}ms`,
        );
        resolve(hit ? { at: hit.at, lists: hit.lists } : null);
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

/** Keep these lists for the playlist, in place of the last. Best effort. */
export async function diskPut(pid: string, fp: string, at: number, lists: XtLists): Promise<void> {
  const sealed = await seal(fp);
  if (!sealed) {
    console.warn("[xt-vod] disk write SKIPPED, no SubtleCrypto here, so the lists will download again at every launch");
    return;
  }
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const done = () => {
      db.close();
      resolve();
    };
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put({ fp: sealed, at, lists } satisfies DiskRecord, pid);
      tx.oncomplete = () => {
        console.info(`[xt-vod] disk wrote ${lists.movies.length} movies, ${lists.shows.length} shows (${digest(fp)})`);
        done();
      };
      tx.onerror = () => {
        console.warn(
          "[xt-vod] disk WRITE FAILED, so the lists will download again at every launch:",
          tx.error?.name ?? "unknown",
        );
        done();
      };
      tx.onabort = () => {
        console.warn("[xt-vod] disk write ABORTED, so the lists will download again at every launch:", tx.error?.name ?? "unknown");
        done();
      };
    } catch (e) {
      console.warn("[xt-vod] disk write threw:", e instanceof Error ? e.name : "unknown");
      done();
    }
  });
}

/** Drop one playlist's lists: a playlist taken out of Settings takes its record
 * with it, which holds the account's fingerprint (server, user name and
 * password). */
export async function diskDrop(pid: string): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const done = () => {
      db.close();
      resolve();
    };
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).delete(pid);
      tx.oncomplete = done;
      tx.onerror = done;
      tx.onabort = done;
    } catch {
      done();
    }
  });
}

/** Drop the lists of every playlist whose id is not in `keep`, whatever the
 * record is: a playlist removed with no pick (so nothing named it to drop), or
 * replaced wholesale by a settings import, would otherwise leave its record
 * behind until Clear All Login Info. Best effort, in one transaction. */
export async function diskPrune(keep: ReadonlySet<string>): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const done = () => {
      db.close();
      resolve();
    };
    try {
      const tx = db.transaction(STORE, "readwrite");
      const store = tx.objectStore(STORE);
      const keys = store.getAllKeys();
      keys.onsuccess = () => {
        for (const k of keys.result) if (!keep.has(String(k))) store.delete(k);
      };
      tx.oncomplete = done;
      tx.onerror = done;
      tx.onabort = done;
    } catch {
      done();
    }
  });
}

/** Drop every playlist's lists. Each record carries a hash of its account's
 * fingerprint (server, user name and password), so Clear All Login Info takes
 * them all, as it takes the guide's copy (live/diskCache.ts `diskClear`). */
export async function diskClearAll(): Promise<void> {
  const db = await openDb();
  if (!db) return;
  return new Promise((resolve) => {
    const done = () => {
      db.close();
      resolve();
    };
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).clear();
      tx.oncomplete = done;
      tx.onerror = done;
      tx.onabort = done;
    } catch {
      done();
    }
  });
}
