import { afterEach, describe, expect, it, vi } from "vitest";
import { digest, diskDrop, diskGet, diskPrune, diskPut, fingerprint } from "./disk";
import type { XtLists } from "./library";

const lists: XtLists = {
  movies: [{ id: "1", name: "A", title: "A", quality: null, added: 0, adult: false, folderId: "1", ext: "mkv" }],
  shows: [],
  movieFolders: [{ id: "1", name: "Action", adult: false }],
  showFolders: [],
};

/** An IndexedDB that keeps one store in a map and answers on the next tick, as
 * far as disk.ts can tell. */
function fakeIndexedDB() {
  const data = new Map<string, unknown>();
  const later = (f: () => void) => void setTimeout(f, 0);
  const db = {
    objectStoreNames: { contains: () => true },
    createObjectStore: () => undefined,
    close: () => undefined,
    transaction: () => {
      const tx: { oncomplete?: () => void; error: null } = { error: null };
      return Object.assign(tx, {
        objectStore: () => ({
          get: (k: string) => {
            const r: { result?: unknown; onsuccess?: () => void } = {};
            later(() => {
              r.result = structuredClone(data.get(k));
              r.onsuccess?.();
            });
            return r;
          },
          put: (v: unknown, k: string) => {
            data.set(k, structuredClone(v));
            later(() => tx.oncomplete?.());
          },
          delete: (k: string) => {
            data.delete(k);
            later(() => tx.oncomplete?.());
          },
          getAllKeys: () => {
            const r: { result?: unknown[]; onsuccess?: () => void } = {};
            later(() => {
              r.result = [...data.keys()];
              r.onsuccess?.();
              later(() => tx.oncomplete?.());
            });
            return r;
          },
        }),
      });
    },
  };
  return {
    data,
    open: () => {
      const req: { result?: unknown; onsuccess?: () => void; onupgradeneeded?: () => void } = {};
      later(() => {
        req.result = db;
        req.onupgradeneeded?.();
        req.onsuccess?.();
      });
      return req;
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("fingerprint", () => {
  const p = { server: "http://panel.example.invalid:8080/", username: "adam", password: "pw" };

  it("is the account: the server without its trailing slash, the user name and the password", () => {
    expect(fingerprint(p)).toBe(JSON.stringify(["http://panel.example.invalid:8080", "adam", "pw"]));
    expect(fingerprint({ ...p, server: " http://panel.example.invalid:8080 " })).toBe(fingerprint(p));
  });

  it("changes with any of the three", () => {
    const all = new Set([fingerprint(p), fingerprint({ ...p, server: "http://other.invalid" }), fingerprint({ ...p, username: "eve" }), fingerprint({ ...p, password: "x" })]);
    expect(all.size).toBe(4);
  });

  it("has a digest that says nothing of it", () => {
    const d = digest(fingerprint(p));
    expect(d).toMatch(/^[0-9a-z]{1,8}$/);
    expect(d).not.toContain("adam");
  });
});

describe("with no IndexedDB (a node test, a private window that refuses one)", () => {
  it("reads nothing and writes nothing, without throwing", async () => {
    expect(await diskGet("t", "fp")).toBeNull();
    await expect(diskPut("t", "fp", 1, lists)).resolves.toBeUndefined();
    await expect(diskDrop("t")).resolves.toBeUndefined();
    await expect(diskPrune(new Set())).resolves.toBeUndefined();
  });
});

describe("with IndexedDB", () => {
  it("gives back what was written for this playlist and fingerprint, and when", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB());
    vi.spyOn(console, "info").mockImplementation(() => {});
    await diskPut("t", "fp1", 1234, lists);
    expect(await diskGet("t", "fp1")).toEqual({ at: 1234, lists });
  });

  it("is a miss for another account, so an edited playlist never shows the old one's lists", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB());
    vi.spyOn(console, "info").mockImplementation(() => {});
    await diskPut("t", "fp1", 1234, lists);
    expect(await diskGet("t", "fp2")).toBeNull();
    expect(await diskGet("other", "fp1")).toBeNull();
  });

  it("keeps one record per playlist: the next write replaces it, whatever the account", async () => {
    const idb = fakeIndexedDB();
    vi.stubGlobal("indexedDB", idb);
    vi.spyOn(console, "info").mockImplementation(() => {});
    await diskPut("t", "fp1", 1, lists);
    await diskPut("t", "fp2", 2, lists);
    expect(idb.data.size).toBe(1);
    expect(await diskGet("t", "fp1")).toBeNull();
    expect((await diskGet("t", "fp2"))?.at).toBe(2);
  });

  it("is a miss for a record that is not one: another build's, or damaged", async () => {
    const idb = fakeIndexedDB();
    vi.stubGlobal("indexedDB", idb);
    vi.spyOn(console, "info").mockImplementation(() => {});
    // The fingerprint as a record keeps it, so only the shape can be the miss.
    await diskPut("t", "fp1", 1, lists);
    const fp = (idb.data.get("t") as { fp: string }).fp;
    expect((await diskGet("t", "fp1"))?.at).toBe(1);
    for (const bad of [{ fp, at: 1 }, { fp, at: "x", lists }, { fp, at: 1, lists: { movies: [] } }, "junk", 5]) {
      idb.data.set("t", bad);
      expect(await diskGet("t", "fp1")).toBeNull();
    }
  });

  it("keeps no password on disk: the record holds a hash, which still matches its own account and not a changed one", async () => {
    const idb = fakeIndexedDB();
    vi.stubGlobal("indexedDB", idb);
    vi.spyOn(console, "info").mockImplementation(() => {});
    const acct = { server: "http://panel.example.invalid:8080", username: "usr-uniq-3", password: "s3cr3tpassw0rd" };
    await diskPut("t", fingerprint(acct), 77, lists);
    const kept = idb.data.get("t") as { fp: string };
    const all = JSON.stringify(kept);
    for (const secret of [acct.password, acct.username, "panel.example", fingerprint(acct)]) expect(all).not.toContain(secret);
    expect(kept.fp).toMatch(/^[0-9a-f]{64}$/);
    expect(await diskGet("t", fingerprint(acct))).toEqual({ at: 77, lists });
    expect(await diskGet("t", fingerprint({ ...acct, password: "changed-pass" }))).toBeNull();
    expect(await diskGet("t", fingerprint({ ...acct, username: "eve" }))).toBeNull();
  });

  it("treats a record 1.0.0 wrote, with the fingerprint itself in it, as a miss, and the next write replaces it", async () => {
    const idb = fakeIndexedDB();
    vi.stubGlobal("indexedDB", idb);
    const logged: unknown[][] = [];
    vi.spyOn(console, "info").mockImplementation((...a: unknown[]) => void logged.push(a));
    const fp = fingerprint({ server: "http://panel.example.invalid:8080", username: "usr-uniq-4", password: "0ldr3cordpw" });
    idb.data.set("t", { fp, at: 5, lists });
    expect(await diskGet("t", fp)).toBeNull();
    // A miss that says so, and says nothing of the account.
    expect(JSON.stringify(logged)).toContain("disk MISS: stored");
    expect(JSON.stringify(logged)).not.toContain("0ldr3cordpw");
    await diskPut("t", fp, 6, lists);
    expect(JSON.stringify(idb.data.get("t"))).not.toContain("0ldr3cordpw");
    expect(await diskGet("t", fp)).toEqual({ at: 6, lists });
  });

  it("prunes every record whose playlist is not in the list, whether or not it ever had a pick, and keeps the others", async () => {
    const idb = fakeIndexedDB();
    vi.stubGlobal("indexedDB", idb);
    vi.spyOn(console, "info").mockImplementation(() => {});
    await diskPut("t", "fp1", 1, lists);
    await diskPut("gone", "fp2", 2, lists);
    await diskPut("also-gone", "fp3", 3, lists);
    idb.data.set("junk-key", "not a record");
    await diskPrune(new Set(["t", "u"]));
    expect([...idb.data.keys()]).toEqual(["t"]);
    expect((await diskGet("t", "fp1"))?.at).toBe(1);
    // Nothing to prune is nothing to do.
    await expect(diskPrune(new Set(["t"]))).resolves.toBeUndefined();
    expect([...idb.data.keys()]).toEqual(["t"]);
  });

  it("drops one playlist's record and leaves the others', so a removed playlist takes its account with it", async () => {
    const idb = fakeIndexedDB();
    vi.stubGlobal("indexedDB", idb);
    vi.spyOn(console, "info").mockImplementation(() => {});
    await diskPut("t", "fp1", 1, lists);
    await diskPut("u", "fp2", 2, lists);
    await diskDrop("t");
    expect([...idb.data.keys()]).toEqual(["u"]);
    expect(await diskGet("t", "fp1")).toBeNull();
    expect((await diskGet("u", "fp2"))?.at).toBe(2);
    // A playlist with no record is nothing to drop.
    await expect(diskDrop("never-read")).resolves.toBeUndefined();
    expect([...idb.data.keys()]).toEqual(["u"]);
  });

  it("logs a digest and never the fingerprint", async () => {
    vi.stubGlobal("indexedDB", fakeIndexedDB());
    const logged: unknown[][] = [];
    vi.spyOn(console, "info").mockImplementation((...a: unknown[]) => void logged.push(a));
    const fp = fingerprint({ server: "http://panel.example.invalid:8080", username: "usr-uniq-2", password: "s3cr3tpassw0rd" });
    await diskGet("t", fp);
    await diskPut("t", fp, 1, lists);
    await diskGet("t", fp);
    await diskGet("t", fingerprint({ server: "http://panel.example.invalid:8080", username: "usr-uniq-2", password: "changed-pass" }));
    const all = JSON.stringify(logged);
    expect(logged.length).toBeGreaterThanOrEqual(4);
    for (const secret of ["usr-uniq-2", "s3cr3tpassw0rd", "changed-pass", "panel.example"]) expect(all).not.toContain(secret);
  });
});
