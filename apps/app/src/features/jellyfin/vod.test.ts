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

import { loadJfVod, peekJfVod, resolveJfItem, resolveJfList } from "./vod";
import { BASE, EP1, EP3, FIX, SEVERANCE, ZZZ, item } from "./fixture";
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
