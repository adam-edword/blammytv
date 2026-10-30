import { afterEach, describe, expect, it, vi } from "vitest";
import { diskGet, diskPrune, diskPut, type DiskCached } from "./diskCache";

/** An IndexedDB that keeps one store in a map and answers on the next tick, as
 * far as diskCache.ts can tell. A transaction completes after its last request. */
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
              later(() => tx.oncomplete?.());
            });
            return r;
          },
          put: (v: unknown, k: string) => {
            data.set(k, structuredClone(v));
            later(() => tx.oncomplete?.());
          },
          delete: (k: string) => {
            data.delete(k);
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

const catalog = { groups: [], channels: [{ id: "A:1" }], programmes: new Map() } as never;
const PASSWORD = "s3cr3tpassw0rd";
const keyOf = (password = PASSWORD) => JSON.stringify([[["A", "http://panel.example.invalid:8080", "usr-uniq-7", password, []]], false]);
const record = (over: Partial<DiskCached> = {}): DiskCached => ({
  key: keyOf(),
  ids: ["A"],
  at: 5,
  data: catalog,
  normalized: true,
  ...over,
});

const stub = () => {
  const idb = fakeIndexedDB();
  vi.stubGlobal("indexedDB", idb);
  vi.spyOn(console, "info").mockImplementation(() => {});
  return idb;
};

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("with no IndexedDB (a node test, a private window that refuses one)", () => {
  it("reads nothing, writes nothing and prunes nothing, without throwing", async () => {
    vi.spyOn(console, "info").mockImplementation(() => {});
    expect(await diskGet("k")).toBeNull();
    await expect(diskPut(record())).resolves.toBeUndefined();
    await expect(diskPrune(new Set())).resolves.toBeUndefined();
  });
});

describe("the guide's copy", () => {
  it("keeps no password on disk: the record holds a hash, which still matches its own key and not a changed one", async () => {
    const idb = stub();
    await diskPut(record());
    const kept = idb.data.get("live") as { key: string };
    const all = JSON.stringify(kept);
    for (const secret of [PASSWORD, "usr-uniq-7", "panel.example", keyOf()]) expect(all).not.toContain(secret);
    expect(kept.key).toMatch(/^[0-9a-f]{64}$/);
    const hit = await diskGet(keyOf());
    expect(hit?.at).toBe(5);
    expect(hit?.key).toBe(keyOf()); // handed back as the key it was asked for
    expect(hit?.ids).toEqual(["A"]);
    expect(await diskGet(keyOf("changed-pass"))).toBeNull();
  });

  it("treats a record 1.0.1 wrote, with the key itself in it, as a miss, and the next write replaces it", async () => {
    const idb = stub();
    idb.data.set("live", { key: keyOf(), at: 4, data: catalog });
    expect(await diskGet(keyOf())).toBeNull();
    await diskPut(record({ at: 6 }));
    expect(JSON.stringify(idb.data.get("live"))).not.toContain(PASSWORD);
    expect((await diskGet(keyOf()))?.at).toBe(6);
  });

  it("is pruned when it was built from a playlist that is no longer saved, and from an unknown set", async () => {
    const idb = stub();
    await diskPut(record({ ids: ["A", "B"] }));
    expect(idb.data.has("live")).toBe(true);
    await diskPrune(new Set(["A"])); // B deleted
    expect(idb.data.has("live")).toBe(false);

    await diskPut(record({ ids: ["B"] }));
    expect(idb.data.has("live")).toBe(true);
    await diskPrune(new Set()); // the last one deleted
    expect(idb.data.has("live")).toBe(false);

    // 1.0.1's record names no playlist, and holds the key itself.
    idb.data.set("live", { key: keyOf(), at: 4, data: catalog });
    await diskPrune(new Set(["A"]));
    expect(idb.data.has("live")).toBe(false);
  });

  it("stays when every playlist it was built from is still saved, a switched off one included, and an empty prune is nothing", async () => {
    const idb = stub();
    await expect(diskPrune(new Set(["A"]))).resolves.toBeUndefined();
    await diskPut(record({ ids: ["A", "B"] }));
    await diskPrune(new Set(["A", "B", "C"])); // B is switched off, not deleted
    expect((await diskGet(keyOf()))?.at).toBe(5);
    await diskPrune(new Set(["A", "B"]));
    expect(idb.data.has("live")).toBe(true);
  });
});
