import { beforeEach, describe, expect, it, vi } from "vitest";

const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

const net = vi.hoisted(() => ({ call: vi.fn(), idFor: vi.fn(), aniskip: vi.fn(), aio: vi.fn() }));
vi.mock("./account", () => ({ jfCall: net.call }));
vi.mock("./vod", () => ({ jfItemIdFor: net.idFor }));
vi.mock("../stream/aniskip", () => ({ getAniskipRanges: net.aniskip }));
vi.mock("../aiojf/account", () => ({ aioCall: net.aio }));
vi.mock("../aiojf/client", () => ({ aiojfStatus: vi.fn(async () => ({ connected: true })) }));

import { getJfSkips } from "./skips";
import { noteSignIn } from "./store";
import { playSkips } from "../aiojf/skips";
import type { VodItem } from "../stream/model";

const TICKS = 10_000_000;
const seg = (Type: string, a: number, b: number) => ({ Type, StartTicks: a * TICKS, EndTicks: b * TICKS, ItemId: "x" });
const ok = (data: unknown) => ({ status: 200, data, reply: { status: 200, body: "" } });
const show = { id: "tt11280740", kind: "series", from: "jf" } as unknown as VodItem;

// The answers are kept for the session, per item: each test is another item.
let n = 0;
const fresh = () => (++n).toString(16).padStart(32, "0");

beforeEach(() => {
  mem.clear();
  vi.clearAllMocks();
  noteSignIn({ supported: true, connected: true, userName: "t", userId: "u1", base: "http://h:8096" });
  net.idFor.mockImplementation(async () => fresh());
  net.aniskip.mockResolvedValue([]);
});

describe("getJfSkips", () => {
  it("reads the item's own markers, as the overlay's skip types, with no credential", async () => {
    net.call.mockResolvedValue(ok({ Items: [seg("Outro", 500, 560), seg("Intro", 10, 70), seg("Commercial", 1, 2)] }));
    const r = await getJfSkips({ id: "tt11280740", kind: "series" }, "tt11280740:1:3");
    expect(r).toEqual([
      { type: "op", start: 10, end: 70 },
      { type: "ed", start: 500, end: 560 },
    ]);
    expect(net.idFor).toHaveBeenCalledWith("series", "tt11280740:1:3");
    expect(net.call.mock.calls[0].slice(0, 2)).toEqual(["GET", expect.stringMatching(/^\/MediaSegments\/[0-9a-f]{32}$/)]);
    expect(JSON.stringify(net.call.mock.calls)).not.toMatch(/api_?key|token/i);
  });

  it("asks once for an item, empty answers included", async () => {
    net.idFor.mockResolvedValue(fresh());
    net.call.mockResolvedValue(ok({ Items: [] }));
    await getJfSkips({ id: "tt1", kind: "movie" }, null);
    await getJfSkips({ id: "tt1", kind: "movie" }, null);
    expect(net.call).toHaveBeenCalledTimes(1);
  });

  it("does not keep a failure, so a retry can succeed", async () => {
    net.idFor.mockResolvedValue(fresh());
    net.call.mockResolvedValueOnce({ status: 500, data: null, reply: { status: 500, body: "" } });
    expect(await getJfSkips({ id: "tt2", kind: "movie" }, null)).toEqual([]);
    net.call.mockResolvedValueOnce(ok({ Items: [seg("Intro", 1, 9)] }));
    expect(await getJfSkips({ id: "tt2", kind: "movie" }, null)).toHaveLength(1);
  });

  it("is empty when the item cannot be told, or an episode comes without its id", async () => {
    net.idFor.mockResolvedValue(null);
    expect(await getJfSkips({ id: "tt3", kind: "movie" }, null)).toEqual([]);
    expect(await getJfSkips({ id: "tt4", kind: "series" }, null)).toEqual([]);
    expect(net.call).not.toHaveBeenCalled();
  });
});

describe("playSkips for a file from your own Jellyfin", () => {
  it("uses the server's markers, and never asks AIOStreams, whose were made for another file", async () => {
    net.call.mockResolvedValue(ok({ Items: [seg("Intro", 5, 50)] }));
    expect(await playSkips(show, "tt11280740:1:3", 1)).toEqual([{ type: "op", start: 5, end: 50 }]);
    expect(net.aio).not.toHaveBeenCalled();
  });

  it("falls to AniSkip when the server has none, and still never asks AIOStreams", async () => {
    net.call.mockResolvedValue(ok({ Items: [] }));
    net.aniskip.mockResolvedValue([{ type: "op", start: 1, end: 2 }]);
    expect(await playSkips(show, "tt11280740:1:2", 1)).toEqual([{ type: "op", start: 1, end: 2 }]);
    expect(net.aio).not.toHaveBeenCalled();
  });
});
