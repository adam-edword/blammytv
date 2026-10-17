import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory localStorage and a window that only hears events: the unit
// tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
const bus = new EventTarget();
vi.stubGlobal("window", bus);

const net = vi.hoisted(() => ({
  vods: vi.fn(),
  series: vi.fn(),
  vodCats: vi.fn(),
  seriesCats: vi.fn(),
  vodInfo: vi.fn(),
  seriesInfo: vi.fn(),
}));
vi.mock("../../data/xtream", () => ({
  fetchVodStreams: net.vods,
  fetchSeries: net.series,
  fetchVodCategories: net.vodCats,
  fetchSeriesCategories: net.seriesCats,
  fetchVodInfo: net.vodInfo,
  fetchSeriesInfo: net.seriesInfo,
}));
// The fingerprint and the digest stay real; only the database is stood in for
// (a node test has no indexedDB, so the real one answers null and writes nothing).
const disk = vi.hoisted(() => ({ get: vi.fn(), put: vi.fn() }));
vi.mock("./disk", async (orig) => ({
  ...(await orig<typeof import("./disk")>()),
  diskGet: disk.get,
  diskPut: disk.put,
}));

import {
  CREDS,
  MOVIE_4K,
  MOVIE_FOLDERS,
  MOVIE_HD,
  SERIES_INFO,
  SERIES_INFO_4K,
  SERVER,
  SHOW,
  SHOW_4K,
  SHOW_FOLDERS,
  VOD_INFO,
} from "./fixture";

type Vod = typeof import("./vod");
type Store = typeof import("./store");
let vod: Vod;
let store: Store;

/** The modules fresh each time: the library, the reads in flight and the
 * show lists are all module state. */
async function boot() {
  vi.resetModules();
  [vod, store] = await Promise.all([import("./vod"), import("./store")]);
}

const playlist = (id = "t", extra: Record<string, unknown> = {}) => ({
  kind: "xtream",
  id,
  name: "Test",
  enabled: true,
  server: CREDS.server,
  username: CREDS.username,
  password: CREDS.password,
  ...extra,
});
const seed = (...list: unknown[]) => mem.set("blammytv.playlists", JSON.stringify({ v: 1, data: list }));
const setting = (key: string, data: unknown) => mem.set(`blammytv.${key}`, JSON.stringify({ v: 1, data }));

const movie = (stream_id: number, name: string, category_id: string, extra: Record<string, unknown> = {}) => ({
  ...MOVIE_4K,
  stream_id,
  name,
  category_id,
  tmdb_id: 900000 + stream_id,
  ...extra,
});
const show = (series_id: number, name: string, category_id: string, extra: Record<string, unknown> = {}) => ({
  ...SHOW,
  series_id,
  name,
  category_id,
  tmdb_id: 800000 + series_id,
  ...extra,
});

/** What the panel answers by default: the fixture's film twice, its show twice,
 * and a film with no TMDB id in Comedy. */
const MOVIES = [MOVIE_4K, MOVIE_HD, movie(3003, "Home Movie Night (2019)", "13", { tmdb_id: undefined })];
const SHOWS = [SHOW, SHOW_4K];

function panel(movies: unknown[] = MOVIES, shows: unknown[] = SHOWS) {
  net.vods.mockResolvedValue(movies);
  net.series.mockResolvedValue(shows);
  net.vodCats.mockResolvedValue(MOVIE_FOLDERS);
  net.seriesCats.mockResolvedValue(SHOW_FOLDERS);
}

const MOVIE_KEY = "xt:t:m:t617126";
const SHOW_KEY = "xt:t:s:t4521";
const flush = () => new Promise((r) => setTimeout(r, 0));

beforeEach(async () => {
  mem.clear();
  vi.clearAllMocks();
  disk.get.mockResolvedValue(null);
  disk.put.mockResolvedValue(undefined);
  net.vodInfo.mockResolvedValue(VOD_INFO);
  net.seriesInfo.mockImplementation(async (_p: unknown, id: string) => (id === "3102" ? SERIES_INFO_4K : SERIES_INFO));
  panel();
  seed(playlist());
  await boot();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("loadXtVod", () => {
  it("is empty with no eligible playlist, and asks nothing", async () => {
    seed(playlist("t", { enabled: false }), { kind: "m3u", id: "m", name: "m", enabled: true, url: "http://x.invalid/l.m3u" });
    expect(await vod.loadXtVod()).toEqual({ items: new Map(), rows: [], featured: [] });
    expect(vod.peekXtVod()).toBeNull();
    expect(net.vods).not.toHaveBeenCalled();
    expect(disk.get).not.toHaveBeenCalled();
  });

  it("with nothing picked has no row and no hero, and every title for Continue Watching and My List to open", async () => {
    const d = await vod.loadXtVod();
    expect(d.error).toBeUndefined();
    expect(d.rows).toEqual([]);
    expect(d.featured).toEqual([]);
    expect([...d.items.keys()].sort()).toEqual(["xt:t:m:3003", MOVIE_KEY, SHOW_KEY]);
    expect(d.items.get(MOVIE_KEY)).toMatchObject({ from: "xt", title: "The Fantastic 4: First Steps" });
  });

  it("reads each list once: both lists and both folder lists, for the one playlist", async () => {
    await vod.loadXtVod();
    await vod.loadXtVod();
    for (const f of [net.vods, net.series, net.vodCats, net.seriesCats]) expect(f).toHaveBeenCalledTimes(1);
    expect(net.vods.mock.calls[0][0]).toMatchObject({ id: "t", server: SERVER });
  });

  it("makes a row of each picked folder, movies then shows, in the panel's folder order and not the order they were picked", async () => {
    store.setPicks("t", "movie", ["13", "12"]);
    store.setPicks("t", "series", ["13", "12"]);
    const d = await vod.loadXtVod();
    expect(d.rows.map((r) => [r.id, r.title, r.itemIds])).toEqual([
      ["xt:t:movie:12", "Action", [MOVIE_KEY]],
      ["xt:t:movie:13", "Comedy", ["xt:t:m:3003"]],
      ["xt:t:series:12", "Drama", [SHOW_KEY]],
      ["xt:t:series:13", "Sitcoms", [SHOW_KEY]],
    ]);
    expect(d.rows.every((r) => r.layout === "poster")).toBe(true);
  });

  it("holds a title once in a row, however many copies the panel lists in the folder", async () => {
    store.setPicks("t", "movie", ["11", "12"]);
    const d = await vod.loadXtVod();
    expect(d.rows.map((r) => r.itemIds)).toEqual([[MOVIE_KEY], [MOVIE_KEY]]);
  });

  it("does not draw a picked folder the panel no longer has, or that has no title", async () => {
    store.setPicks("t", "movie", ["99", "13"]);
    store.setPicks("t", "series", ["99"]);
    panel([MOVIE_4K], SHOWS);
    const d = await vod.loadXtVod();
    expect(d.rows).toEqual([]);
  });

  it("puts at most the row size in a row, the newest first", async () => {
    setting("rowCap", 10);
    const many = Array.from({ length: 14 }, (_, i) => movie(5000 + i, `Film ${i + 1} (2020)`, "13", { added: String(1700000000 + i) }));
    panel(many, []);
    store.setPicks("t", "movie", ["13"]);
    const d = await vod.loadXtVod();
    const ids = d.rows[0].itemIds;
    expect(ids).toHaveLength(10);
    expect(d.items.get(ids[0])!.title).toBe("Film 14");
    expect(d.items.get(ids[9])!.title).toBe("Film 5");
    // Every title is still there to be opened, row or no row.
    expect(d.items.size).toBe(14);
  });

  describe("the hero", () => {
    const shows = [
      ...Array.from({ length: 11 }, (_, i) => show(6000 + i, `Show ${i + 1} (2020)`, "13", { last_modified: String(1700000000 + i) })),
      show(6100, "Newest Without Art (2024)", "13", { backdrop_path: [], last_modified: "1800000000" }),
      show(6101, "Other Folder (2024)", "12", { last_modified: "1900000000" }),
    ];

    it("is the newest picked shows that have a backdrop, nine at most", async () => {
      panel([], shows);
      store.setPicks("t", "series", ["13"]);
      const d = await vod.loadXtVod();
      expect(d.featured).toHaveLength(9);
      expect(d.featured.map((k) => d.items.get(k)!.title)).toEqual(
        [11, 10, 9, 8, 7, 6, 5, 4, 3].map((n) => `Show ${n}`),
      );
      expect(d.featured.every((k) => !!d.items.get(k)!.backdrop)).toBe(true);
    });

    it("is none when no show folder is picked, picked movies or not", async () => {
      panel(MOVIES, shows);
      store.setPicks("t", "movie", ["12"]);
      expect((await vod.loadXtVod()).featured).toEqual([]);
    });

    it("draws from the folders picked and no other, and each show once", async () => {
      panel([], shows);
      store.setPicks("t", "series", ["12", "13"]);
      const d = await vod.loadXtVod();
      expect(d.featured[0]).toBe("xt:t:s:t806101");
      expect(new Set(d.featured).size).toBe(d.featured.length);
    });
  });

  describe("a row's title", () => {
    it("is the folder's name with one library, and the playlist's name after it with more", async () => {
      store.setPicks("t", "movie", ["12"]);
      expect((await vod.loadXtVod()).rows[0].title).toBe("Action");
      await boot();
      seed(playlist("t", { name: "Alpha" }), playlist("u", { name: "Beta", server: "http://other.example.invalid:8080" }));
      store.setPicks("t", "movie", ["12"]);
      store.setPicks("u", "movie", ["12"]);
      const d = await vod.loadXtVod();
      expect(d.rows.map((r) => [r.id, r.title])).toEqual([
        ["xt:t:movie:12", "Action · Alpha"],
        ["xt:u:movie:12", "Action · Beta"],
      ]);
    });

    it("says movies or shows when a movie folder and a show folder of a playlist share a name", async () => {
      net.seriesCats.mockResolvedValue([
        { id: "12", name: "Comedy", adult: false },
        { id: "13", name: "Sitcoms", adult: false },
      ]);
      store.setPicks("t", "movie", ["13"]);
      store.setPicks("t", "series", ["12"]);
      expect((await vod.loadXtVod()).rows.map((r) => r.title)).toEqual(["Comedy · Movies", "Comedy · Shows"]);
      // Picked on one side only, the name is enough.
      store.setPicks("t", "series", []);
      expect((await vod.loadXtVod()).rows.map((r) => r.title)).toEqual(["Comedy"]);
    });
  });

  describe("the adult filter", () => {
    const adult = [
      ...MOVIES,
      movie(3006, "Flagged In Plain Sight (2022)", "12", { is_adult: 1 }),
      movie(3007, "Vault Feature (2021)", "14"),
    ];
    const folders = [...MOVIE_FOLDERS, { id: "14", name: "Premium Vault", adult: true }];

    it("leaves out flagged titles and folders while hidden, and brings them back when shown, without asking the panel again", async () => {
      panel(adult);
      net.vodCats.mockResolvedValue(folders);
      store.setPicks("t", "movie", ["12", "14"]);
      const hidden = await vod.loadXtVod();
      expect(hidden.rows.map((r) => r.title)).toEqual(["Action"]);
      expect(hidden.items.has("xt:t:m:t903006")).toBe(false);
      expect(hidden.items.has("xt:t:m:t903007")).toBe(false);
      expect(vod.xtLibraries()[0].movieFolders.map((f) => f.name)).not.toContain("Premium Vault");

      setting("showAdult", true);
      const shown = await vod.loadXtVod();
      expect(shown.rows.map((r) => r.title)).toEqual(["Action", "Premium Vault"]);
      expect(shown.items.has("xt:t:m:t903006")).toBe(true);
      expect(vod.xtLibraries()[0].movieFolders.map((f) => f.name)).toContain("Premium Vault");
      expect(net.vods).toHaveBeenCalledTimes(1);
    });
  });

  it("peeks at the libraries in memory, any age, and null before any is", async () => {
    expect(vod.peekXtVod()).toBeNull();
    const d = await vod.loadXtVod();
    expect(vod.peekXtVod()).toBe(d);
    store.setPicks("t", "movie", ["12"]);
    expect(vod.peekXtVod()!.rows).toHaveLength(1);
  });
});

describe("xtVodKey", () => {
  it("is empty with no eligible playlist", () => {
    seed(playlist("t", { enabled: false }));
    expect(vod.xtVodKey()).toBe("");
  });

  it("moves when a pick moves, the row size, the adult filter, the account or a name", () => {
    const keys = new Set<string>();
    const note = () => keys.add(vod.xtVodKey());
    note();
    store.togglePick("t", "movie", "12");
    note();
    store.togglePick("t", "series", "12");
    note();
    setting("rowCap", 25);
    note();
    setting("showAdult", true);
    note();
    seed(playlist("t", { password: "other" }));
    note();
    seed(playlist("t", { name: "Renamed", password: "other" }));
    note();
    expect(keys.size).toBe(7);
  });

  it("holds the account only as a digest", () => {
    store.togglePick("t", "movie", "12");
    const k = vod.xtVodKey();
    expect(k).not.toContain(CREDS.username);
    expect(k).not.toContain("panel.example");
  });

  it("is the same for the same state, and does not move when the lists do", async () => {
    const a = vod.xtVodKey();
    await vod.loadXtVod();
    expect(vod.xtVodKey()).toBe(a);
  });
});

describe("the lists", () => {
  const HOUR = 3600_000;
  const lists = async () => {
    const mod = await import("./read");
    return {
      movies: mod.readMovies([MOVIE_4K]),
      shows: mod.readShows([SHOW]),
      movieFolders: MOVIE_FOLDERS,
      showFolders: SHOW_FOLDERS,
    };
  };

  it("are read from disk first, and a copy inside the TTL makes no call to the panel at all", async () => {
    disk.get.mockResolvedValue({ at: Date.now() - HOUR, lists: await lists() });
    const d = await vod.loadXtVod();
    expect(d.items.has(MOVIE_KEY)).toBe(true);
    expect(net.vods).not.toHaveBeenCalled();
    expect(net.series).not.toHaveBeenCalled();
    expect(disk.put).not.toHaveBeenCalled();
    // And the fingerprint it asked for is this playlist's, not a bare id.
    expect(disk.get.mock.calls[0][0]).toBe("t");
    expect(disk.get.mock.calls[0][1]).toBe(JSON.stringify([SERVER, CREDS.username, CREDS.password]));
  });

  it("past the TTL, the copy is shown at once and the panel is read again behind it", async () => {
    disk.get.mockResolvedValue({ at: Date.now() - vod.LISTS_TTL_MS - HOUR, lists: await lists() });
    let release!: () => void;
    net.vods.mockImplementation(() => new Promise((r) => (release = () => r(MOVIES))));
    const heard = vi.fn();
    bus.addEventListener(vod.XT_LOADED, heard);

    const d = await vod.loadXtVod(); // resolves on the stale copy, not on the panel
    expect([...d.items.keys()]).toEqual([MOVIE_KEY, SHOW_KEY]);
    expect(net.vods).toHaveBeenCalledTimes(1);
    expect(heard).toHaveBeenCalledTimes(1); // the copy landing
    release();
    await flush();
    expect(heard).toHaveBeenCalledTimes(2); // the read landing
    expect(vod.peekXtVod()!.items.has("xt:t:m:3003")).toBe(true);
    expect(disk.put).toHaveBeenCalledTimes(1);
    expect(disk.put.mock.calls[0][0]).toBe("t");
    bus.removeEventListener(vod.XT_LOADED, heard);
  });

  it("are read from the panel, and written to disk, when there is no copy", async () => {
    await vod.loadXtVod();
    expect(net.vods).toHaveBeenCalledTimes(1);
    expect(disk.put).toHaveBeenCalledTimes(1);
    const [pid, fp, at, written] = disk.put.mock.calls[0];
    expect([pid, fp]).toEqual(["t", JSON.stringify([SERVER, CREDS.username, CREDS.password])]);
    expect(typeof at).toBe("number");
    expect(written.movies.map((m: { id: string }) => m.id)).toEqual(["52114", "52390", "3003"]);
  });

  it("keep what was shown when the read behind it fails, and do not hammer the panel", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    disk.get.mockResolvedValue({ at: Date.now() - vod.LISTS_TTL_MS - HOUR, lists: await lists() });
    net.vods.mockRejectedValue(new Error("HTTP 502"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const first = await vod.loadXtVod();
    await flush();
    expect(first.items.has(MOVIE_KEY)).toBe(true);
    expect((await vod.loadXtVod()).error).toBeUndefined();
    expect(net.vods).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 6 * 60_000);
    await vod.loadXtVod();
    await flush();
    expect(net.vods).toHaveBeenCalledTimes(2);
    expect(vod.peekXtVod()!.items.has(MOVIE_KEY)).toBe(true);
    warn.mockRestore();
  });

  it("are an error when there is no copy to show and the panel cannot be read, and Retry reads it again", async () => {
    net.vods.mockRejectedValueOnce(new Error("HTTP 403"));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const bad = await vod.loadXtVod();
    expect(bad.error).toBe("HTTP 403");
    expect(bad.items.size).toBe(0);
    expect(vod.peekXtVod()).toBeNull();
    const good = await vod.loadXtVod();
    expect(good.error).toBeUndefined();
    expect(good.items.size).toBe(3);
    warn.mockRestore();
  });

  it("are read one ask at a time per playlist", async () => {
    const [a, b, c] = await Promise.all([vod.loadXtVod(), vod.loadXtVod(), vod.resolveXtList("movie", MOVIE_KEY)]);
    expect(a.items.size).toBe(b.items.size);
    expect(c.sources).toHaveLength(2);
    expect(net.vods).toHaveBeenCalledTimes(1);
    expect(disk.get).toHaveBeenCalledTimes(1);
  });

  it("are another account's when the playlist is edited: the old read is not used for it", async () => {
    await vod.loadXtVod();
    seed(playlist("t", { password: "changed" }));
    await vod.loadXtVod();
    expect(net.vods).toHaveBeenCalledTimes(2);
    expect(disk.get.mock.calls.map((c) => c[1])).toEqual([
      JSON.stringify([SERVER, CREDS.username, CREDS.password]),
      JSON.stringify([SERVER, CREDS.username, "changed"]),
    ]);
  });

  it("drop a read that lands after its playlist was edited or removed", async () => {
    let release!: () => void;
    net.vods.mockImplementation(() => new Promise((r) => (release = () => r(MOVIES))));
    const pending = vod.loadXtVod();
    await flush();
    seed();
    release();
    expect((await pending).items.size).toBe(0);
    expect(disk.put).not.toHaveBeenCalled();
  });

  it("fill the record of what each held, which hasXtLibrary answers from", async () => {
    expect(store.hasXtLibrary()).toBe(false);
    await vod.loadXtVod();
    expect(store.loadHeld("t")).toEqual({ movies: 3, shows: 2 });
    expect(store.hasXtLibrary()).toBe(true);
  });

  it("held nothing for a playlist that is live TV only: it is no library", async () => {
    panel([], []);
    const d = await vod.loadXtVod();
    expect(d).toEqual({ items: new Map(), rows: [], featured: [] });
    expect(store.loadHeld("t")).toEqual({ movies: 0, shows: 0 });
    expect(store.hasXtLibrary()).toBe(false);
    expect(vod.xtLibraries()).toEqual([]);
  });

  it("never reach a log line as the account, only as a digest", async () => {
    const SECRET = "s3cr3tpassw0rd";
    seed(playlist("t", { password: SECRET, username: "usr-uniq-1" }));
    const logs: unknown[][] = [];
    const spies = (["info", "warn", "error", "log"] as const).map((m) =>
      vi.spyOn(console, m).mockImplementation((...a: unknown[]) => void logs.push(a)),
    );
    net.vods.mockRejectedValueOnce(new Error(`GET ${SERVER}/player_api.php?username=usr-uniq-1&password=${SECRET} failed`));
    await vod.loadXtVod();
    await vod.loadXtVod();
    spies.forEach((s) => s.mockRestore());
    const all = JSON.stringify(logs);
    expect(logs.length).toBeGreaterThan(0);
    expect(all).not.toContain(SECRET);
    expect(all).not.toContain("usr-uniq-1");
    // The error's address is cut to its origin by the scrubber, as everywhere.
    expect(all).not.toContain("player_api");
  });
});

describe("the folders the picker offers", () => {
  it("are each library's, in playlist order, movies and shows apart, those with a title in them", async () => {
    net.vodCats.mockResolvedValue([...MOVIE_FOLDERS, { id: "20", name: "Empty One", adult: false }]);
    await vod.loadXtVod();
    expect(vod.xtLibraries()).toEqual([
      {
        id: "t",
        name: "Test",
        movieFolders: [
          { id: "11", name: "4K Movies" },
          { id: "12", name: "Action" },
          { id: "13", name: "Comedy" },
        ],
        showFolders: [
          { id: "12", name: "Drama" },
          { id: "13", name: "Sitcoms" },
        ],
      },
    ]);
  });
});

describe("resolveXtItem", () => {
  it("is a film's page from the first copy's get_vod_info, under the key it was asked for", async () => {
    const v = await vod.resolveXtItem(MOVIE_KEY);
    expect(net.vodInfo).toHaveBeenCalledTimes(1);
    expect(net.vodInfo.mock.calls[0][1]).toBe("52114"); // the 4K copy
    expect(v).toMatchObject({
      id: MOVIE_KEY,
      from: "xt",
      kind: "movie",
      title: "The Fantastic 4: First Steps",
      synopsis: "Four astronauts return to a changed Earth.",
      runtimeMin: 115,
    });
  });

  it("is a show's page from every copy's get_series_info, the seasons merged, an episode's id its key", async () => {
    const v = await vod.resolveXtItem(SHOW_KEY);
    expect(net.seriesInfo.mock.calls.map((c) => c[1]).sort()).toEqual(["3101", "3102"]);
    expect(v!.seasons.map((s) => [s.number, s.episodes.length])).toEqual([
      [1, 3],
      [2, 2],
    ]);
    expect(v!.seasons[0].episodes[0].id).toBe(`${SHOW_KEY}:1:1`);
    expect(v!.from).toBe("xt");
  });

  it("keeps a show's episodes for the session: its files, asked after its page, read nothing more", async () => {
    await vod.resolveXtItem(SHOW_KEY);
    const l = await vod.resolveXtList("series", `${SHOW_KEY}:1:2`);
    expect(net.seriesInfo).toHaveBeenCalledTimes(2);
    expect(l.sources.map((s) => s.streamUrl)).toEqual([`${SERVER}/series/adam/pw/9002.mkv`, `${SERVER}/series/adam/pw/187.mkv`]);
  });

  it("shares one read between the page and the files asked at the same moment (a Continue Watching click)", async () => {
    const [v, l] = await Promise.all([vod.resolveXtItem(SHOW_KEY), vod.resolveXtList("series", `${SHOW_KEY}:2:1`)]);
    expect(net.seriesInfo).toHaveBeenCalledTimes(2);
    expect(v!.seasons).toHaveLength(2);
    expect(l.sources.map((s) => s.streamUrl)).toEqual([`${SERVER}/series/adam/pw/201.mkv`]);
  });

  it("reads them again past the session's TTL", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    await vod.resolveXtItem(SHOW_KEY);
    vi.setSystemTime(Date.now() + 31 * 60_000);
    await vod.resolveXtItem(SHOW_KEY);
    expect(net.seriesInfo).toHaveBeenCalledTimes(4);
  });

  it("is the page of the copies that can be read when one fails, and is not kept, so the next ask reads the other again", async () => {
    net.seriesInfo.mockImplementation(async (_p: unknown, id: string) => {
      if (id === "3102") throw new Error("HTTP 500");
      return SERIES_INFO;
    });
    const v = await vod.resolveXtItem(SHOW_KEY);
    expect(v!.seasons.map((s) => s.number)).toEqual([1, 2]);
    net.seriesInfo.mockClear();
    await vod.resolveXtItem(SHOW_KEY);
    expect(net.seriesInfo).toHaveBeenCalledTimes(2);
  });

  it("rejects when no copy of a show can be read, and keeps nothing", async () => {
    net.seriesInfo.mockRejectedValue(new Error("HTTP 500"));
    await expect(vod.resolveXtItem(SHOW_KEY)).rejects.toThrow("HTTP 500");
    net.seriesInfo.mockImplementation(async () => SERIES_INFO);
    expect((await vod.resolveXtItem(SHOW_KEY))!.seasons.length).toBeGreaterThan(0);
  });

  it("waits for the library when it is asked before anything loaded (a cold Continue Watching click)", async () => {
    expect(vod.peekXtVod()).toBeNull();
    const v = await vod.resolveXtItem(MOVIE_KEY);
    expect(v!.id).toBe(MOVIE_KEY);
    expect(net.vods).toHaveBeenCalledTimes(1);
  });

  it("is null for a key it did not make, an episode's key, a playlist that is gone, off or disabled, and a title the library lacks", async () => {
    for (const key of ["tt0111161", "jf:abc", "kitsu:1", `${SHOW_KEY}:1:1`, "xt:gone:m:t617126", "xt:t:m:t999999", "xt:t:s:t999999"])
      expect(await vod.resolveXtItem(key), key).toBeNull();
    store.setLibraryOff("t", true);
    expect(await vod.resolveXtItem(MOVIE_KEY)).toBeNull();
    store.setLibraryOff("t", false);
    seed(playlist("t", { enabled: false }));
    expect(await vod.resolveXtItem(MOVIE_KEY)).toBeNull();
    expect(net.vodInfo).not.toHaveBeenCalled();
  });
});

describe("resolveXtList", () => {
  it("is a film's sources, one per copy, the 4K first, built from the library with no call for them", async () => {
    await vod.loadXtVod();
    const l = await vod.resolveXtList("movie", MOVIE_KEY);
    expect(l.notices).toEqual([]);
    expect(l.sources.map((s) => [s.quality, s.streamUrl])).toEqual([
      ["2160p", `${SERVER}/movie/adam/pw/52114.mkv`],
      ["HD", `${SERVER}/movie/adam/pw/52390.mp4`],
    ]);
    expect(net.vodInfo).not.toHaveBeenCalled();
    expect(net.seriesInfo).not.toHaveBeenCalled();
  });

  it("is an episode's sources from the show's copies that hold it", async () => {
    const l = await vod.resolveXtList("series", `${SHOW_KEY}:2:2`);
    expect(l.sources.map((s) => s.streamUrl)).toEqual([`${SERVER}/series/adam/pw/202.mkv`]);
    expect(l.notices).toEqual([]);
  });

  it("is no source for an episode no copy holds", async () => {
    expect(await vod.resolveXtList("series", `${SHOW_KEY}:9:9`)).toEqual({ sources: [], notices: [] });
  });

  it("is no source for a show itself, or for a key of the other kind", async () => {
    await vod.loadXtVod();
    expect(await vod.resolveXtList("series", SHOW_KEY)).toEqual({ sources: [], notices: [] });
    expect(await vod.resolveXtList("series", MOVIE_KEY)).toEqual({ sources: [], notices: [] });
    expect(await vod.resolveXtList("movie", SHOW_KEY)).toEqual({ sources: [], notices: [] });
  });

  it("says the title is not in the library for a key whose playlist is gone or whose title is missing, and asks the panel for nothing", async () => {
    for (const key of ["xt:gone:m:t617126", "xt:t:m:t999999"]) {
      const l = await vod.resolveXtList("movie", key);
      expect(l.sources).toEqual([]);
      expect(l.notices).toEqual(["This title isn’t in your playlist’s library."]);
    }
    expect(net.vodInfo).not.toHaveBeenCalled();
  });

  it("is empty, without a word, for a key that is not one of its own", async () => {
    for (const key of ["tt0111161", "jf:abc", "kitsu:1:2"]) expect(await vod.resolveXtList("movie", key)).toEqual({ sources: [], notices: [] });
    expect(net.vods).not.toHaveBeenCalled();
  });
});

describe("xtUserAgent", () => {
  it("is the key's own playlist's, cleaned, or none", () => {
    seed(
      playlist("t", { userAgent: " BlammyBox/1.0 " }),
      playlist("u"),
      playlist("v", { userAgent: "café" }),
      { kind: "m3u", id: "m", name: "m", enabled: true, url: "http://x.invalid/l.m3u", userAgent: "M3U/1" },
    );
    expect(vod.xtUserAgent(MOVIE_KEY)).toBe("BlammyBox/1.0");
    expect(vod.xtUserAgent(`${SHOW_KEY}:1:2`)).toBe("BlammyBox/1.0");
    expect(vod.xtUserAgent("xt:u:m:t1")).toBeUndefined();
    expect(vod.xtUserAgent("xt:v:m:t1")).toBeUndefined();
    expect(vod.xtUserAgent("xt:m:m:t1")).toBeUndefined();
    expect(vod.xtUserAgent("xt:gone:m:t1")).toBeUndefined();
    expect(vod.xtUserAgent("tt0111161")).toBeUndefined();
  });
});

describe("watchXtLibrary", () => {
  it("reads at launch, and again a moment after a pick or the switch, once for a burst", async () => {
    vi.useFakeTimers();
    const off = vod.watchXtLibrary();
    await vi.advanceTimersByTimeAsync(0);
    expect(net.vods).toHaveBeenCalledTimes(1);
    expect(store.hasXtLibrary()).toBe(true);

    // The switch off and on again, and a pick, in one burst: nothing is read,
    // because nothing changed in what is in memory.
    store.setLibraryOff("t", true);
    store.setLibraryOff("t", false);
    store.togglePick("t", "movie", "12");
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.vods).toHaveBeenCalledTimes(1);

    // A playlist added is read.
    seed(playlist("t"), playlist("u", { server: "http://other.example.invalid:8080" }));
    bus.dispatchEvent(new Event("blammytv:playlists"));
    await vi.advanceTimersByTimeAsync(1000);
    expect(net.vods).toHaveBeenCalledTimes(2);
    expect(net.vods.mock.calls[1][0]).toMatchObject({ id: "u" });
    off();
  });

  it("does nothing once stopped", async () => {
    vi.useFakeTimers();
    const off = vod.watchXtLibrary();
    off();
    await vi.advanceTimersByTimeAsync(5000);
    expect(net.vods).not.toHaveBeenCalled();
  });
});
