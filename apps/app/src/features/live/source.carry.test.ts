import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveData } from "./model";

/**
 * What a reload starts from (audit LV1, LV2, LV6).
 *
 * LV1: a source that fails keeps what it held at its last good load.
 * LV2: a reload that changes the cache key (a hidden folder, Undo, the adult
 *      filter) is seeded with the programmes it already had.
 * LV6: a disk write queued before Clear All Login Info doesn't land after it.
 *
 * The harness is source.cache.test.ts's: Xtream mocked at the data layer, the
 * saved playlists a mutable list, the disk cache a one-record fake.
 */

const authenticate = vi.fn();
const fetchLiveCategories = vi.fn();
const fetchLiveStreams = vi.fn();
const fetchXmltv = vi.fn();
vi.mock("../../data/xtream", () => ({
  authenticate: (...a: unknown[]) => authenticate(...a),
  fetchLiveCategories: (...a: unknown[]) => fetchLiveCategories(...a),
  fetchLiveStreams: (...a: unknown[]) => fetchLiveStreams(...a),
  fetchXmltv: (...a: unknown[]) => fetchXmltv(...a),
}));

type TestPlaylist = {
  kind: "xtream";
  id: string;
  name: string;
  enabled: boolean;
  server: string;
  username: string;
  password: string;
  hiddenCategories?: string[];
};
const xtream = (id: string, over: Partial<TestPlaylist> = {}): TestPlaylist => ({
  kind: "xtream",
  id,
  name: id,
  enabled: true,
  server: "http://tv.example.com",
  username: "u",
  password: "p",
  ...over,
});
let playlists: TestPlaylist[] = [];
vi.mock("../settings/playlists", () => ({ loadPlaylists: () => playlists }));
let showAdult = false;
vi.mock("../settings/adultFilter", () => ({ loadShowAdult: () => showAdult }));

let disk: { key: string; at: number; data: LiveData; normalized?: true } | null = null;
const diskPut = vi.fn();
vi.mock("./diskCache", () => ({
  diskGet: async (key: string) => (disk && disk.key === key ? disk : null),
  diskPut: (r: unknown) => diskPut(r),
}));

const MIN = 60_000;
const delay = <T,>(v: T, ms: number) =>
  new Promise<T>((r) => setTimeout(() => r(v), ms));
const never = () => new Promise<never>(() => {});
const bytes = (s: string) => new TextEncoder().encode(s).buffer;
const stamp = (d: Date) =>
  d.toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";

/** Each source's one stream, named for it, in category "1" ("News"). */
function oneStreamEach() {
  fetchLiveCategories.mockImplementation(async () => [
    { id: "1", name: "News", adult: false },
  ]);
  fetchLiveStreams.mockImplementation(async (p: TestPlaylist) => [
    { stream_id: p.id === "A" ? 1 : 2, name: `ch${p.id}`, category_id: "1" },
  ]);
}

/** The disk record the app would have written for the current config,
 * learned the way it does: one real load, then the delayed write. */
async function diskRecord() {
  const { loadLive } = await import("./source");
  await loadLive(new Date());
  await delay(null, 1600);
  const written = diskPut.mock.calls.at(-1)?.[0] as {
    key: string;
    at: number;
    data: LiveData;
  };
  if (!written) throw new Error("the first load wrote no disk record");
  diskPut.mockClear();
  return written;
}

const programme = (now: number, title = "News") => ({
  title,
  start: new Date(now - 10 * MIN),
  end: new Date(now + 50 * MIN),
});

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T19:00:00Z"));
  playlists = [xtream("A"), xtream("B")];
  showAdult = false;
  disk = null;
  authenticate.mockResolvedValue(undefined);
  oneStreamEach();
  fetchXmltv.mockRejectedValue(new Error("no epg in this test"));
});
afterEach(() => vi.useRealTimers());

describe("a source that fails keeps its last good channels (LV1)", () => {
  it("through a revalidation, in memory and on disk", async () => {
    const rec = await diskRecord();
    expect(rec.data.channels.map((c) => c.id).sort()).toEqual(["A:1", "B:2"]);
    // Relaunch: the disk has both with a guide, and B's panel is down.
    vi.resetModules();
    const now = Date.now();
    disk = {
      ...rec,
      at: now,
      data: {
        ...rec.data,
        programmes: new Map([
          ["A:1", [programme(now)]],
          ["B:2", [programme(now, "Film")]],
        ]) as never,
      },
    };
    authenticate.mockImplementation(async (p: TestPlaylist) => {
      if (p.id === "B") throw new Error("HTTP 503");
    });
    const { loadLive, lookupLive } = await import("./source");
    await loadLive(new Date());
    await delay(null, 30); // the channel phase lands, the guide phase fails
    const live = lookupLive()!;
    // B's channels, folders and guide are all still here...
    expect(live.channels.map((c) => c.id).sort()).toEqual(["A:1", "B:2"]);
    expect(live.groups.find((g) => g.id === "B")?.folders).toEqual([
      { id: "B:1", name: "News" },
    ]);
    expect(live.programmes.get("B:2")?.[0].title).toBe("Film");
    // ...and the playlist still says it failed.
    expect(live.groups.find((g) => g.id === "B")?.error).toMatch(/503/);
    expect(live.groups.find((g) => g.id === "A")?.error).toBeUndefined();
    // The record on disk holds them too, which is the point.
    await delay(null, 1600);
    const written = diskPut.mock.calls.map((c) => (c[0] as { data: LiveData }).data);
    expect(written.length).toBeGreaterThan(0);
    for (const d of written)
      expect(d.channels.map((c) => c.id).sort()).toEqual(["A:1", "B:2"]);
  });

  it("including the channels a hidden folder holds", async () => {
    playlists = [xtream("A"), xtream("B", { hiddenCategories: ["2"] })];
    fetchLiveCategories.mockImplementation(async () => [
      { id: "1", name: "News", adult: false },
      { id: "2", name: "Sport", adult: false },
    ]);
    fetchLiveStreams.mockImplementation(async (p: TestPlaylist) =>
      p.id === "A"
        ? [{ stream_id: 1, name: "chA", category_id: "1" }]
        : [
            { stream_id: 2, name: "chB", category_id: "1" },
            { stream_id: 3, name: "Match", category_id: "2" },
          ],
    );
    const rec = await diskRecord();
    expect(rec.data.hidden?.map((c) => c.id)).toEqual(["B:3"]);
    vi.resetModules();
    disk = { ...rec, at: Date.now() };
    authenticate.mockImplementation(async (p: TestPlaylist) => {
      if (p.id === "B") throw new Error("HTTP 503");
    });
    const { loadLive, lookupLive } = await import("./source");
    await loadLive(new Date());
    await delay(null, 30);
    expect(lookupLive()?.hidden?.map((c) => c.id)).toEqual(["B:3"]);
  });

  it("every source failing still shows the carried channels, and stays uncached for a retry", async () => {
    const { loadLive, peekLive } = await import("./source");
    await loadLive(new Date());
    await delay(null, 1600);
    diskPut.mockClear();
    // Half an hour on, both panels are down.
    vi.setSystemTime(new Date(Date.now() + 31 * MIN));
    authenticate.mockRejectedValue(new Error("HTTP 503"));
    const data = await loadLive(new Date());
    // The screen gets both playlists' channels, each saying it failed...
    expect(data.channels.map((c) => c.id).sort()).toEqual(["A:1", "B:2"]);
    expect(data.groups.every((g) => /503/.test(g.error ?? ""))).toBe(true);
    // ...but nothing pins it for the next half hour, and nothing is written:
    // the next mount tries the panels again, as a total failure always did.
    await delay(null, 1600);
    expect(peekLive()).toBeNull();
    expect(diskPut).not.toHaveBeenCalled();
  });

  it("only when its own config is unchanged: new credentials get no channels", async () => {
    const { loadLive, lookupLive } = await import("./source");
    await loadLive(new Date());
    await delay(null, 30);
    expect(lookupLive()?.channels.length).toBe(2);
    // B's password is corrected, and the new one is refused.
    playlists = [xtream("A"), xtream("B", { password: "typo" })];
    authenticate.mockImplementation(async (p: TestPlaylist) => {
      if (p.id === "B") throw new Error("HTTP 401");
    });
    await loadLive(new Date(), undefined, true);
    await delay(null, 30);
    const live = lookupLive()!;
    expect(live.channels.map((c) => c.id)).toEqual(["A:1"]);
    const b = live.groups.find((g) => g.id === "B")!;
    expect(b.error).toMatch(/401/);
    expect(b.folders).toEqual([]);
  });

  it("nor when it hides a folder it didn't, or the adult filter moved", async () => {
    const { loadLive, lookupLive } = await import("./source");
    await loadLive(new Date());
    await delay(null, 30);
    authenticate.mockImplementation(async (p: TestPlaylist) => {
      if (p.id === "B") throw new Error("HTTP 503");
    });
    playlists = [xtream("A"), xtream("B", { hiddenCategories: ["9"] })];
    await loadLive(new Date(), undefined, true);
    await delay(null, 30);
    expect(lookupLive()?.channels.map((c) => c.id)).toEqual(["A:1"]);
    // Back to a config B once loaded under, then the filter flips.
    authenticate.mockResolvedValue(undefined);
    playlists = [xtream("A"), xtream("B")];
    await loadLive(new Date(), undefined, true);
    await delay(null, 30);
    expect(lookupLive()?.channels.length).toBe(2);
    authenticate.mockImplementation(async (p: TestPlaylist) => {
      if (p.id === "B") throw new Error("HTTP 503");
    });
    showAdult = true;
    await loadLive(new Date(), undefined, true);
    await delay(null, 30);
    expect(lookupLive()?.channels.map((c) => c.id)).toEqual(["A:1"]);
  });

  it("a source that never loaded has none, as before", async () => {
    authenticate.mockImplementation(async (p: TestPlaylist) => {
      if (p.id === "B") throw new Error("HTTP 503");
    });
    const { loadLive, lookupLive } = await import("./source");
    const data = await loadLive(new Date());
    await delay(null, 30);
    expect(data.channels.map((c) => c.id)).toEqual(["A:1"]);
    const b = lookupLive()!.groups.find((g) => g.id === "B")!;
    expect(b.error).toMatch(/503/);
    expect(b.folders).toEqual([]);
  });
});

describe("a reload that changes the key is seeded with the guide it had (LV2)", () => {
  const FEEDS = "<tv>";
  const guideFor = (now: number, title: string) =>
    FEEDS +
    ["n1", "s1"]
      .map(
        (id) =>
          `<programme start="${stamp(new Date(now - 10 * MIN))}" stop="${stamp(new Date(now + 60 * MIN))}" channel="${id}"><title>${title}</title></programme>`,
      )
      .join("") +
    "</tv>";

  beforeEach(() => {
    playlists = [xtream("A")];
    fetchLiveCategories.mockImplementation(async () => [
      { id: "1", name: "News", adult: false },
      { id: "2", name: "Sport", adult: false },
      { id: "3", name: "XXX Adult", adult: true },
    ]);
    fetchLiveStreams.mockImplementation(async () => [
      { stream_id: 1, name: "N1", category_id: "1", epg_channel_id: "n1" },
      { stream_id: 2, name: "S1", category_id: "2", epg_channel_id: "s1" },
    ]);
    fetchXmltv.mockImplementation(async () => bytes(guideFor(Date.now(), "Now")));
  });

  /** The guide loaded, then the real one is held back, as a big one is. */
  async function loadedThenSlow() {
    const mod = await import("./source");
    await mod.loadLive(new Date());
    await delay(null, 60);
    expect(mod.lookupLive()?.programmes.size).toBe(2);
    fetchXmltv.mockImplementation(never);
    return mod;
  }

  it("a hidden folder keeps every surviving channel's lane, and Undo gets the folder back", async () => {
    const { loadLive, lookupLive } = await loadedThenSlow();
    playlists = [xtream("A", { hiddenCategories: ["2"] })];
    const hidden = await loadLive(new Date(), undefined, true);
    expect(hidden.channels.map((c) => c.id)).toEqual(["A:1"]);
    expect(hidden.programmes.get("A:1")?.[0].title).toBe("Now");
    // The real guide is still coming, and says so.
    expect(hidden.guidePending).toBe(true);
    // lookupLive (the palette's "On later", Sports' now-playing) has them too.
    expect(lookupLive()?.programmes.get("A:1")?.[0].title).toBe("Now");

    playlists = [xtream("A")];
    const undone = await loadLive(new Date(), undefined, true);
    expect(undone.channels.map((c) => c.id)).toEqual(["A:1", "A:2"]);
    expect(undone.programmes.get("A:1")?.[0].title).toBe("Now");
    expect(undone.programmes.get("A:2")?.[0].title).toBe("Now");
    expect(undone.guidePending).toBe(true);
    expect(lookupLive()?.programmes.size).toBe(2);
  });

  it("the adult filter flipping keeps the lanes too", async () => {
    const { loadLive, lookupLive } = await loadedThenSlow();
    showAdult = true;
    const data = await loadLive(new Date(), undefined, true);
    expect(data.programmes.get("A:1")?.[0].title).toBe("Now");
    expect(data.programmes.get("A:2")?.[0].title).toBe("Now");
    expect(lookupLive()?.programmes.size).toBe(2);
  });

  it("the guide that lands replaces what was seeded", async () => {
    const { loadLive, lookupLive } = await loadedThenSlow();
    playlists = [xtream("A", { hiddenCategories: ["2"] })];
    let land!: (b: ArrayBuffer) => void;
    fetchXmltv.mockImplementation(() => new Promise<ArrayBuffer>((r) => (land = r)));
    await loadLive(new Date(), undefined, true);
    expect(lookupLive()?.guidePending).toBe(true);
    land(bytes(guideFor(Date.now(), "Later")));
    await delay(null, 60);
    expect(lookupLive()?.programmes.get("A:1")?.[0].title).toBe("Later");
    expect(lookupLive()?.guidePending).toBeUndefined();
  });

  it("a guide that fails after a hide keeps the seeded one", async () => {
    const { loadLive, lookupLive } = await loadedThenSlow();
    playlists = [xtream("A", { hiddenCategories: ["2"] })];
    fetchXmltv.mockRejectedValue(new Error("timed out"));
    await loadLive(new Date(), undefined, true);
    await delay(null, 60);
    expect(lookupLive()?.programmes.get("A:1")?.[0].title).toBe("Now");
    expect(lookupLive()?.groups[0].epgError).toMatch(/guide download failed/);
  });

  it("a changed server is another feed, so nothing is seeded", async () => {
    const { loadLive, lookupLive } = await loadedThenSlow();
    playlists = [xtream("A", { server: "http://other.example.com" })];
    const data = await loadLive(new Date(), undefined, true);
    expect(data.channels.length).toBe(2);
    expect(data.programmes.size).toBe(0);
    expect(lookupLive()?.programmes.size).toBe(0);
  });

  it("a guide already here under the same key is not swapped for the seeded snapshot", async () => {
    const mod = await loadedThenSlow();
    const before = mod.lookupLive();
    // Same config, forced (a rename, say): the downgrade guard's case.
    await mod.loadLive(new Date(), undefined, true);
    expect(mod.lookupLive()).toBe(before);
    expect(mod.lookupLive()?.guidePending).toBeUndefined();
  });
});

describe("a queued disk write can't undo Clear All Login Info (LV6)", () => {
  // The earlier tests leave their own 1.5s writes pending, and they land in
  // the same mock. Let them go, then count only this test's.
  beforeEach(async () => {
    await delay(null, 1700);
    diskPut.mockClear();
  });

  it("writes when nothing changed, and not after a clear inside the window", async () => {
    playlists = [xtream("A")];
    // Control: left alone, the guide phase's write lands.
    let m = await import("./source");
    await m.loadLive(new Date());
    await delay(null, 1600);
    expect(diskPut).toHaveBeenCalledTimes(1);

    // The same load, with Clear All Login Info 1s after the guide lands.
    diskPut.mockClear();
    vi.resetModules();
    m = await import("./source");
    await m.loadLive(new Date());
    await delay(null, 100); // the guide phase has queued its write
    playlists = []; // savePlaylists([]), and diskClear() has emptied the disk
    await delay(null, 1600);
    expect(diskPut).not.toHaveBeenCalled();
  });

  it("nor after the config moved on to another", async () => {
    playlists = [xtream("A")];
    const m = await import("./source");
    await m.loadLive(new Date());
    await delay(null, 100);
    playlists = [xtream("A", { password: "new" })];
    await delay(null, 1600);
    expect(diskPut).not.toHaveBeenCalled();
  });
});
