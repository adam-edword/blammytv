import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WatchEntry } from "../stream/watching";
import { packEpisode, packMovie } from "./ids";
import { rememberIds } from "./idmap";
import { replaceAioWatched } from "../stream/watched";
import type { BaseItem } from "./rules";

const call = vi.hoisted(() => vi.fn());
const status = vi.hoisted(() => vi.fn());
vi.mock("./account", () => ({ aioCall: call, readSignIn: vi.fn() }));
vi.mock("./client", () => ({ aiojfStatus: status }));

// An in-memory localStorage: the unit tests run without a DOM. The id map
// (idmap.ts) and the store's sign-in are kept in it.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

import { forgetResume, PLAYED_MAX, readPlayed, sendQueued } from "./sync";

describe("sendQueued", () => {
  it("answers the marks AIOStreams settled, and leaves the rest", async () => {
    const answers: Record<string, { status: number } | null> = {
      a: { status: 200 },
      b: { status: 503 },
      c: null,
      d: { status: 404 },
    };
    const sent = await sendQueued(["a", "b", "c", "d"], async (id) => answers[id]);
    expect(sent).toEqual(["a", "d"]);
  });

  it("counts a send that throws as not sent", async () => {
    const sent = await sendQueued(["a", "b"], async (id) => {
      if (id === "a") throw new Error("offline");
      return { status: 200 };
    });
    expect(sent).toEqual(["b"]);
  });

  it("stops at a 401, since the rest would all be refused", async () => {
    const asked: string[] = [];
    const sent = await sendQueued(["a", "b", "c"], async (id) => {
      asked.push(id);
      return { status: id === "b" ? 401 : 200 };
    });
    expect(asked).toEqual(["a", "b"]);
    expect(sent).toEqual(["a"]);
  });
});

describe("readPlayed (plan 023: AIOStreams answers a page at a time)", () => {
  const items = (from: number, n: number): BaseItem[] => Array.from({ length: n }, (_, i) => ({ Id: String(from + i) }));
  /** A server that holds `total` played items and answers a request with at
   * most `cap` of them, from `StartIndex`, as library.ts `browseLimit` does. */
  const server = (total: number, cap: number) => {
    const asked: [number, number][] = [];
    const page = async (startIndex: number, limit: number) => {
      asked.push([startIndex, limit]);
      return { items: items(startIndex, Math.max(0, Math.min(cap, limit, total - startIndex))), status: 200, total };
    };
    return { asked, page };
  };

  it("reads three pages, StartIndex from 0, and stops when the total is reached", async () => {
    const s = server(500, 200);
    const r = await readPlayed(s.page);
    expect(s.asked).toEqual([[0, 500], [200, 300], [400, 100]]);
    expect(r.items?.length).toBe(500);
    expect(r.items?.map((i) => i.Id)).toEqual(Array.from({ length: 500 }, (_, i) => String(i)));
  });

  it("reads the 300 an instance holds past its 250 cap in two pages", async () => {
    const s = server(300, 250);
    const r = await readPlayed(s.page);
    expect(s.asked).toEqual([[0, 500], [250, 250]]);
    expect(r.items?.length).toBe(300);
  });

  it("stops at an empty page when the answer has no total", async () => {
    const asked: number[] = [];
    const r = await readPlayed(async (startIndex) => {
      asked.push(startIndex);
      return { items: startIndex < 200 ? items(startIndex, 100) : [], status: 200 };
    });
    expect(asked).toEqual([0, 100, 200]);
    expect(r.items?.length).toBe(200);
  });

  it("stops at 500 items, however many AIOStreams says there are, and asks only for what is left", async () => {
    const s = server(900, 250);
    const r = await readPlayed(s.page);
    expect(s.asked).toEqual([[0, 500], [250, 250]]);
    expect(r.items?.length).toBe(PLAYED_MAX);
  });

  it("cuts a server that ignores the limit at 500", async () => {
    const r = await readPlayed(async () => ({ items: items(0, 800), status: 200, total: 800 }));
    expect(r.items?.length).toBe(PLAYED_MAX);
  });

  it("an instance holding nothing played is an empty list, not a failure", async () => {
    const s = server(0, 250);
    const r = await readPlayed(s.page);
    expect(s.asked.length).toBe(1);
    expect(r).toEqual({ items: [], status: 200 });
  });

  it("a page that fails is no list at all, never a partial one, with its status", async () => {
    let n = 0;
    const r = await readPlayed(async (startIndex) => (n++ === 0 ? { items: items(startIndex, 250), status: 200, total: 400 } : { items: null, status: 503 }));
    expect(r).toEqual({ items: null, status: 503 });
    const first = await readPlayed(async () => ({ items: null, status: 401 }));
    expect(first).toEqual({ items: null, status: 401 });
  });
});

describe("forgetResume (a card cleared here clears its resume point on AIOStreams)", () => {
  const BASE = "https://aio.example.com/jellyfin";
  const HASHED = "b2" + "7".repeat(30);
  const FILM_ID = packMovie("tt0111161") as string;
  const EP_ID = packEpisode("tt0903747:3:7") as string;
  const film = (over: Partial<WatchEntry> = {}): WatchEntry => ({
    id: "tt0111161",
    title: "The Shawshank Redemption",
    kind: "movie",
    at: 1,
    posSec: 1200,
    durSec: 8000,
    ...over,
  });
  const episode = (over: Partial<WatchEntry> = {}): WatchEntry => ({
    id: "tt0903747",
    title: "Breaking Bad",
    kind: "series",
    episodeId: "tt0903747:3:7",
    season: 3,
    episode: 7,
    at: 1,
    posSec: 600,
    durSec: 2700,
    ...over,
  });
  const posts = () => call.mock.calls.filter((c) => c[0] === "POST");

  beforeEach(() => {
    mem.clear();
    call.mockReset().mockResolvedValue({ status: 200, data: {}, reply: { status: 200, body: "" } });
    status.mockReset().mockResolvedValue({ supported: true, connected: true, base: BASE });
  });

  it("an unfinished film posts position 0 to its own id", async () => {
    await forgetResume([film()]);
    expect(call).toHaveBeenCalledTimes(1);
    expect(call).toHaveBeenCalledWith("POST", `/UserItems/${FILM_ID}/UserData`, { body: { PlaybackPositionTicks: 0 } });
  });

  it("a show's card clears its episode, by the episode's packed id", async () => {
    await forgetResume([episode()]);
    expect(call).toHaveBeenCalledWith("POST", `/UserItems/${EP_ID}/UserData`, { body: { PlaybackPositionTicks: 0 } });
  });

  it("a finished entry posts nothing: a stop below the line would un-play it, and played marks are never removed from here", async () => {
    await forgetResume([film({ posSec: 7300, durSec: 8000 }), episode({ posSec: 2500, durSec: 2700 })]);
    expect(call).not.toHaveBeenCalled();
    // And it does not even ask whether it is signed in.
    expect(status).not.toHaveBeenCalled();
  });

  it("of several cleared, only the unfinished are posted", async () => {
    await forgetResume([film({ posSec: 7300, durSec: 8000 }), episode()]);
    expect(posts().map((c) => c[1])).toEqual([`/UserItems/${EP_ID}/UserData`]);
  });

  it("signed out posts nothing", async () => {
    status.mockResolvedValue({ supported: true, connected: false });
    await forgetResume([film(), episode()]);
    expect(call).not.toHaveBeenCalled();
  });

  it("a title only the id map can name is cleared by the id its list gave", async () => {
    rememberIds(BASE, [["custom:abc", "movie", HASHED]]);
    await forgetResume([film({ id: "custom:abc" }), episode({ episodeId: `aiojf:${HASHED}`, season: undefined })]);
    expect(posts().map((c) => c[1])).toEqual([`/UserItems/${HASHED}/UserData`, `/UserItems/${HASHED}/UserData`]);
  });

  it("an id it cannot name posts nothing, and a show's card with no episode is not a film", async () => {
    await forgetResume([film({ id: "custom:nothing" }), film({ id: "tt123" }), episode({ episodeId: undefined })]);
    expect(call).not.toHaveBeenCalled();
  });

  it("a failure is silent, and the others still go", async () => {
    call.mockRejectedValueOnce(new Error("offline"));
    await expect(forgetResume([film(), episode()])).resolves.toBeUndefined();
    expect(posts().length).toBe(2);
  });

  it("a card with no position posts nothing: there is no resume point to clear", async () => {
    await forgetResume([film({ posSec: undefined }), episode({ posSec: 0 }), film({ id: "tt0068646" })]);
    expect(posts().map((c) => c[1])).toEqual([`/UserItems/${packMovie("tt0068646")}/UserData`]);
  });

  it("a card AIOStreams counts as played posts nothing, so it is never un-played there (D3)", async () => {
    replaceAioWatched({ episodes: { tt0903747: ["tt0903747:3:7"] }, films: ["tt0111161"] });
    await forgetResume([film(), episode(), episode({ episodeId: "tt0903747:3:8", episode: 8 })]);
    expect(posts().map((c) => c[1])).toEqual([`/UserItems/${packEpisode("tt0903747:3:8")}/UserData`]);
  });
});
