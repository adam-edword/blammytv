import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VodItem } from "../stream/model";
import { rememberIds } from "./idmap";

// An in-memory localStorage: the unit tests run without a DOM. The id map
// (idmap.ts) and the store's sign-in are kept in it.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

const aniskip = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => vi.fn());
const call = vi.hoisted(() => vi.fn());
vi.mock("../stream/aniskip", () => ({ getAniskipRanges: aniskip }));
vi.mock("./client", () => ({ aiojfStatus: status }));
vi.mock("./account", () => ({ aioCall: call }));

import { getAioSkips, playSkips } from "./skips";

const film = { id: "tt0111161", kind: "movie" } as VodItem;
const show = { id: "tt0903747", kind: "series" } as VodItem;
const FILM_ID = "a1110100000001b239ffffffff000000";
// Ticks: an intro from 0:30 to 1:30.
const intro = { Items: [{ Type: "Intro", StartTicks: 300_000_000, EndTicks: 900_000_000 }] };
const ok = (data: unknown) => ({ status: 200, data, reply: { status: 200, body: "" } });

beforeEach(() => {
  mem.clear();
  aniskip.mockReset().mockResolvedValue([]);
  status.mockReset().mockResolvedValue({ supported: true, connected: true });
  call.mockReset();
});

describe("getAioSkips", () => {
  it("asks for Intro, Recap and Outro by the packed id, and answers the overlay's ranges", async () => {
    call.mockResolvedValue(ok(intro));
    const r = await getAioSkips(film, undefined);
    expect(call).toHaveBeenCalledWith("GET", `/MediaSegments/${FILM_ID}`, {
      query: { includeSegmentTypes: "Intro,Recap,Outro" },
    });
    expect(r).toEqual([{ type: "op", start: 30, end: 90 }]);
  });

  it("asks once per title, an empty answer included", async () => {
    call.mockResolvedValue(ok({ Items: [] }));
    const other = { id: "tt0000001", kind: "movie" } as VodItem;
    await getAioSkips(other, undefined);
    await getAioSkips(other, undefined);
    expect(call).toHaveBeenCalledTimes(1);
  });

  it("keeps a failed answer out of the cache, so a retry can succeed", async () => {
    const other = { id: "tt0000002", kind: "movie" } as VodItem;
    call.mockResolvedValueOnce({ status: 503, data: null, reply: { status: 503, body: "" } });
    expect(await getAioSkips(other, undefined)).toEqual([]);
    call.mockResolvedValueOnce(ok(intro));
    expect(await getAioSkips(other, undefined)).toHaveLength(1);
  });

  it("signed in, a title only the id map can name is asked by the id its list gave (plan 024)", async () => {
    const BASE = "https://aio.example.com/jellyfin";
    const HASHED = "b2" + "7".repeat(30);
    const odd = { id: "custom:abc", kind: "movie" } as VodItem;
    rememberIds(BASE, [["custom:abc", "movie", HASHED]]);
    // No sign-in: nothing names it.
    expect(await getAioSkips(odd, undefined)).toEqual([]);
    expect(call).not.toHaveBeenCalled();
    mem.set("blammytv.aiojf", JSON.stringify({ v: 1, data: { signedIn: { base: BASE } } }));
    call.mockResolvedValue(ok(intro));
    expect(await getAioSkips(odd, undefined)).toEqual([{ type: "op", start: 30, end: 90 }]);
    expect(call).toHaveBeenCalledWith("GET", `/MediaSegments/${HASHED}`, { query: { includeSegmentTypes: "Intro,Recap,Outro" } });
    // And an episode AIOStreams hashed, by its own hex.
    const EP = "b2" + "8".repeat(30);
    call.mockClear();
    await getAioSkips(show, `aiojf:${EP}`, 1);
    expect(call).toHaveBeenCalledWith("GET", `/MediaSegments/${EP}`, { query: { includeSegmentTypes: "Intro,Recap,Outro" } });
  });

  it("asks nothing for an id it cannot pack, or when the sync is not connected", async () => {
    expect(await getAioSkips({ id: "tt123", kind: "movie" } as VodItem, undefined)).toEqual([]);
    status.mockResolvedValue({ supported: true, connected: false });
    expect(await getAioSkips({ id: "tt0000003", kind: "movie" } as VodItem, undefined)).toEqual([]);
    expect(call).not.toHaveBeenCalled();
  });
});

describe("playSkips (plan 023, D4)", () => {
  it("keeps AniSkip first: AIOStreams is not asked when AniSkip has ranges", async () => {
    aniskip.mockResolvedValue([{ type: "op", start: 5, end: 85 }]);
    expect(await playSkips(show, "tt0903747:1:1", 1)).toEqual([{ type: "op", start: 5, end: 85 }]);
    expect(call).not.toHaveBeenCalled();
  });

  it("asks AIOStreams when AniSkip has nothing", async () => {
    call.mockResolvedValue(ok(intro));
    const r = await playSkips(show, "tt0903747:2:3", 2);
    expect(call).toHaveBeenCalledTimes(1);
    expect(r).toEqual([{ type: "op", start: 30, end: 90 }]);
  });

  it("is silent when either side fails", async () => {
    aniskip.mockRejectedValue(new Error("down"));
    call.mockRejectedValue(new Error("down"));
    expect(await playSkips(show, "tt0903747:2:4", 2)).toEqual([]);
  });
});
