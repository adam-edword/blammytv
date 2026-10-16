import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory localStorage and a bare window: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
const bus = new EventTarget();
vi.stubGlobal("window", bus);

const net = vi.hoisted(() => ({ call: vi.fn(), signIn: vi.fn() }));
vi.mock("./account", () => ({ jfCall: net.call, readSignIn: net.signIn }));

import { BASE, EP1, EP2, EP3, FIX, SEVERANCE, ZZZ, ZZZ_EP, item } from "./fixture";
import type { JfItem } from "./items";
import { forgetCount, forgetJf, JF_SYNCED, loadJf, noteSignIn } from "./store";
import { forgetSeries } from "./series";
import { forgetResume, noteResumeJid, syncJf } from "./sync";
import { TRAKT_SYNCED } from "../trakt/store";
import { loadLedger, loadWatched, loadJfWatched, replaceJfWatched } from "../stream/watched";
import { save } from "../../lib/storage";
import { loadWatching, replaceWatching, type WatchEntry } from "../stream/watching";

const TICKS = 10_000_000;
const USER = "u1";
const ON = { supported: true, connected: true, userName: "testuser", userId: USER, base: BASE, serverName: "Home" };
const OFF = { supported: true, connected: false };

const withData = (i: JfItem, ud: Record<string, unknown>): JfItem => ({ ...i, UserData: { ...i.UserData, ...ud } }) as JfItem;
const ok = (data: unknown) => ({ status: 200, data, reply: { status: 200, body: "" } });
const notOk = (status: number) => ({ status, data: null, reply: { status, body: "" } });

/** What the server holds: the lists the sync reads. */
const srv = {
  resume: [] as JfItem[],
  played: [] as JfItem[],
  next: [] as JfItem[],
  shows: [item(SEVERANCE), item(ZZZ)],
  fail: {} as Record<string, number>,
};

function serve(_method: string, path: string, opts: { query?: Record<string, string> } = {}) {
  const q = opts.query ?? {};
  if (srv.fail[path]) return Promise.resolve(notOk(srv.fail[path]));
  if (path === "/UserItems/Resume") return Promise.resolve(ok({ Items: srv.resume }));
  if (path === "/Shows/NextUp") return Promise.resolve(ok({ Items: srv.next }));
  if (path === "/Items" && q.Ids) {
    const ids = q.Ids.split(",");
    return Promise.resolve(ok({ Items: srv.shows.filter((s) => ids.includes(s.Id as string)) }));
  }
  if (path === "/Items" && q.IsPlayed === "true") {
    const start = Number(q.StartIndex ?? 0);
    const lim = Number(q.Limit ?? 1e9);
    return Promise.resolve(ok({ Items: srv.played.slice(start, start + lim), TotalRecordCount: srv.played.length }));
  }
  return Promise.resolve(notOk(404));
}

const calls = (path: string) => net.call.mock.calls.filter((c) => c[1] === path);
const SEV = "tt11280740";

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  mem.clear();
  vi.clearAllMocks();
  forgetSeries();
  Object.assign(srv, { resume: [], played: [], next: [], shows: [item(SEVERANCE), item(ZZZ)], fail: {} });
  net.call.mockImplementation(serve);
  net.signIn.mockImplementation(async () => {
    noteSignIn(ON);
    return ON;
  });
  noteSignIn(ON);
});

describe("syncJf", () => {
  it("does nothing, and asks nothing, with no server signed in", async () => {
    net.signIn.mockResolvedValue(OFF);
    forgetJf();
    const r = await syncJf();
    expect(r).toEqual({ ok: false, changed: false, problem: "not connected" });
    expect(net.call).not.toHaveBeenCalled();
  });

  it("brings a resume point into Continue Watching as a Jellyfin card, and keeps the item for clearing it", async () => {
    srv.resume = [withData(item(EP2), { PlaybackPositionTicks: 90 * TICKS, LastPlayedDate: "2026-10-13T12:00:00.0000000Z" })];
    const heard: string[] = [];
    bus.addEventListener(TRAKT_SYNCED, () => heard.push("trakt"));
    bus.addEventListener(JF_SYNCED, () => heard.push("jf"));
    const r = await syncJf();
    expect(r.ok).toBe(true);
    expect(r.changed).toBe(true);
    const [w] = loadWatching();
    expect(w).toMatchObject({ id: SEV, from: "jf", episodeId: `${SEV}:1:2`, posSec: 90, kind: "series", title: "Severance" });
    expect(loadJf().resumeJids).toEqual({ [`${SEV}|${SEV}:1:2`]: EP2 });
    expect(loadJf().lastSync).toBeGreaterThan(0);
    expect(heard).toContain("trakt");
    expect(heard).toContain("jf");
  });

  it("asks only for what the app makes, as the signed-in user, with no credential", async () => {
    await syncJf();
    expect(calls("/UserItems/Resume")[0][2].query).toMatchObject({ userId: USER, Fields: "ProviderIds", Limit: "20" });
    expect(calls("/Shows/NextUp")[0][2].query).toMatchObject({ userId: USER, EnableResumable: "false" });
    expect(calls("/Items")[0][2].query).toMatchObject({
      userId: USER,
      IsPlayed: "true",
      Recursive: "true",
      IncludeItemTypes: "Movie,Episode",
    });
    expect(net.call.mock.calls.every((c) => c[0] === "GET")).toBe(true);
    expect(JSON.stringify(net.call.mock.calls)).not.toMatch(/api_?key|token|X-Emby/i);
  });

  it("ticks what the server says is played, and nothing it only counted", async () => {
    srv.played = [
      withData(item(EP1), { Played: true, PlayCount: 1 }),
      withData(item(EP2), { Played: false, PlayCount: 5 }),
      item(FIX.movieId),
    ];
    await syncJf();
    expect(loadJfWatched()).toEqual({ episodes: { [SEV]: [`${SEV}:1:1`] }, films: ["tt2043923"] });
    expect([...loadWatched(SEV)]).toEqual([`${SEV}:1:1`]);
  });

  it("replaces the played list whole, so un-marking it on the server un-ticks here", async () => {
    srv.played = [withData(item(EP1), { Played: true }), withData(item(EP2), { Played: true })];
    await syncJf();
    expect(loadWatched(SEV).size).toBe(2);
    srv.played = [withData(item(EP1), { Played: true })];
    await syncJf();
    expect([...loadWatched(SEV)]).toEqual([`${SEV}:1:1`]);
  });

  it("keeps the last played list when the shows could not be read, rather than un-ticking everything", async () => {
    srv.played = [withData(item(EP1), { Played: true })];
    await syncJf();
    // A fresh run: nothing about the shows is remembered, and the server
    // cannot be asked for them.
    forgetSeries();
    for (const k of [...mem.keys()]) if (k.includes("jfIds")) mem.delete(k);
    net.call.mockImplementation((m: string, p: string, o: { query?: Record<string, string> }) =>
      p === "/Items" && o.query?.Ids ? Promise.resolve(notOk(503)) : serve(m, p, o),
    );
    const r = await syncJf();
    expect(r.ok).toBe(false);
    expect(r.problem).toBe("Jellyfin answered 503");
    expect([...loadWatched(SEV)]).toEqual([`${SEV}:1:1`]);
  });

  it("stores Next Up, keyed on the show, with the base its art comes from", async () => {
    srv.next = [item(EP2)];
    await syncJf();
    expect(loadJf().nextUp).toEqual([
      expect.objectContaining({ seriesId: SEV, episodeId: `${SEV}:1:2`, seriesTitle: "Severance" }),
    ]);
    expect(loadJf().signedIn?.base).toBe(BASE);
  });

  it("reads each show an episode names once, in one request", async () => {
    srv.resume = [withData(item(EP2), { PlaybackPositionTicks: 5 * TICKS })];
    srv.played = [withData(item(EP1), { Played: true }), withData(item(ZZZ_EP), { Played: true })];
    srv.next = [item(EP3)];
    await syncJf();
    const reads = calls("/Items").filter((c) => c[2].query.Ids);
    expect(reads).toHaveLength(1);
    expect(reads[0][2].query.Ids.split(",").sort()).toEqual([SEVERANCE, ZZZ].sort());
  });

  it("reads a long played list a page at a time, newest first", async () => {
    srv.played = Array.from({ length: 1200 }, (_, i) => ({ Id: i.toString(16).padStart(32, "0"), Type: "Folder" }) as JfItem);
    await syncJf();
    const pages = calls("/Items").filter((c) => c[2].query.IsPlayed);
    expect(pages.map((c) => [c[2].query.StartIndex, c[2].query.Limit])).toEqual([
      ["0", "500"],
      ["500", "500"],
      ["1000", "500"],
    ]);
    expect(pages[0][2].query).toMatchObject({ SortBy: "DatePlayed", SortOrder: "Descending" });
  });

  it("reports a 401 and writes no data back", async () => {
    srv.fail["/UserItems/Resume"] = 401;
    const r = await syncJf();
    expect(r).toEqual({ ok: false, changed: false, problem: "Signed out of Jellyfin" });
    expect(loadJf().problem).toBe("Signed out of Jellyfin");
    expect(loadWatching()).toEqual([]);
  });

  it("says what failed, and still keeps what it did read", async () => {
    srv.fail["/Shows/NextUp"] = 500;
    srv.resume = [withData(item(EP2), { PlaybackPositionTicks: 5 * TICKS })];
    const r = await syncJf();
    expect(r.ok).toBe(false);
    expect(r.problem).toBe("Jellyfin answered 500 for Next Up");
    expect(loadWatching()).toHaveLength(1);
    expect(loadJf().nextUp).toBeUndefined();
  });

  it("writes nothing back after a sign-out lands mid-pass", async () => {
    srv.resume = [withData(item(EP2), { PlaybackPositionTicks: 5 * TICKS })];
    srv.played = [withData(item(EP1), { Played: true })];
    net.call.mockImplementation(async (m: string, p: string, o: { query?: Record<string, string> }) => {
      const r = await serve(m, p, o);
      if (p === "/Shows/NextUp") forgetJf();
      return r;
    });
    const r = await syncJf();
    expect(r.problem).toBe("signed out");
    expect(loadJf()).toEqual({});
    expect(loadJfWatched()).toEqual({ episodes: {}, films: [] });
    expect(loadWatching()).toEqual([]);
  });

  it("shares one pass between callers", async () => {
    const a = syncJf();
    const b = syncJf();
    expect(a).toBe(b);
    await a;
    expect(calls("/UserItems/Resume")).toHaveLength(1);
  });

  it("clears what it kept when the vault is empty but this device still holds an account", async () => {
    await syncJf();
    expect(loadJf().lastSync).toBeGreaterThan(0);
    net.signIn.mockResolvedValue(OFF);
    await syncJf();
    expect(loadJf()).toEqual({});
  });
});

describe("two sources, one watch (plan 027, D5)", () => {
  it("shows one tick for an episode Trakt and Jellyfin both have, and sends Trakt nothing from Jellyfin", async () => {
    // Trakt's ledger is the local one (a Trakt sync replaces its IMDb series),
    // and it is the only one trakt/sync.ts pushes.
    save("watchedEpisodes", 1, { [SEV]: [`${SEV}:1:1`, `${SEV}:1:9`] });
    srv.played = [withData(item(EP1), { Played: true }), withData(item(EP2), { Played: true })];
    await syncJf();
    expect([...loadWatched(SEV)].sort()).toEqual([`${SEV}:1:1`, `${SEV}:1:2`, `${SEV}:1:9`]);
    // Jellyfin's two did not reach the ledger: Trakt would otherwise be sent
    // :1:2, and a watch it already has would count again.
    expect(loadLedger()).toEqual({ [SEV]: [`${SEV}:1:1`, `${SEV}:1:9`] });
  });

  it("keeps one Continue Watching card per title, the newer side's", async () => {
    const mine: WatchEntry = {
      id: SEV,
      kind: "series",
      title: "Severance",
      episodeId: `${SEV}:1:3`,
      season: 1,
      episode: 3,
      posSec: 40,
      at: Date.UTC(2026, 9, 14),
    };
    replaceWatching([mine]);
    // Jellyfin has an older point on another episode of the same show.
    srv.resume = [withData(item(EP2), { PlaybackPositionTicks: 90 * TICKS, LastPlayedDate: "2026-10-13T12:00:00.0000000Z" })];
    await syncJf();
    expect(loadWatching()).toEqual([mine]);
    // And a newer one takes the card over: still one.
    srv.resume = [withData(item(EP2), { PlaybackPositionTicks: 90 * TICKS, LastPlayedDate: "2026-10-15T12:00:00.0000000Z" })];
    await syncJf();
    expect(loadWatching()).toHaveLength(1);
    expect(loadWatching()[0]).toMatchObject({ id: SEV, episodeId: `${SEV}:1:2`, from: "jf" });
  });
});

describe("forgetResume", () => {
  const card = (over: Partial<WatchEntry> = {}): WatchEntry => ({
    id: SEV,
    kind: "series",
    title: "Severance",
    episodeId: `${SEV}:1:2`,
    posSec: 90,
    durSec: 300,
    at: 1,
    ...over,
  });
  const synced = async () => {
    srv.resume = [withData(item(EP2), { PlaybackPositionTicks: 90 * TICKS })];
    await syncJf();
    vi.clearAllMocks();
    net.call.mockImplementation(serve);
  };

  it("resets the server's position for a card cleared here, with the id the server gave", async () => {
    await synced();
    await forgetResume([card()]);
    expect(net.call).toHaveBeenCalledTimes(1);
    expect(net.call.mock.calls[0].slice(0, 2)).toEqual(["POST", `/UserItems/${EP2}/UserData`]);
    expect(net.call.mock.calls[0][2].body).toEqual({ PlaybackPositionTicks: 0, Played: false });
  });

  it("leaves a finished card, one with no position, and one it never saw alone", async () => {
    await synced();
    await forgetResume([
      card({ posSec: 295 }),
      card({ posSec: undefined }),
      card({ episodeId: `${SEV}:1:3`, posSec: 10 }),
    ]);
    expect(net.call).not.toHaveBeenCalled();
  });

  it("never un-plays: a card the server counts as played is left alone", async () => {
    await synced();
    replaceJfWatched({ episodes: { [SEV]: [`${SEV}:1:2`] }, films: [] });
    await forgetResume([card()]);
    expect(net.call).not.toHaveBeenCalled();
  });

  it("does nothing when not signed in", async () => {
    await synced();
    forgetJf();
    await forgetResume([card()]);
    expect(net.call).not.toHaveBeenCalled();
  });

  it("resets the position of a play made since the last sync, once the play has named its item", async () => {
    // No sync has seen this episode: only the report did.
    noteResumeJid(SEV, `${SEV}:1:2`, EP2, forgetCount());
    await forgetResume([card()]);
    expect(net.call).toHaveBeenCalledTimes(1);
    expect(net.call.mock.calls[0].slice(0, 2)).toEqual(["POST", `/UserItems/${EP2}/UserData`]);
    expect(net.call.mock.calls[0][2].body).toEqual({ PlaybackPositionTicks: 0, Played: false });
  });

  it("keeps what a sync filed, and files a film under its title alone", async () => {
    await synced();
    noteResumeJid("tt2043923", undefined, "movie-jid", forgetCount());
    expect(loadJf().resumeJids).toEqual({ [`${SEV}|${SEV}:1:2`]: EP2, "tt2043923|": "movie-jid" });
  });

  it("keeps a play reported while a sync was already running", async () => {
    // The server's Resume list is read before the play, so it can't name it.
    net.call.mockImplementation((method: string, path: string, opts?: { query?: Record<string, string> }) => {
      if (path === "/Shows/NextUp") noteResumeJid("tt2043923", undefined, "movie-jid", forgetCount());
      return serve(method, path, opts);
    });
    await syncJf();
    expect(loadJf().resumeJids).toEqual({ "tt2043923|": "movie-jid" });
  });

  it("writes nothing for a play overtaken by a sign-out", async () => {
    const gen = forgetCount();
    forgetJf();
    noteResumeJid(SEV, `${SEV}:1:2`, EP2, gen);
    expect(loadJf().resumeJids).toBeUndefined();
  });

  it("still leaves a played play alone: it is a mark, never un-played from here", async () => {
    noteResumeJid(SEV, `${SEV}:1:2`, EP2, forgetCount());
    replaceJfWatched({ episodes: { [SEV]: [`${SEV}:1:2`] }, films: [] });
    await forgetResume([card()]);
    expect(net.call).not.toHaveBeenCalled();
  });
});
