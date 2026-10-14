import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

const net = vi.hoisted(() => ({
  call: vi.fn(),
  sources: vi.fn(),
  prepare: vi.fn(),
}));
vi.mock("./account", () => ({ jfCall: net.call }));
vi.mock("./client", () => ({ jfSources: net.sources, jfPrepareStream: net.prepare }));

import { fetchJfPage, loadJfDiscover, loadJfVod, peekJfVod, resolveJfItem, resolveJfList, searchJf } from "./vod";
import { BASE, EP1, EP3, FIX, SEVERANCE, ZZZ, item } from "./fixture";
import { jfIdFor } from "./idmap";
import { forgetJf, loadJfConn, noteSignIn } from "./store";
import type { JfItem } from "./items";

const USER = "u1";
const series = (id: string) => item(id).Id as string;
const episodesOf = (sid: string): JfItem[] =>
  Object.values(FIX.items).filter((i) => i.Type === "Episode" && i.SeriesId === sid);
const ok = (data: unknown) => ({ status: 200, data, reply: { status: 200, body: "" } });
const notOk = (status: number) => ({ status, data: null, reply: { status, body: "" } });

/** What the server answers, built from its real records. */
function serve(path: string, opts: { query?: Record<string, string> } = {}) {
  const q = opts.query ?? {};
  if (path === "/UserViews") return Promise.resolve(ok({ Items: FIX.views }));
  if (path === "/Items") {
    const inView = Object.values(FIX.items).filter(
      (i) =>
        (q.IncludeItemTypes === "Movie" && i.Type === "Movie") || (q.IncludeItemTypes === "Series" && i.Type === "Series"),
    );
    return Promise.resolve(ok({ Items: inView }));
  }
  const ep = /^\/Shows\/([0-9a-f]{32})\/Episodes$/.exec(path);
  if (ep) return Promise.resolve(ok({ Items: episodesOf(ep[1]) }));
  const one = /^\/Items\/([0-9a-f]{32})$/.exec(path);
  if (one) return Promise.resolve(FIX.items[one[1]] ? ok(FIX.items[one[1]]) : notOk(404));
  return Promise.resolve(notOk(404));
}

/** The calls never carried a credential. */
const credentialFree = (): boolean =>
  net.call.mock.calls.every((c) => !/api_?key|token|X-Emby/i.test(JSON.stringify(c)));

const signIn = () =>
  noteSignIn({ supported: true, connected: true, userName: "testuser", userId: USER, base: BASE, serverName: "Home" });

beforeEach(() => {
  mem.clear();
  vi.clearAllMocks();
  net.call.mockImplementation((_m: string, path: string, opts?: { query?: Record<string, string> }) => serve(path, opts));
  net.prepare.mockResolvedValue({ ok: true, needsAuth: false, status: 206, offOrigin: false });
  net.sources.mockImplementation(async (id: string) => ({
    status: 200,
    sources: (FIX.playbackInfo[id] ?? FIX.playbackInfo[EP3]).MediaSources,
  }));
  forgetJf();
});

describe("loadJfVod", () => {
  it("is empty with no server, and asks nothing", async () => {
    const d = await loadJfVod(true);
    expect(d).toEqual({ items: new Map(), rows: [], featured: [] });
    expect(net.call).not.toHaveBeenCalled();
    expect(peekJfVod()).toBeNull();
  });

  it("makes a row of each library, its titles marked as from Jellyfin", async () => {
    signIn();
    const d = await loadJfVod(true);
    expect(d.error).toBeUndefined();
    expect(d.rows.map((r) => r.title)).toEqual(["Movies", "Shows"]);
    expect(d.rows[0].id).toBe(`jf:${FIX.views[0].Id}`);
    expect(d.items.size).toBeGreaterThan(0);
    for (const i of d.items.values()) expect(i.from).toBe("jf");
    // Every call named the session's user and an item type.
    for (const [, , o] of net.call.mock.calls.filter((c) => c[1] === "/Items"))
      expect(o.query).toMatchObject({ userId: USER, IncludeItemTypes: expect.stringMatching(/Movie|Series/) });
    expect(credentialFree()).toBe(true);
  });

  it("keys a show by its IMDb id, and one with none by its own id", async () => {
    signIn();
    const d = await loadJfVod(true);
    expect(d.items.has("tt11280740")).toBe(true);
    expect(d.items.get("tt11280740")?.kind).toBe("series");
    expect(d.items.has(`jf:${ZZZ}`)).toBe(true);
  });

  it("draws a hero from the titles that came with a backdrop", async () => {
    signIn();
    const d = await loadJfVod(true);
    expect(d.featured.length).toBeGreaterThan(0);
    for (const id of d.featured) expect(d.items.get(id)?.backdrop).toBeTruthy();
  });

  it("reads a 401 as signed out, and keeps nothing", async () => {
    signIn();
    net.call.mockResolvedValue(notOk(401));
    const d = await loadJfVod(true);
    expect(d.error).toMatch(/signed you out/);
    expect(peekJfVod()).toBeNull();
  });

  it("keeps the other libraries when one fails", async () => {
    signIn();
    net.call.mockImplementation((_m: string, path: string, opts?: { query?: Record<string, string> }) =>
      path === "/Items" && opts?.query?.IncludeItemTypes === "Movie" ? Promise.resolve(notOk(500)) : serve(path, opts),
    );
    const d = await loadJfVod(true);
    expect(d.error).toBeUndefined();
    expect(d.rows.map((r) => r.title)).toEqual(["Shows"]);
  });

  it("is mirrored for the next launch, and gone with a sign-out", async () => {
    signIn();
    await loadJfVod(true);
    expect(peekJfVod()?.rows.length).toBe(2);
    forgetJf();
    expect(loadJfConn()).toBeNull();
    expect(peekJfVod()).toBeNull();
    expect(mem.has("blammytv.jfVodCache")).toBe(false);
    expect(mem.has("blammytv.jfIds")).toBe(false);
  });
});

describe("resolveJfItem", () => {
  it("answers a show's detail with its seasons, under the key it was asked", async () => {
    signIn();
    await loadJfVod(true); // names the key
    const v = await resolveJfItem("tt11280740");
    expect(v?.id).toBe("tt11280740");
    expect(v?.from).toBe("jf");
    expect(v?.kind).toBe("series");
    expect(v?.seasons.flatMap((s) => s.episodes).length).toBe(episodesOf(SEVERANCE).length);
  });

  it("knows an opaque key without having read a list", async () => {
    signIn();
    const v = await resolveJfItem(`jf:${ZZZ}`);
    expect(v?.id).toBe(`jf:${ZZZ}`);
    expect(v?.from).toBe("jf");
  });

  it("is null for an IMDb key this device has not seen, and for a title the server dropped", async () => {
    signIn();
    expect(await resolveJfItem("tt0000001")).toBeNull();
    net.call.mockResolvedValue(notOk(404));
    expect(await resolveJfItem(`jf:${series(ZZZ)}`)).toBeNull();
  });

  it("throws for a server error, so the page can offer a retry", async () => {
    signIn();
    net.call.mockResolvedValue(notOk(500));
    await expect(resolveJfItem(`jf:${ZZZ}`)).rejects.toThrow(/500/);
  });
});

describe("resolveJfList", () => {
  it("lists a film's files as direct streams that carry no token, and checks the first", async () => {
    signIn();
    await loadJfVod(true);
    const l = await resolveJfList("movie", "tt2043923");
    expect(l.notices).toEqual([]);
    expect(l.sources.length).toBeGreaterThan(0);
    for (const s of l.sources) {
      expect(s.cached).toBe(true);
      expect(s.streamUrl).toMatch(new RegExp(`^${BASE}/Videos/[0-9a-f]{32}/stream\\?static=true&mediaSourceId=`));
      expect(s.streamUrl).not.toMatch(/api_?key|token/i);
    }
    expect(net.prepare).toHaveBeenCalledWith(l.sources[0].streamUrl);
  });

  it("finds an episode by its show's key and numbers", async () => {
    signIn();
    await loadJfVod(true);
    const l = await resolveJfList("series", "tt11280740:1:1");
    expect(l.sources.length).toBeGreaterThan(0);
    expect(net.sources).toHaveBeenCalledWith(EP1);
  });

  it("says why when the title is not in the library, or has no file, or the server failed", async () => {
    signIn();
    expect((await resolveJfList("movie", "tt0000001")).notices[0]).toMatch(/not in your Jellyfin/);
    net.sources.mockResolvedValueOnce({ status: 200, sources: [] });
    expect((await resolveJfList("movie", `jf:${ZZZ}`)).notices[0]).toMatch(/no playable file/);
    net.sources.mockResolvedValueOnce({ status: 404, sources: [] });
    expect((await resolveJfList("movie", `jf:${ZZZ}`)).notices[0]).toMatch(/any more/);
    net.sources.mockResolvedValueOnce({ status: 500, sources: [] });
    expect((await resolveJfList("movie", `jf:${ZZZ}`)).notices[0]).toMatch(/500/);
    expect(net.prepare).not.toHaveBeenCalled();
  });

  it("still lists the files when the stream check fails", async () => {
    signIn();
    net.prepare.mockRejectedValue(new Error("refused: not a direct stream"));
    const l = await resolveJfList("movie", `jf:${ZZZ}`);
    expect(l.sources.length).toBeGreaterThan(0);
  });

  it("is empty with no server", async () => {
    expect(await resolveJfList("movie", "tt1")).toEqual({ sources: [], notices: [] });
  });
});

describe("Discover's side", () => {
  it("has nothing with no server, and asks nothing", async () => {
    expect(await loadJfDiscover()).toBeNull();
    expect(await fetchJfPage({ type: "movie", id: FIX.views[0].Id as string }, null, 0)).toEqual([]);
    expect(await searchJf("movie", "x")).toEqual([]);
    expect(net.call).not.toHaveBeenCalled();
  });

  it("takes its libraries and genres off the build Stream's rows come from", async () => {
    signIn();
    const d = await loadJfDiscover();
    expect(d?.catalogs.map((c) => [c.type, c.name])).toEqual([
      ["movie", "Movies"],
      ["series", "Shows"],
    ]);
    expect(d?.catalogs.map((c) => c.id)).toEqual(FIX.views.map((v) => v.Id));
    expect(d?.conn.base).toBe(BASE);
    // One /UserViews and one page per library, the same as Stream's: nothing
    // more is read for Discover.
    const asked = net.call.mock.calls.length;
    await loadJfDiscover();
    expect(net.call.mock.calls.length).toBe(asked);
    expect(credentialFree()).toBe(true);
  });

  it("lists each genre once, in the order its titles first carry it", async () => {
    signIn();
    const d = await loadJfDiscover();
    const all = Object.values(FIX.items).flatMap((i) => i.Genres ?? []);
    expect(new Set(d?.genres.map((g) => g.toLowerCase())).size).toBe(d?.genres.length);
    for (const g of d?.genres ?? []) expect(all.map((x) => String(x).toLowerCase())).toContain(g.toLowerCase());
  });

  it("throws what the server said when it could not be read", async () => {
    signIn();
    net.call.mockResolvedValue(notOk(401));
    await expect(loadJfDiscover()).rejects.toThrow(/signed you out/);
  });

  it("pages a library with the skip and the genre, as items from Jellyfin, and remembers their ids", async () => {
    signIn();
    const lib = FIX.views[0].Id as string;
    const page = await fetchJfPage({ type: "movie", id: lib }, "Drama", 50);
    const call = net.call.mock.calls.find((c) => c[1] === "/Items")!;
    expect(call[2].query).toMatchObject({
      userId: USER,
      ParentId: lib,
      IncludeItemTypes: "Movie",
      StartIndex: "50",
      Genres: "Drama",
    });
    expect(page.length).toBeGreaterThan(0);
    for (const i of page) expect(i.from).toBe("jf");
    // A card read here opens: its key leads back to the server's item.
    expect(jfIdFor(BASE, page[0].id)).toBeTruthy();
  });

  it("asks for no genre when there is none, and rejects on a non-200 so a blip is not an empty library", async () => {
    signIn();
    await fetchJfPage({ type: "series", id: FIX.views[1].Id as string }, null, 0);
    expect(net.call.mock.calls.find((c) => c[1] === "/Items")![2].query).not.toHaveProperty("Genres");
    net.call.mockResolvedValue(notOk(500));
    await expect(fetchJfPage({ type: "movie", id: lib0() }, null, 0)).rejects.toThrow("Jellyfin answered 500");
  });

  it("searches every library for one type, by the term", async () => {
    signIn();
    const out = await searchJf("series", "sever");
    const call = net.call.mock.calls.find((c) => c[1] === "/Items")!;
    expect(call[2].query).toMatchObject({ userId: USER, IncludeItemTypes: "Series", SearchTerm: "sever" });
    expect(call[2].query).not.toHaveProperty("ParentId");
    expect(out.every((i) => i.from === "jf" && i.kind === "series")).toBe(true);
    net.call.mockResolvedValue(notOk(404));
    await expect(searchJf("movie", "x")).rejects.toThrow("Jellyfin answered 404");
  });
});

const lib0 = (): string => FIX.views[0].Id as string;
