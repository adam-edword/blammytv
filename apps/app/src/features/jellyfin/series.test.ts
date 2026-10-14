import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

const net = vi.hoisted(() => ({ call: vi.fn() }));
vi.mock("./account", () => ({ jfCall: net.call }));

import { BASE, EP1, EP2, FIX, SEVERANCE, ZZZ, ZZZ_EP, item } from "./fixture";
import { jfIdFor } from "./idmap";
import { forgetSeries, readSeries, seriesKeyOf, unreadSeries } from "./series";
import type { JfConn } from "./store";

const conn: JfConn = { base: BASE, userId: "u1", key: `jf:${BASE}|u1` };
const ok = (Items: unknown[]) => ({ status: 200, data: { Items }, reply: { status: 200, body: "" } });

beforeEach(() => {
  mem.clear();
  forgetSeries();
  vi.clearAllMocks();
});

describe("seriesKeyOf", () => {
  it("is undefined for a show that has not been read, never a guess from the episode", () => {
    expect(seriesKeyOf(conn)(SEVERANCE)).toBeUndefined();
  });
});

describe("unreadSeries", () => {
  it("names each show an episode list mentions once, and none that are known", async () => {
    expect(unreadSeries(conn, [item(EP1), item(EP2), item(ZZZ_EP)]).sort()).toEqual([SEVERANCE, ZZZ].sort());
    net.call.mockResolvedValue(ok([item(SEVERANCE)]));
    await readSeries(conn, [SEVERANCE]);
    expect(unreadSeries(conn, [item(EP1), item(ZZZ_EP)])).toEqual([ZZZ]);
  });

  it("ignores items that are not episodes", () => {
    expect(unreadSeries(conn, [item(FIX.movieId)])).toEqual([]);
  });
});

describe("readSeries", () => {
  it("reads the shows by id, asks for their provider ids, and remembers their keys", async () => {
    net.call.mockResolvedValue(ok([item(SEVERANCE), item(ZZZ)]));
    await readSeries(conn, [SEVERANCE, ZZZ]);
    const [method, path, opts] = net.call.mock.calls[0];
    expect([method, path]).toEqual(["GET", "/Items"]);
    expect(opts.query).toMatchObject({
      userId: "u1",
      Ids: `${SEVERANCE},${ZZZ}`,
      IncludeItemTypes: "Series",
      Fields: "ProviderIds",
    });
    const keyOf = seriesKeyOf(conn);
    expect(keyOf(SEVERANCE)).toBe("tt11280740");
    expect(keyOf(ZZZ)).toBe(`jf:${ZZZ}`);
    // The IMDb one is on disk too, so the next run need not read it.
    expect(jfIdFor(BASE, "tt11280740")).toBe(SEVERANCE);
  });

  it("knows an IMDb-keyed show again after a restart, from disk alone", async () => {
    net.call.mockResolvedValue(ok([item(SEVERANCE)]));
    await readSeries(conn, [SEVERANCE]);
    forgetSeries();
    expect(seriesKeyOf(conn)(SEVERANCE)).toBe("tt11280740");
    // A show with no IMDb id has to be read again; it is never guessed.
    expect(seriesKeyOf(conn)(ZZZ)).toBeUndefined();
  });

  it("asks for forty at a time", async () => {
    net.call.mockResolvedValue(ok([]));
    const ids = Array.from({ length: 85 }, (_, i) => i.toString(16).padStart(32, "0"));
    await readSeries(conn, ids);
    expect(net.call.mock.calls.map((c) => c[2].query.Ids.split(",").length)).toEqual([40, 40, 5]);
  });

  it("leaves a show the server did not answer for unread, so it is asked again", async () => {
    net.call.mockResolvedValue(ok([]));
    await readSeries(conn, [SEVERANCE]);
    expect(seriesKeyOf(conn)(SEVERANCE)).toBeUndefined();
    expect(unreadSeries(conn, [item(EP1)])).toEqual([SEVERANCE]);
  });

  it("ignores a show it did not ask for", async () => {
    net.call.mockResolvedValue(ok([item(ZZZ)]));
    await readSeries(conn, [SEVERANCE]);
    expect(seriesKeyOf(conn)(ZZZ)).toBeUndefined();
  });

  it("rejects when the server does not say 200", async () => {
    net.call.mockResolvedValue({ status: 503, data: null, reply: { status: 503, body: "" } });
    await expect(readSeries(conn, [SEVERANCE])).rejects.toThrow("Jellyfin answered 503");
  });

  it("keeps a read to one server and user", async () => {
    net.call.mockResolvedValue(ok([item(SEVERANCE)]));
    await readSeries(conn, [SEVERANCE]);
    forgetSeries();
    expect(seriesKeyOf({ ...conn, base: "http://other:8096" })(SEVERANCE)).toBeUndefined();
  });
});
