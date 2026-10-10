import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GuideChannel, LiveData, LiveGroup } from "./model";
import { EPG_KEEP_AHEAD_MS, GUIDE_REFRESH_MS, VISIBLE_WINDOW_MS } from "./epgWindow";
import { fixKey, saveGuideFix } from "./guideFix";

/**
 * The guide is reused, not downloaded, on a load that doesn't need a new one.
 *
 * A launch used to download the whole xmltv (about 95MB, 60 to 77s on a big
 * provider) every time, and so did a Guide remount after the 30 minute memory
 * TTL. Now a SOURCE's guide is reused for GUIDE_REFRESH_MS while the channel
 * half of the load still runs, so a provider that renames an event channel at
 * noon is read fresh. These pin the rule (source.ts#canReuseGuide) from the
 * disk hydrate (a launch) and from memory (a remount), for each kind of source.
 *
 * The data layers are mocked, the saved playlists are a mutable list, and the
 * disk cache is a one-record fake that answers to whatever key it is asked
 * for: the key is the app's to build, and these are about what a load does
 * with the record it finds. The clock is the Date only, frozen, so a guide's
 * age is whatever a test sets it to and a stamp is exactly "now".
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
const fetchGenres = vi.fn();
const fetchChannels = vi.fn();
const fetchEpg = vi.fn();
vi.mock("../../data/stalker", () => ({
  fetchGenres: (...a: unknown[]) => fetchGenres(...a),
  fetchChannels: (...a: unknown[]) => fetchChannels(...a),
  fetchEpg: (...a: unknown[]) => fetchEpg(...a),
}));
const httpGetText = vi.fn();
const httpGetBytes = vi.fn();
vi.mock("../../lib/http", () => ({
  httpGetText: (...a: unknown[]) => httpGetText(...a),
  httpGetBytes: (...a: unknown[]) => httpGetBytes(...a),
  httpGetJson: vi.fn(),
}));

type TestPlaylist = { id: string; name: string; enabled: boolean } & (
  | { kind: "xtream"; server: string; username: string; password: string }
  | { kind: "m3u"; url: string }
  | { kind: "stalker"; portal: string; mac: string }
);
const xtream = (id: string): TestPlaylist => ({
  kind: "xtream",
  id,
  name: id,
  enabled: true,
  server: "http://tv.example.com",
  username: "u",
  password: "p",
});
const m3u = (id: string): TestPlaylist => ({
  kind: "m3u",
  id,
  name: id,
  enabled: true,
  url: "http://host/playlist.m3u",
});
const stalker = (id: string): TestPlaylist => ({
  kind: "stalker",
  id,
  name: id,
  enabled: true,
  portal: "http://portal.example",
  mac: "00:1A:79:AA:BB:CC",
});
let playlists: TestPlaylist[] = [];
const listeners = new Set<() => void>();
vi.mock("../settings/playlists", () => ({
  loadPlaylists: () => playlists,
  onPlaylistsChange: (cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
}));
vi.mock("../settings/adultFilter", () => ({ loadShowAdult: () => false }));

let disk: { at: number; data: LiveData; normalized?: true } | null = null;
const diskPut = vi.fn();
vi.mock("./diskCache", () => ({
  diskGet: async (key: string) => (disk ? { ...disk, key } : null),
  diskPut: (r: unknown) => diskPut(r),
}));

const MIN = 60_000;
const HOUR = 60 * MIN;
const delay = <T,>(v: T, ms: number) =>
  new Promise<T>((r) => setTimeout(() => r(v), ms));
const bytes = (s: string) => new TextEncoder().encode(s).buffer;
const stamp = (d: Date) =>
  d.toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
const sec = (ms: number) => Math.floor(ms / 1000);

/** A guide document with one programme covering `at` per EPG id. */
const guideFor = (at: number, epgIds: string[]) =>
  "<tv>" +
  epgIds
    .map(
      (id) =>
        `<programme start="${stamp(new Date(at - 10 * MIN))}" stop="${stamp(new Date(at + 60 * MIN))}" channel="${id}"><title>fresh ${id}</title></programme>`,
    )
    .join("") +
  "</tv>";

/** What a disk record holds: one old channel per source, with a programme
 * covering `at` titled "kept <id>". `over` sets a group's own fields. */
function snapshot(
  at: number,
  ids: string[],
  over: Record<string, Partial<LiveGroup>> = {},
  programmeEnds = at + 50 * MIN,
): LiveData {
  return {
    groups: ids.map((id) => ({ id, name: id, folders: [], ...over[id] })),
    channels: ids.map((id) => ({ id: `${id}:1`, name: `old ${id}` }) as never),
    programmes: new Map(
      ids.map((id) => [
        `${id}:1`,
        [
          {
            title: `kept ${id}`,
            start: new Date(at - 10 * MIN),
            end: new Date(programmeEnds),
          },
        ],
      ]),
    ),
  };
}

/** Poll for a condition the detached guide phase will reach. Bounded, so a
 * regression fails the test rather than hanging it. */
async function until(fn: () => unknown, ms = 2000) {
  for (let i = 0; i < ms / 10; i++) {
    if (fn()) return;
    await delay(null, 10);
  }
  throw new Error("never happened");
}

const fetchedFor = (fn: typeof fetchXmltv) =>
  fn.mock.calls.map((c) => (c[0] as { id: string }).id).sort();

let T = 0;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  listeners.clear();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T19:00:00Z"));
  T = Date.now();
  playlists = [xtream("A")];
  disk = null;
  authenticate.mockResolvedValue(undefined);
  fetchLiveCategories.mockResolvedValue([{ id: "1", name: "News", adult: false }]);
  fetchLiveStreams.mockImplementation(async (p: { id: string }) => [
    { stream_id: 1, name: `new ${p.id}`, category_id: "1", epg_channel_id: `${p.id}.epg` },
  ]);
  fetchXmltv.mockImplementation(async (p: { id: string }) =>
    bytes(guideFor(Date.now(), [`${p.id}.epg`])),
  );
  fetchGenres.mockResolvedValue([{ id: "1", title: "News", censored: false }]);
  fetchChannels.mockResolvedValue([
    { id: "101", name: "News One", cmd: "ffconc x", genreId: "1", censored: false },
  ]);
  fetchEpg.mockImplementation(async () =>
    new Map([
      ["101", [{ title: "Fresh brief", start: sec(Date.now() - 30 * MIN), stop: sec(Date.now() + 2 * HOUR) }]],
    ]),
  );
  httpGetText.mockResolvedValue(
    [
      "#EXTM3U",
      '#EXTM3U url-tvg="http://epg.example/guide.xml"',
      '#EXTINF:-1 tvg-id="m1" group-title="UK",BBC One',
      "http://host/live/1.ts",
    ].join("\n"),
  );
  httpGetBytes.mockImplementation(async () => bytes(guideFor(Date.now(), ["m1"])));
});
afterEach(() => vi.useRealTimers());

/** A launch: the record hydrates, the channel half reloads behind it. */
async function launch() {
  const m = await import("./source");
  const hydrated = await m.loadLive(new Date());
  return { ...m, hydrated };
}
const group = (m: { lookupLive: () => LiveData | null }, id: string) =>
  m.lookupLive()!.groups.find((g) => g.id === id)!;

describe("a hydrated launch reuses a guide that is still good", () => {
  it("reloads the channels, skips the guide, keeps the programmes and the stamp", async () => {
    // The record was rewritten an hour ago; its guide is five hours old.
    disk = { at: T - HOUR, data: snapshot(T, ["A"], { A: { guideAt: T - 5 * HOUR } }), normalized: true };
    const m = await launch();
    expect(m.hydrated.guidePending).toBeUndefined();
    await until(() => m.lookupLive()?.channels[0]?.name === "new A");
    expect(fetchLiveStreams).toHaveBeenCalledTimes(1);
    expect(fetchXmltv).not.toHaveBeenCalled();
    // The channel half is fresh, the guide behind it is the one it had.
    expect(m.lookupLive()!.programmes.get("A:1")?.[0].title).toBe("kept A");
    expect(group(m, "A").guideAt).toBe(T - 5 * HOUR);
    expect(group(m, "A").epgError).toBeUndefined();
    expect(m.lookupLive()!.guidePending).toBeUndefined();
  });

  it("writes the record with the stamp carried, not a fresh one", async () => {
    disk = { at: T - HOUR, data: snapshot(T, ["A"], { A: { guideAt: T - 5 * HOUR } }), normalized: true };
    const m = await launch();
    await until(() => m.lookupLive()?.channels[0]?.name === "new A");
    await delay(null, 1600); // scheduleDiskPut's 1.5s
    const written = diskPut.mock.calls.at(-1)?.[0] as { at: number; data: LiveData };
    expect(written.at).toBe(T);
    expect(written.data.groups[0].guideAt).toBe(T - 5 * HOUR);
    expect(written.data.programmes.get("A:1")?.[0].title).toBe("kept A");
  });

  it("downloads a guide older than the refresh window, whatever the record's age", async () => {
    // Same record, but the guide is 13 hours old and the record an hour.
    disk = { at: T - HOUR, data: snapshot(T, ["A"], { A: { guideAt: T - 13 * HOUR } }), normalized: true };
    const m = await launch();
    await until(() => m.lookupLive()?.programmes.get("A:1")?.[0].title === "fresh A.epg");
    expect(fetchXmltv).toHaveBeenCalledTimes(1);
    expect(group(m, "A").guideAt).toBe(T);
  });

  it("judges each source by its own guide: only the stale one downloads", async () => {
    playlists = [xtream("A"), xtream("B")];
    disk = {
      at: T - HOUR,
      data: snapshot(T, ["A", "B"], { A: { guideAt: T - HOUR }, B: { guideAt: T - 13 * HOUR } }),
      normalized: true,
    };
    const m = await launch();
    await until(() => m.lookupLive()?.programmes.get("B:1")?.[0].title === "fresh B.epg");
    expect(fetchedFor(fetchXmltv)).toEqual(["B"]);
    expect(m.lookupLive()!.programmes.get("A:1")?.[0].title).toBe("kept A");
    expect(group(m, "A").guideAt).toBe(T - HOUR);
    expect(group(m, "B").guideAt).toBe(T);
  });

  it("downloads a source whose guide failed, and leaves the other alone", async () => {
    playlists = [xtream("A"), xtream("B")];
    disk = {
      at: T - HOUR,
      data: snapshot(T, ["A", "B"], {
        A: { epgError: "guide download failed: timed out" },
        B: { guideAt: T - HOUR },
      }),
      normalized: true,
    };
    const m = await launch();
    await until(() => !group(m, "A").epgError && group(m, "A").guideAt);
    expect(fetchedFor(fetchXmltv)).toEqual(["A"]);
    expect(group(m, "B").guideAt).toBe(T - HOUR);
  });

  it("downloads a source that failed to load", async () => {
    disk = {
      at: T - HOUR,
      data: snapshot(T, ["A"], { A: { guideAt: T - HOUR, error: "HTTP 503" } }),
      normalized: true,
    };
    const m = await launch();
    await until(() => fetchXmltv.mock.calls.length > 0);
    expect(fetchedFor(fetchXmltv)).toEqual(["A"]);
    void m;
  });

  it("downloads a guide that has run out of schedule, however young", async () => {
    // Stamped an hour ago, but every programme ended before now.
    disk = {
      at: T - HOUR,
      data: snapshot(T, ["A"], { A: { guideAt: T - HOUR } }, T - 20 * MIN),
      normalized: true,
    };
    const m = await launch();
    expect(m.hydrated.guidePending).toBe(true);
    await until(() => fetchXmltv.mock.calls.length > 0);
    expect(fetchedFor(fetchXmltv)).toEqual(["A"]);
  });

  it("downloads a guide stamped in the future (the clock moved)", async () => {
    disk = {
      at: T - HOUR,
      data: snapshot(T, ["A"], { A: { guideAt: T + 5 * HOUR } }),
      normalized: true,
    };
    const m = await launch();
    await until(() => fetchXmltv.mock.calls.length > 0);
    void m;
    expect(fetchedFor(fetchXmltv)).toEqual(["A"]);
  });
});

describe("a record from before guideAt existed (legacy)", () => {
  it("is taken to have landed when the record was written", async () => {
    // 2h old: inside the window, so the guide is reused and stamped 2h ago.
    disk = { at: T - 2 * HOUR, data: snapshot(T, ["A"]), normalized: true };
    const m = await launch();
    await until(() => m.lookupLive()?.channels[0]?.name === "new A");
    expect(fetchXmltv).not.toHaveBeenCalled();
    expect(group(m, "A").guideAt).toBe(T - 2 * HOUR);
  });

  it("downloads when the record is past the window", async () => {
    disk = { at: T - 13 * HOUR, data: snapshot(T, ["A"]), normalized: true };
    const m = await launch();
    await until(() => m.lookupLive()?.programmes.get("A:1")?.[0].title === "fresh A.epg");
    expect(fetchXmltv).toHaveBeenCalledTimes(1);
  });

  it("does not stamp a group that never had a guide", async () => {
    playlists = [xtream("A"), xtream("B")];
    disk = {
      at: T - 2 * HOUR,
      data: snapshot(T, ["A", "B"], { B: { epgError: "no guide" } }),
      normalized: true,
    };
    const m = await launch();
    expect(m.hydrated.groups.find((g) => g.id === "A")?.guideAt).toBe(T - 2 * HOUR);
    expect(m.hydrated.groups.find((g) => g.id === "B")?.guideAt).toBeUndefined();
    await until(() => fetchXmltv.mock.calls.length > 0);
    expect(fetchedFor(fetchXmltv)).toEqual(["B"]);
  });
});

describe("a guide older than its schedule hydrates with the note", () => {
  const edge = EPG_KEEP_AHEAD_MS - VISIBLE_WINDOW_MS;

  it("past the retained schedule: guidePending, and the load downloads it", async () => {
    playlists = [xtream("A"), xtream("B")];
    // A is fresh. B's guide is older than the schedule it kept, though the
    // record that holds it was rewritten an hour ago.
    disk = {
      at: T - HOUR,
      data: snapshot(T, ["A", "B"], { A: { guideAt: T - HOUR }, B: { guideAt: T - edge - HOUR } }),
      normalized: true,
    };
    const m = await launch();
    expect(m.hydrated.guidePending).toBe(true);
    await until(() => fetchXmltv.mock.calls.length > 0);
    expect(fetchedFor(fetchXmltv)).toEqual(["B"]);
  });

  it("inside it: stale by the refresh rule so it downloads, but says nothing", async () => {
    disk = {
      at: T - HOUR,
      data: snapshot(T, ["A"], { A: { guideAt: T - edge + HOUR } }),
      normalized: true,
    };
    const m = await launch();
    expect(m.hydrated.guidePending).toBeUndefined();
    await until(() => fetchXmltv.mock.calls.length > 0);
    expect(fetchedFor(fetchXmltv)).toEqual(["A"]);
  });
});

describe("a load from memory", () => {
  /** The first load of a session, with its guide landed. */
  async function coldLoad() {
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.groups.every((g) => g.guideAt || g.epgError));
    fetchXmltv.mockClear();
    fetchLiveStreams.mockClear();
    return m;
  }

  it("a stale remount reuses the guide and does not renew its stamp", async () => {
    const m = await coldLoad();
    const first = group(m, "A").guideAt;
    expect(first).toBe(T);
    // Half an hour on: the memory cache is stale, the guide is not.
    vi.setSystemTime(T + 31 * MIN);
    await m.loadLive(new Date());
    await until(() => fetchLiveStreams.mock.calls.length > 0);
    await delay(null, 60);
    expect(fetchXmltv).not.toHaveBeenCalled();
    expect(group(m, "A").guideAt).toBe(first);
    expect(m.lookupLive()!.programmes.get("A:1")?.[0].title).toBe("fresh A.epg");
    // Thirteen hours on, it is not.
    vi.setSystemTime(T + 13 * HOUR);
    await m.loadLive(new Date());
    await until(() => group(m, "A").guideAt === T + 13 * HOUR);
    expect(fetchXmltv).toHaveBeenCalledTimes(1);
  });

  it("a forced load downloads every guide whatever its age", async () => {
    playlists = [xtream("A"), xtream("B")];
    const m = await coldLoad();
    vi.setSystemTime(T + 5 * MIN);
    await m.loadLive(new Date(), undefined, true);
    await until(() => group(m, "A").guideAt === T + 5 * MIN && group(m, "B").guideAt === T + 5 * MIN);
    expect(fetchedFor(fetchXmltv)).toEqual(["A", "B"]);
  });

  it("a different config is not this config's guide", async () => {
    const m = await coldLoad();
    // B is added without a force (the key moved). A's guide is young, but it
    // belongs to the old key, so nothing is reused.
    playlists = [xtream("A"), xtream("B")];
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.groups.length === 2 && fetchXmltv.mock.calls.length === 2);
    expect(fetchedFor(fetchXmltv)).toEqual(["A", "B"]);
  });

  it("a guide that failed has no stamp, and the next load tries it again", async () => {
    fetchXmltv.mockRejectedValue(new Error("timed out"));
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.groups[0].epgError);
    expect(group(m, "A").guideAt).toBeUndefined();
    fetchXmltv.mockClear();
    vi.setSystemTime(T + 31 * MIN);
    await m.loadLive(new Date());
    await until(() => fetchXmltv.mock.calls.length > 0);
    expect(fetchedFor(fetchXmltv)).toEqual(["A"]);
  });

  it("an M3U with no guide link doesn't stop another source reusing its own", async () => {
    httpGetText.mockResolvedValue(
      ["#EXTM3U", '#EXTINF:-1 tvg-id="m1" group-title="UK",BBC One', "http://host/live/1.ts"].join("\n"),
    );
    playlists = [xtream("A"), m3u("M")];
    const m = await coldLoad();
    expect(group(m, "M").epgError).toMatch(/no guide/);
    vi.setSystemTime(T + 31 * MIN);
    await m.loadLive(new Date());
    await until(() => fetchLiveStreams.mock.calls.length > 0);
    await delay(null, 60);
    expect(fetchXmltv).not.toHaveBeenCalled();
    expect(group(m, "A").guideAt).toBe(T);
    expect(httpGetBytes).not.toHaveBeenCalled();
  });
});

describe("each kind of source skips its own guide download", () => {
  it("M3U: the playlist reloads, the url-tvg guide doesn't", async () => {
    playlists = [m3u("M")];
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.groups[0].guideAt);
    expect(httpGetBytes).toHaveBeenCalledTimes(1);
    httpGetBytes.mockClear();
    httpGetText.mockClear();
    vi.setSystemTime(T + 31 * MIN);
    await m.loadLive(new Date());
    await until(() => httpGetText.mock.calls.length > 0);
    await delay(null, 60);
    expect(httpGetBytes).not.toHaveBeenCalled();
    expect(group(m, "M").guideAt).toBe(T);
    expect(m.lookupLive()!.programmes.get("M:m1")?.[0].title).toBe("fresh m1");
    vi.setSystemTime(T + 13 * HOUR);
    await m.loadLive(new Date());
    await until(() => httpGetBytes.mock.calls.length > 0);
  });

  it("Stalker: the channel list reloads, get_epg_info doesn't", async () => {
    playlists = [stalker("S")];
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.groups[0].guideAt);
    expect(fetchEpg).toHaveBeenCalledTimes(1);
    fetchEpg.mockClear();
    fetchChannels.mockClear();
    vi.setSystemTime(T + 31 * MIN);
    await m.loadLive(new Date());
    await until(() => fetchChannels.mock.calls.length > 0);
    await delay(null, 60);
    expect(fetchEpg).not.toHaveBeenCalled();
    expect(group(m, "S").guideAt).toBe(T);
    expect(m.lookupLive()!.programmes.get("S:101")?.[0].title).toBe("Fresh brief");
    vi.setSystemTime(T + 13 * HOUR);
    await m.loadLive(new Date());
    await until(() => fetchEpg.mock.calls.length > 0);
  });
});

describe("refreshLiveNow", () => {
  beforeEach(() => vi.stubGlobal("window", new EventTarget()));
  afterEach(() => vi.unstubAllGlobals());

  it("forces a download of a fresh guide, announces, and settles when the guide has landed", async () => {
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.groups[0].guideAt);
    fetchXmltv.mockClear();
    // A guide that takes its time, as a real one does.
    fetchXmltv.mockImplementation(async (p: { id: string }) => {
      await delay(null, 80);
      return bytes(guideFor(Date.now(), [`${p.id}.epg`]));
    });
    vi.setSystemTime(T + 5 * MIN); // the old guide is five minutes old: not stale
    let announced = 0;
    m.onLiveRefreshed(() => announced++);
    let settled = false;
    const done = m.refreshLiveNow().then(() => (settled = true));
    await until(() => announced > 0); // the channels landed
    expect(settled).toBe(false); // the guide is still in the air
    expect(group(m, "A").guideAt).toBe(T);
    await done;
    expect(fetchedFor(fetchXmltv)).toEqual(["A"]);
    expect(group(m, "A").guideAt).toBe(T + 5 * MIN);
  });

  it("settles when the guide fails too", async () => {
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.groups[0].guideAt);
    fetchXmltv.mockRejectedValue(new Error("timed out"));
    await m.refreshLiveNow();
    expect(group(m, "A").epgError).toMatch(/guide download failed/);
  });

  it("loads nothing with no enabled source", async () => {
    playlists = [];
    const m = await import("./source");
    await m.refreshLiveNow();
    expect(authenticate).not.toHaveBeenCalled();
  });

  it("is what a playlist change runs", async () => {
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.groups[0].guideAt);
    fetchXmltv.mockClear();
    vi.setSystemTime(T + 5 * MIN);
    const stop = m.watchPlaylists();
    listeners.forEach((cb) => cb());
    // The burst settles, then a forced load: the guide is five minutes old
    // and downloads anyway.
    await until(() => group(m, "A").guideAt === T + 5 * MIN, 3000);
    stop();
    expect(fetchedFor(fetchXmltv)).toEqual(["A"]);
  });
});

describe("the guide's own channel list, for Fix guide…", () => {
  // The fixes live in localStorage. An in-memory one, stubbed per test:
  // refreshLiveNow's tests above unstub every global when they finish.
  const mem = new Map<string, string>();
  beforeEach(() => {
    mem.clear();
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => mem.get(k) ?? null,
      setItem: (k: string, v: string) => void mem.set(k, v),
      removeItem: (k: string) => void mem.delete(k),
    });
  });
  afterEach(() => vi.unstubAllGlobals());

  /** A guide that declares its channels, as a real one does, with a
   * programme covering `at` for each id in `programmesFor`. */
  const declaring = (at: number, channels: [id: string, name: string][], programmesFor: string[]) =>
    "<tv>" +
    channels.map(([id, name]) => `<channel id="${id}"><display-name>${name}</display-name></channel>`).join("") +
    guideFor(at, programmesFor).slice("<tv>".length);
  const LIST: GuideChannel[] = [
    { id: "A.epg", name: "Alpha" },
    { id: "other.epg", name: "Other" },
  ];
  const BOTH: [string, string][] = [
    ["A.epg", "Alpha"],
    ["other.epg", "Other"],
  ];

  it("a downloaded guide puts its channels on the source's group, matched or not", async () => {
    fetchXmltv.mockImplementation(async () => bytes(declaring(Date.now(), BOTH, ["A.epg"])));
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => group(m, "A").guideAt);
    expect(group(m, "A").guideChannels).toEqual(LIST);
    // And the channel knows which one of them it matched.
    expect(m.lookupLive()!.channels[0].epgId).toBe("A.epg");
  });

  it("a guide that matched none of our channels still lists its own", async () => {
    // Our channel says A.epg. The guide has never heard of it.
    fetchXmltv.mockImplementation(async () =>
      bytes(declaring(Date.now(), [["x.epg", "Ex"], ["y.epg", "Why"]], ["x.epg"])),
    );
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => group(m, "A").epgError);
    expect(group(m, "A").epgError).toMatch(/matched none/);
    expect(group(m, "A").guideAt).toBeUndefined();
    expect(group(m, "A").guideChannels).toEqual([
      { id: "x.epg", name: "Ex" },
      { id: "y.epg", name: "Why" },
    ]);
  });

  it("a reused guide carries its list forward, as it carries its stamp", async () => {
    disk = {
      at: T - HOUR,
      data: snapshot(T, ["A"], { A: { guideAt: T - 5 * HOUR, guideChannels: LIST } }),
      normalized: true,
    };
    const m = await launch();
    await until(() => m.lookupLive()?.channels[0]?.name === "new A");
    expect(fetchXmltv).not.toHaveBeenCalled();
    expect(group(m, "A").guideAt).toBe(T - 5 * HOUR);
    expect(group(m, "A").guideChannels).toEqual(LIST);
    await delay(null, 1600); // scheduleDiskPut's 1.5s
    const written = diskPut.mock.calls.at(-1)?.[0] as { data: LiveData };
    expect(written.data.groups[0].guideChannels).toEqual(LIST);
  });

  it("a new guide replaces the list the source held", async () => {
    disk = {
      at: T - HOUR,
      data: snapshot(T, ["A"], { A: { guideAt: T - 13 * HOUR, guideChannels: LIST } }),
      normalized: true,
    };
    fetchXmltv.mockImplementation(async () =>
      bytes(declaring(Date.now(), [["A.epg", "Alpha Renamed"]], ["A.epg"])),
    );
    const m = await launch();
    await until(() => group(m, "A").guideAt === T);
    expect(group(m, "A").guideChannels).toEqual([{ id: "A.epg", name: "Alpha Renamed" }]);
  });

  it("a guide that fails to download leaves the list the source had", async () => {
    disk = {
      at: T - HOUR,
      data: snapshot(T, ["A"], { A: { guideAt: T - 13 * HOUR, guideChannels: LIST } }),
      normalized: true,
    };
    fetchXmltv.mockRejectedValue(new Error("timed out"));
    const m = await launch();
    await until(() => group(m, "A").epgError);
    expect(group(m, "A").guideChannels).toEqual(LIST);
  });

  it("another login on the same playlist id does not inherit it", async () => {
    fetchXmltv.mockImplementation(async () => bytes(declaring(Date.now(), BOTH, ["A.epg"])));
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => group(m, "A").guideChannels);
    // Same id, another password: another account's guide.
    playlists = [{ ...(xtream("A") as TestPlaylist & { kind: "xtream" }), password: "other" }];
    fetchXmltv.mockRejectedValue(new Error("timed out"));
    await m.loadLive(new Date());
    await until(() => group(m, "A").epgError);
    expect(group(m, "A").guideChannels).toBeUndefined();
  });

  it("the half-built catalog of a refresh keeps it while the guide downloads", async () => {
    // The first guide matched nothing, so it holds no programmes, and the
    // catalog a refresh publishes before its guide lands is the builders'.
    fetchXmltv.mockImplementation(async () => bytes(declaring(Date.now(), [["x.epg", "Ex"]], ["x.epg"])));
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => group(m, "A").epgError);
    fetchXmltv.mockImplementation(async () => {
      await delay(null, 200);
      return bytes(declaring(Date.now(), [["x.epg", "Ex"]], ["x.epg"]));
    });
    const data = await m.loadLive(new Date(), undefined, true);
    expect(data.guidePending).toBe(true);
    expect(data.groups[0].guideChannels).toEqual([{ id: "x.epg", name: "Ex" }]);
    expect(m.lookupLive()!.groups[0].guideChannels).toEqual([{ id: "x.epg", name: "Ex" }]);
  });

  it("an M3U's url-tvg guide lists its channels too", async () => {
    playlists = [m3u("M")];
    httpGetBytes.mockImplementation(async () =>
      bytes(declaring(Date.now(), [["m1", "BBC One"], ["m2", "BBC Two"]], ["m1"])),
    );
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => group(m, "M").guideAt);
    expect(group(m, "M").guideChannels).toEqual([
      { id: "m1", name: "BBC One" },
      { id: "m2", name: "BBC Two" },
    ]);
    expect(m.lookupLive()!.channels[0].epgId).toBe("m1");
  });

  it("a Stalker source has none: its guide comes per channel", async () => {
    playlists = [stalker("S")];
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => group(m, "S").guideAt);
    expect(group(m, "S").guideChannels).toBeUndefined();
  });

  it("a fix is in the index the forced refresh parses with: the lane fills", async () => {
    // Our channel says A.epg and the guide has no such channel; its listings
    // are under other.epg.
    fetchXmltv.mockImplementation(async () => bytes(declaring(Date.now(), BOTH.slice(1), ["other.epg"])));
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => group(m, "A").epgError);
    expect(m.lookupLive()!.programmes.get("A:1")).toBeUndefined();
    saveGuideFix("A", "A:1", "other.epg");
    await m.loadLive(new Date(), undefined, true);
    await until(() => m.lookupLive()?.programmes.get("A:1"));
    expect(m.lookupLive()!.programmes.get("A:1")?.[0].title).toBe("fresh other.epg");
    expect(group(m, "A").epgError).toBeUndefined();
    expect(group(m, "A").guideAt).toBe(T);
  });

  it("and a channel the provider gave no id at all can be given one", async () => {
    fetchLiveStreams.mockResolvedValue([{ stream_id: 1, name: "No id", category_id: "1" }]);
    fetchXmltv.mockImplementation(async () => bytes(declaring(Date.now(), BOTH, ["A.epg"])));
    saveGuideFix("A", "A:1", "A.epg");
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.programmes.get("A:1"));
    expect(m.lookupLive()!.programmes.get("A:1")?.[0].title).toBe("fresh A.epg");
  });

  it("an M3U channel can be given another guide id the same way", async () => {
    playlists = [m3u("M")];
    httpGetBytes.mockImplementation(async () => bytes(declaring(Date.now(), [["m2", "BBC Two"]], ["m2"])));
    saveGuideFix("M", "M:m1", "m2");
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.programmes.get("M:m1"));
    expect(m.lookupLive()!.programmes.get("M:m1")?.[0].title).toBe("fresh m2");
  });

  it("a fix saved since the guide was parsed is not left out by reuse", async () => {
    // A fresh guide on disk, parsed with no fixes; a fix saved after it whose
    // forced refresh never landed (the app was closed). The next launch must
    // download the guide with the fix in the index, not reuse it for 12h.
    disk = { at: T - HOUR, data: snapshot(T, ["A"], { A: { guideAt: T - HOUR } }), normalized: true };
    fetchXmltv.mockImplementation(async () => bytes(declaring(Date.now(), BOTH.slice(1), ["other.epg"])));
    saveGuideFix("A", "A:1", "other.epg");
    const m = await launch();
    await until(() => m.lookupLive()?.programmes.get("A:1")?.[0].title === "fresh other.epg");
    expect(fetchXmltv).toHaveBeenCalledTimes(1);
    expect(group(m, "A").guideFixKey).toBe(fixKey({ "A:1": "other.epg" }));
  });

  it("and a guide parsed with the fixes that still stand is reused as before", async () => {
    saveGuideFix("A", "A:1", "other.epg");
    const key = fixKey({ "A:1": "other.epg" });
    disk = {
      at: T - HOUR,
      data: snapshot(T, ["A"], { A: { guideAt: T - HOUR, guideFixKey: key } }),
      normalized: true,
    };
    const m = await launch();
    await until(() => m.lookupLive()?.channels[0]?.name === "new A");
    expect(fetchXmltv).not.toHaveBeenCalled();
    expect(group(m, "A").guideFixKey).toBe(key);
  });

  it("a fix for another playlist's channel does nothing here", async () => {
    fetchXmltv.mockImplementation(async () => bytes(declaring(Date.now(), BOTH.slice(1), ["other.epg"])));
    saveGuideFix("B", "A:1", "other.epg");
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => group(m, "A").epgError);
    expect(m.lookupLive()!.programmes.get("A:1")).toBeUndefined();
  });
});

describe("the constants", () => {
  it("a guide is refreshed well before the schedule it carries runs out", () => {
    // The refresh interval plus the longest wait for a launch to notice it
    // has to stay inside the retained schedule, or the note above never helps.
    expect(GUIDE_REFRESH_MS).toBeLessThan(EPG_KEEP_AHEAD_MS - VISIBLE_WINDOW_MS);
  });
});
