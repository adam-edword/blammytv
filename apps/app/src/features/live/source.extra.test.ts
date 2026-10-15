import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveData } from "./model";
import { fixKey, saveGuideFix } from "./guideFix";

/**
 * A playlist's extra guide, and its User-Agent on the way to the guide
 * (plan 025, P5).
 *
 * The extra guide FILLS THE GAPS: the provider's guide wins wherever it has
 * programmes, the extra one is asked only about the channels the provider's
 * left empty, and its failure never costs the provider's guide. These pin that
 * for each kind of source, with the data layers mocked as source.guide.test.ts
 * mocks them, the saved playlists a mutable list, and the real XMLTV reader
 * (there is no Worker here, so the parse runs on the page, as it does when a
 * worker will not start).
 *
 * The clock is the Date only, frozen, so a guide's age is what a test sets.
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

type Advanced = { extraGuide?: string; userAgent?: string };
type TestPlaylist = { id: string; name: string; enabled: boolean } & Advanced &
  (
    | { kind: "xtream"; server: string; username: string; password: string }
    | { kind: "m3u"; url: string }
    | { kind: "stalker"; portal: string; mac: string }
  );
const xtream = (id: string, adv: Advanced = {}): TestPlaylist => ({
  kind: "xtream",
  id,
  name: id,
  enabled: true,
  server: "http://tv.example.com",
  username: "u",
  password: "p",
  ...adv,
});
const m3u = (id: string, adv: Advanced = {}): TestPlaylist => ({
  kind: "m3u",
  id,
  name: id,
  enabled: true,
  url: "http://host/playlist.m3u",
  ...adv,
});
const stalker = (id: string, adv: Advanced = {}): TestPlaylist => ({
  kind: "stalker",
  id,
  name: id,
  enabled: true,
  portal: "http://portal.example",
  mac: "00:1A:79:AA:BB:CC",
  ...adv,
});
let playlists: TestPlaylist[] = [];
vi.mock("../settings/playlists", () => ({
  loadPlaylists: () => playlists,
  onPlaylistsChange: () => () => {},
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
const delay = <T,>(v: T, ms: number) => new Promise<T>((r) => setTimeout(() => r(v), ms));
const bytes = (s: string) => new TextEncoder().encode(s).buffer;
const stamp = (d: Date) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14) + " +0000";
const sec = (ms: number) => Math.floor(ms / 1000);

/** An XMLTV document: for each [id, name, title] one programme on now, an hour
 * long unless `span` says otherwise. */
const guide = (at: number, rows: [id: string, name: string, title: string][], span = 60 * MIN) =>
  "<tv>" +
  rows.map(([id, name]) => `<channel id="${id}"><display-name>${name}</display-name></channel>`).join("") +
  rows
    .map(
      ([id, , title]) =>
        `<programme start="${stamp(new Date(at - 10 * MIN))}" stop="${stamp(new Date(at + span))}" channel="${id}"><title>${title}</title></programme>`,
    )
    .join("") +
  "</tv>";

async function until(fn: () => unknown, ms = 2000) {
  for (let i = 0; i < ms / 10; i++) {
    if (fn()) return;
    await delay(null, 10);
  }
  throw new Error("never happened");
}

const EXTRA = "https://extra.example/guide.xml?token=SECRETTOKEN123";
const AGENT = "TestApp/9.1 (Provider Check)";

/** An Xtream line of four channels: the first and last have a guide id the
 * provider's guide knows, the second one the provider's does not (the extra
 * guide has it), the third one neither guide has. */
const STREAMS = [
  { stream_id: 1, name: "One", category_id: "1", epg_channel_id: "one.epg" },
  { stream_id: 2, name: "Two", category_id: "1", epg_channel_id: "two.epg" },
  { stream_id: 3, name: "Three", category_id: "1", epg_channel_id: "three.epg" },
  { stream_id: 4, name: "Four", category_id: "1", epg_channel_id: "four.epg" },
];

// The hand fixes live in localStorage: an in-memory one, new for each test.
const mem = new Map<string, string>();

let T = 0;
beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  mem.clear();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => mem.get(k) ?? null,
    setItem: (k: string, v: string) => void mem.set(k, v),
    removeItem: (k: string) => void mem.delete(k),
  });
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T19:00:00Z"));
  T = Date.now();
  playlists = [xtream("A", { extraGuide: EXTRA })];
  disk = null;
  authenticate.mockResolvedValue(undefined);
  fetchLiveCategories.mockResolvedValue([{ id: "1", name: "News", adult: false }]);
  fetchLiveStreams.mockResolvedValue(STREAMS);
  // The provider's guide has One and Four. The extra one has Two and Four
  // (with another title), so Four is the channel both have.
  fetchXmltv.mockImplementation(async () =>
    bytes(
      guide(Date.now(), [
        ["one.epg", "One", "Provider One"],
        ["four.epg", "Four", "Provider Four"],
      ]),
    ),
  );
  httpGetBytes.mockImplementation(async () =>
    bytes(
      guide(Date.now(), [
        ["two.epg", "Two", "Extra Two"],
        ["four.epg", "Four", "Extra Four"],
      ]),
    ),
  );
  fetchGenres.mockResolvedValue([{ id: "1", title: "News", censored: false }]);
  fetchChannels.mockResolvedValue([
    { id: "101", name: "Stal One", cmd: "ffconc a", genreId: "1", censored: false, xmltvId: "s1.xml" },
    { id: "102", name: "Stal Two", cmd: "ffconc b", genreId: "1", censored: false, xmltvId: "s2.xml" },
    { id: "103", name: "Stal Three", cmd: "ffconc c", genreId: "1", censored: false },
  ]);
  fetchEpg.mockImplementation(async () =>
    new Map([["101", [{ title: "Portal One", start: sec(Date.now() - 30 * MIN), stop: sec(Date.now() + 2 * HOUR) }]]]),
  );
  httpGetText.mockResolvedValue(
    [
      "#EXTM3U",
      '#EXTM3U url-tvg="http://epg.example/guide.xml"',
      '#EXTINF:-1 tvg-id="one.epg" group-title="UK",One',
      "http://host/live/1.ts",
      '#EXTINF:-1 tvg-id="two.epg" group-title="UK",Two',
      "http://host/live/2.ts",
      '#EXTINF:-1 tvg-id="three.epg" group-title="UK",Three',
      "http://host/live/3.ts",
    ].join("\n"),
  );
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function load() {
  const m = await import("./source");
  await m.refreshLiveNow();
  return { ...m, data: m.lookupLive()! };
}
const title = (d: LiveData, id: string) => d.programmes.get(id)?.[0]?.title;
const group = (d: LiveData, id: string) => d.groups.find((g) => g.id === id)!;

/** What a disk record holds for one source: a single old channel `<id>:1`
 * with a programme covering now, and the group fields a test sets. */
function snapshot(id: string, over: Partial<LiveData["groups"][number]> = {}): LiveData {
  return {
    groups: [{ id, name: id, folders: [], ...over }],
    channels: [{ id: `${id}:1`, name: "old" } as never],
    programmes: new Map([
      [`${id}:1`, [{ title: "kept", start: new Date(T - 10 * MIN), end: new Date(T + 50 * MIN) }]],
    ]),
  };
}

describe("an Xtream line's extra guide fills the gaps", () => {
  it("keeps the provider's programme where it has one, fills a gap, and leaves a channel in neither empty", async () => {
    const { data } = await load();
    // The provider's guide stands where it has programmes ...
    expect(title(data, "A:1")).toBe("Provider One");
    // ... also where the extra guide has the channel too ...
    expect(title(data, "A:4")).toBe("Provider Four");
    // ... the gap the extra guide has is filled ...
    expect(title(data, "A:2")).toBe("Extra Two");
    // ... and a channel in neither stays on "No Information".
    expect(data.programmes.get("A:3")).toBeUndefined();
    expect(group(data, "A").epgError).toBeUndefined();
    expect(group(data, "A").extraGuideError).toBeUndefined();
  });

  it("downloads it after the provider's guide, with 180 seconds, and no headers without an agent", async () => {
    await load();
    expect(httpGetBytes).toHaveBeenCalledTimes(1);
    expect(httpGetBytes).toHaveBeenCalledWith(EXTRA, undefined, 180);
  });

  it("downloads it with the playlist's User-Agent when it has one", async () => {
    playlists = [xtream("A", { extraGuide: EXTRA, userAgent: `  ${AGENT}  ` })];
    await load();
    expect(httpGetBytes).toHaveBeenCalledWith(EXTRA, { "User-Agent": AGENT }, 180);
  });

  it("does not use an address that is not http or https", async () => {
    playlists = [xtream("A", { extraGuide: "file:///C:/guide.xml" })];
    const { data } = await load();
    expect(httpGetBytes).not.toHaveBeenCalled();
    expect(title(data, "A:2")).toBeUndefined();
    expect(group(data, "A").extraGuideError).toBeUndefined();
  });

  it("downloads nothing when the provider's guide has no gaps", async () => {
    fetchLiveStreams.mockResolvedValue([STREAMS[0], STREAMS[3]]);
    await load();
    expect(httpGetBytes).not.toHaveBeenCalled();
  });

  it("downloads nothing for a playlist without one, and the load is what it was", async () => {
    playlists = [xtream("A")];
    const { data } = await load();
    expect(httpGetBytes).not.toHaveBeenCalled();
    expect(title(data, "A:2")).toBeUndefined();
    expect(title(data, "A:1")).toBe("Provider One");
  });

  it("lists the guide's channels first and the extra guide's after, once each", async () => {
    const { data } = await load();
    expect(group(data, "A").guideChannels?.map((c) => c.id)).toEqual(["one.epg", "four.epg", "two.epg"]);
  });

  it("matches by the hand fixes too: a channel fixed onto an extra-guide channel fills its lane", async () => {
    httpGetBytes.mockImplementation(async () =>
      bytes(guide(Date.now(), [["only.extra", "Only Extra", "Mapped Show"]])),
    );
    saveGuideFix("A", "A:3", "only.extra");
    const { data } = await load();
    expect(title(data, "A:3")).toBe("Mapped Show");
  });
});

describe("an extra guide that gives nothing never costs the provider's guide", () => {
  it("a download that fails: the provider's guide whole, a note of its own, no address in it", async () => {
    httpGetBytes.mockRejectedValue(new Error(`connect failed for url (${EXTRA})`));
    const { data } = await load();
    expect(title(data, "A:1")).toBe("Provider One");
    expect(title(data, "A:4")).toBe("Provider Four");
    expect(group(data, "A").epgError).toBeUndefined();
    const note = group(data, "A").extraGuideError;
    expect(note).toMatch(/^download failed/);
    expect(note).not.toContain("SECRETTOKEN123");
    expect(note).not.toContain("guide.xml");
    // The provider's guide landed, so it is stamped; the note is what keeps
    // it from being reused (below).
    expect(group(data, "A").guideAt).toBe(T);
  });

  it("a download that fails this time keeps the lanes the extra guide filled last time", async () => {
    const m = await import("./source");
    await m.refreshLiveNow();
    expect(title(m.lookupLive()!, "A:2")).toBe("Extra Two");
    httpGetBytes.mockRejectedValue(new Error("timed out"));
    await m.refreshLiveNow();
    const d = m.lookupLive()!;
    expect(title(d, "A:2")).toBe("Extra Two");
    expect(title(d, "A:1")).toBe("Provider One");
    expect(group(d, "A").extraGuideError).toMatch(/^download failed/);
  });

  it("but not across a new address: the old one's fills are not the new one's", async () => {
    const m = await import("./source");
    await m.refreshLiveNow();
    expect(title(m.lookupLive()!, "A:2")).toBe("Extra Two");
    httpGetBytes.mockRejectedValue(new Error("HTTP 500"));
    playlists = [xtream("A", { extraGuide: "https://other.example/broken.xml" })];
    await m.refreshLiveNow();
    const d = m.lookupLive()!;
    expect(d.programmes.get("A:2")).toBeUndefined();
    expect(title(d, "A:1")).toBe("Provider One");
    expect(group(d, "A").extraGuideError).toMatch(/^download failed/);
  });

  it("but a guide that came and matched none of them does not: what it filled before is not true of it", async () => {
    const m = await import("./source");
    await m.refreshLiveNow();
    expect(title(m.lookupLive()!, "A:2")).toBe("Extra Two");
    httpGetBytes.mockImplementation(async () => bytes(guide(Date.now(), [["unrelated", "Unrelated", "Elsewhere"]])));
    await m.refreshLiveNow();
    expect(m.lookupLive()!.programmes.get("A:2")).toBeUndefined();
  });

  it("a guide that matches none of the empty channels says so", async () => {
    httpGetBytes.mockImplementation(async () =>
      bytes(guide(Date.now(), [["unrelated", "Unrelated", "Elsewhere"]])),
    );
    const { data } = await load();
    expect(group(data, "A").extraGuideError).toMatch(/matched none of the empty channels/);
    expect(title(data, "A:1")).toBe("Provider One");
  });

  it("when the provider's guide fails too, the extra one still fills what it can, and both are said", async () => {
    fetchXmltv.mockRejectedValue(new Error("timed out"));
    const { data } = await load();
    expect(title(data, "A:2")).toBe("Extra Two");
    expect(title(data, "A:4")).toBe("Extra Four");
    expect(group(data, "A").epgError).toMatch(/guide download failed/);
    expect(group(data, "A").extraGuideError).toBeUndefined();
  });

  it("a provider guide that fails keeps the one it had, and the extra guide fills only what is still empty", async () => {
    const m = await import("./source");
    await m.refreshLiveNow();
    expect(title(m.lookupLive()!, "A:1")).toBe("Provider One");
    // The next refresh: the provider's guide does not come. What it had
    // stands; the extra guide, which now offers One, does not replace it.
    fetchXmltv.mockRejectedValue(new Error("timed out"));
    httpGetBytes.mockImplementation(async () =>
      bytes(guide(Date.now(), [["one.epg", "One", "Extra One"], ["three.epg", "Three", "Extra Three"]])),
    );
    await m.refreshLiveNow();
    const d = m.lookupLive()!;
    expect(title(d, "A:1")).toBe("Provider One");
    expect(title(d, "A:3")).toBe("Extra Three");
    expect(group(d, "A").epgError).toMatch(/guide download failed/);
  });
});

describe("an M3U playlist's extra guide, and its User-Agent", () => {
  beforeEach(() => {
    playlists = [m3u("M", { extraGuide: EXTRA, userAgent: AGENT })];
    httpGetBytes.mockImplementation(async (url: string) =>
      url.startsWith("http://epg.example")
        ? bytes(guide(Date.now(), [["one.epg", "One", "Declared One"]]))
        : bytes(guide(Date.now(), [["two.epg", "Two", "Extra Two"], ["one.epg", "One", "Extra One"]])),
    );
  });

  it("fills the gap by tvg-id and keeps what the declared guide gave", async () => {
    const { data } = await load();
    expect(title(data, "M:one.epg")).toBe("Declared One");
    expect(title(data, "M:two.epg")).toBe("Extra Two");
    expect(data.programmes.get("M:three.epg")).toBeUndefined();
  });

  it("sends the agent with the playlist, the declared guide and the extra one", async () => {
    await load();
    expect(httpGetText).toHaveBeenCalledWith("http://host/playlist.m3u", { "User-Agent": AGENT });
    expect(httpGetBytes).toHaveBeenCalledWith("http://epg.example/guide.xml", { "User-Agent": AGENT }, 180);
    expect(httpGetBytes).toHaveBeenCalledWith(EXTRA, { "User-Agent": AGENT }, 180);
  });

  it("asks without headers when there is no agent", async () => {
    playlists = [m3u("M", { extraGuide: EXTRA })];
    await load();
    expect(httpGetText).toHaveBeenCalledWith("http://host/playlist.m3u", undefined);
    expect(httpGetBytes).toHaveBeenCalledWith("http://epg.example/guide.xml", undefined, 180);
    expect(httpGetBytes).toHaveBeenCalledWith(EXTRA, undefined, 180);
  });

  it("is the guide of a playlist that declares none", async () => {
    httpGetText.mockResolvedValue(
      ["#EXTM3U", '#EXTINF:-1 tvg-id="two.epg" group-title="UK",Two', "http://host/live/2.ts"].join("\n"),
    );
    const { data } = await load();
    expect(title(data, "M:two.epg")).toBe("Extra Two");
    // The provider's note stands: the playlist declares no guide of its own.
    expect(group(data, "M").epgError).toMatch(/declares no guide/);
  });
});

describe("a Stalker portal's extra guide is matched by xmltv_id", () => {
  beforeEach(() => {
    playlists = [stalker("S", { extraGuide: EXTRA })];
    httpGetBytes.mockImplementation(async () =>
      bytes(
        guide(Date.now(), [
          ["s1.xml", "Stal One", "Extra Stal One"],
          ["s2.xml", "Stal Two", "Extra Stal Two"],
        ]),
      ),
    );
  });

  it("fills the channel the portal's guide has nothing for, and keeps the portal's own", async () => {
    const { data } = await load();
    expect(title(data, "S:101")).toBe("Portal One");
    expect(title(data, "S:102")).toBe("Extra Stal Two");
    // No xmltv_id, nothing to match by.
    expect(data.programmes.get("S:103")).toBeUndefined();
    expect(group(data, "S").extraGuideError).toBeUndefined();
  });

  it("carries the id on the channel only when there is an extra guide to match it against", async () => {
    const { data } = await load();
    expect(data.channels.find((c) => c.id === "S:102")?.epgId).toBe("s2.xml");
    playlists = [stalker("S")];
    const again = await load();
    expect(again.data.channels.find((c) => c.id === "S:102")?.epgId).toBeUndefined();
    expect(Object.keys(again.data.channels[0]).sort()).not.toContain("epgId");
  });

  it("offers the Fix guide dialog the extra guide's channels, which a portal had none of", async () => {
    const { data } = await load();
    expect(group(data, "S").guideChannels?.map((c) => c.id)).toEqual(["s1.xml", "s2.xml"]);
  });

  it("stamps the guide with the hand fixes it was matched with, so a later fix is seen", async () => {
    saveGuideFix("S", "S:103", "s2.xml");
    const { data } = await load();
    expect(title(data, "S:103")).toBe("Extra Stal Two");
    expect(group(data, "S").guideFixKey).toBe(fixKey({ "S:103": "s2.xml" }));
  });

  it("does not hold a portal's guide back for fixes its own guide never reads", async () => {
    // Left from when it had an extra guide; it has none now.
    saveGuideFix("S", "S:103", "s2.xml");
    playlists = [stalker("S")];
    disk = { at: T - HOUR, data: snapshot("S", { guideAt: T - HOUR }), normalized: true };
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.channels[0]?.name === "Stal One");
    await delay(null, 50);
    expect(fetchEpg).not.toHaveBeenCalled();
    expect(group(m.lookupLive()!, "S").guideAt).toBe(T - HOUR);
  });

  it("holds it back for them while it has an extra guide: a fix saved since is not in the guide it has", async () => {
    saveGuideFix("S", "S:103", "s2.xml");
    disk = { at: T - HOUR, data: snapshot("S", { guideAt: T - HOUR }), normalized: true };
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => fetchEpg.mock.calls.length > 0);
    expect(fetchEpg).toHaveBeenCalledTimes(1);
  });
});

describe("the reuse key covers the extra guide and the agent", () => {
  it("a guide built before the extra one was set is not reused for it", async () => {
    playlists = [xtream("A")];
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.programmes.size);
    expect(fetchXmltv).toHaveBeenCalledTimes(1);
    // Set now, inside the guide's twelve hours: not this config's guide.
    playlists = [xtream("A", { extraGuide: EXTRA })];
    await m.loadLive(new Date());
    await until(() => httpGetBytes.mock.calls.length > 0);
    expect(fetchXmltv).toHaveBeenCalledTimes(2);
    expect(httpGetBytes).toHaveBeenCalledTimes(1);
  });

  it("nor one built from another address", async () => {
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.programmes.size && httpGetBytes.mock.calls.length > 0);
    playlists = [xtream("A", { extraGuide: "https://other.example/guide.xml" })];
    await m.loadLive(new Date());
    await until(() => httpGetBytes.mock.calls.length > 1);
    expect(httpGetBytes.mock.calls.map((c) => c[0])).toEqual([EXTRA, "https://other.example/guide.xml"]);
  });

  it("nor one built with another agent", async () => {
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => httpGetBytes.mock.calls.length > 0);
    playlists = [xtream("A", { extraGuide: EXTRA, userAgent: AGENT })];
    await m.loadLive(new Date());
    await until(() => httpGetBytes.mock.calls.length > 1);
    expect(httpGetBytes.mock.calls[1][1]).toEqual({ "User-Agent": AGENT });
  });

  it("the same config is the same key: a second load is the cache's", async () => {
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.programmes.size && httpGetBytes.mock.calls.length > 0);
    await m.loadLive(new Date());
    await delay(null, 50);
    expect(fetchXmltv).toHaveBeenCalledTimes(1);
    expect(httpGetBytes).toHaveBeenCalledTimes(1);
  });

  it("a playlist with neither keeps the key it always had, so a record from before still hits", async () => {
    playlists = [xtream("A"), m3u("M"), stalker("S")];
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => diskPut.mock.calls.length || m.lookupLive()?.programmes.size);
    await delay(null, 1600); // scheduleDiskPut's 1.5s
    const key = (diskPut.mock.calls.at(-1)?.[0] as { key: string }).key;
    expect(key).toBe(
      JSON.stringify([
        [
          ["A", "http://tv.example.com", "u", "p", []],
          ["M", "http://host/playlist.m3u", []],
          ["S", "http://portal.example", "00:1A:79:AA:BB:CC", []],
        ],
        false,
      ]),
    );
  });

  it("a guide that carries only an extra-guide note is still reused: a broken extra address must not cost the provider's whole guide every launch", async () => {
    playlists = [xtream("A", { extraGuide: EXTRA })];
    disk = { at: T - HOUR, data: snapshot("A", { guideAt: T - HOUR }), normalized: true };
    let m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.channels[0]?.name === "One");
    await delay(null, 50);
    // Without the note the guide is reused, extra guide and all.
    expect(fetchXmltv).not.toHaveBeenCalled();
    expect(httpGetBytes).not.toHaveBeenCalled();

    vi.resetModules();
    vi.clearAllMocks();
    disk = {
      at: T - HOUR,
      data: snapshot("A", { guideAt: T - HOUR, extraGuideError: "download failed: timed out" }),
      normalized: true,
    };
    m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.channels[0]?.name === "One");
    await delay(null, 50);
    expect(fetchXmltv).not.toHaveBeenCalled();
    expect(httpGetBytes).not.toHaveBeenCalled();

    // The provider's own failure still is a reason, as it always was.
    vi.resetModules();
    vi.clearAllMocks();
    disk = {
      at: T - HOUR,
      data: snapshot("A", { guideAt: T - HOUR, epgError: "guide download failed: timed out" }),
      normalized: true,
    };
    m = await import("./source");
    await m.loadLive(new Date());
    await until(() => fetchXmltv.mock.calls.length > 0);
    expect(fetchXmltv).toHaveBeenCalledTimes(1);
  });
});

describe("a source with no guide of its own reuses the extra guide that is its only one", () => {
  // An M3U with no url-tvg, and a portal whose get_epg_info comes back empty:
  // nothing to download from the provider, so the extra guide is all the guide
  // the source has, and it is reused for GUIDE_REFRESH_MS like any other.
  const NONE = ["#EXTM3U", '#EXTINF:-1 tvg-id="two.epg" group-title="UK",Two', "http://host/live/2.ts"].join("\n");

  /** The first load of a session, once the guide has landed and been stamped. */
  async function stamped(id: string) {
    const m = await import("./source");
    await m.loadLive(new Date());
    await until(() => m.lookupLive()?.groups.find((g) => g.id === id)?.guideAt);
    for (const f of [httpGetBytes, httpGetText, fetchXmltv, fetchEpg, fetchChannels]) f.mockClear();
    return m;
  }
  /** The next load, `after` ms on: the memory cache has aged out, and it
   * resolves once that load's guide phase has replaced the catalog. */
  async function remount(m: Awaited<ReturnType<typeof stamped>>, after: number) {
    const before = m.lookupLive();
    vi.setSystemTime(T + after);
    await m.loadLive(new Date());
    await until(() => m.lookupLive() !== before);
  }

  describe("an M3U with no url-tvg", () => {
    beforeEach(() => {
      playlists = [m3u("M", { extraGuide: EXTRA })];
      httpGetText.mockResolvedValue(NONE);
    });

    it("is stamped when its extra guide fills a channel, and keeps the note that it declares none", async () => {
      const m = await stamped("M");
      const g = group(m.lookupLive()!, "M");
      expect(g.guideAt).toBe(T);
      expect(g.epgError).toMatch(/declares no guide/);
      expect(title(m.lookupLive()!, "M:two.epg")).toBe("Extra Two");
    });

    it("a second load inside twelve hours does not fetch the extra guide, and keeps what it filled", async () => {
      const m = await stamped("M");
      await remount(m, 31 * MIN);
      expect(httpGetText).toHaveBeenCalledTimes(1);
      expect(httpGetBytes).not.toHaveBeenCalled();
      const d = m.lookupLive()!;
      expect(title(d, "M:two.epg")).toBe("Extra Two");
      expect(group(d, "M").guideAt).toBe(T);
    });

    it("past twelve hours it fetches the extra guide again and renews the stamp", async () => {
      const m = await stamped("M");
      await remount(m, 13 * HOUR);
      await until(() => group(m.lookupLive()!, "M").guideAt === T + 13 * HOUR);
      expect(httpGetBytes).toHaveBeenCalledTimes(1);
      expect(httpGetBytes).toHaveBeenCalledWith(EXTRA, undefined, 180);
    });

    it("the note reads the same after a reused load as after the load that made the guide", async () => {
      // Three hours of schedule, so it still covers now at the second remount.
      httpGetBytes.mockImplementation(async () => bytes(guide(Date.now(), [["two.epg", "Two", "Extra Two"]], 3 * HOUR)));
      const m = await stamped("M");
      const first = group(m.lookupLive()!, "M");
      await remount(m, 31 * MIN);
      const again = group(m.lookupLive()!, "M");
      expect(again.epgError).toBe(first.epgError);
      expect(again.extraGuideError).toBe(first.extraGuideError);
      // And once more: carried from a reused load, not only from a fresh one.
      await remount(m, 62 * MIN);
      expect(group(m.lookupLive()!, "M").epgError).toBe(first.epgError);
      expect(httpGetBytes).not.toHaveBeenCalled();
    });

    it("a relaunch from the disk record reuses it too", async () => {
      const m = await stamped("M");
      disk = { at: Date.now(), data: m.lookupLive()!, normalized: true };
      vi.resetModules();
      vi.setSystemTime(T + 40 * MIN);
      const next = await import("./source");
      const hydrated = await next.loadLive(new Date());
      // The revalidation behind the hydrate has settled once it replaces it.
      await until(() => next.lookupLive() !== hydrated);
      expect(httpGetText).toHaveBeenCalledTimes(1);
      expect(httpGetBytes).not.toHaveBeenCalled();
      const d = next.lookupLive()!;
      expect(title(d, "M:two.epg")).toBe("Extra Two");
      expect(group(d, "M").guideAt).toBe(T);
      expect(group(d, "M").epgError).toMatch(/declares no guide/);
    });

    it("a hand fix saved since is not left out: the guide is fetched again", async () => {
      const m = await stamped("M");
      saveGuideFix("M", "M:two.epg", "four.epg");
      await remount(m, 31 * MIN);
      expect(httpGetBytes).toHaveBeenCalledTimes(1);
    });

    it("a fix the guide was matched with is part of the stamp, so the same fixes still reuse it", async () => {
      saveGuideFix("M", "M:two.epg", "four.epg");
      const m = await stamped("M");
      expect(group(m.lookupLive()!, "M").guideFixKey).toBe(fixKey({ "M:two.epg": "four.epg" }));
      await remount(m, 31 * MIN);
      expect(httpGetBytes).not.toHaveBeenCalled();
    });

    it("an extra guide that gave nothing leaves it unstamped, so the next load asks again", async () => {
      httpGetBytes.mockRejectedValue(new Error("timed out"));
      const m = await import("./source");
      await m.loadLive(new Date());
      await until(() => group(m.lookupLive()!, "M").extraGuideError);
      expect(group(m.lookupLive()!, "M").guideAt).toBeUndefined();
      httpGetBytes.mockClear();
      vi.setSystemTime(T + 31 * MIN);
      await m.loadLive(new Date());
      await until(() => httpGetBytes.mock.calls.length > 0);
      expect(httpGetBytes).toHaveBeenCalledWith(EXTRA, undefined, 180);
    });
  });

  describe("a provider's own guide that fails is still tried again by the next load", () => {
    it("an M3U whose declared guide does not download, the extra guide filling meanwhile", async () => {
      playlists = [m3u("M", { extraGuide: EXTRA })];
      httpGetBytes.mockImplementation(async (url: string) => {
        if (url.startsWith("http://epg.example")) throw new Error("timed out");
        return bytes(guide(Date.now(), [["two.epg", "Two", "Extra Two"]]));
      });
      const m = await import("./source");
      await m.loadLive(new Date());
      await until(() => group(m.lookupLive()!, "M").epgError);
      expect(group(m.lookupLive()!, "M").epgError).toMatch(/guide download failed/);
      expect(title(m.lookupLive()!, "M:two.epg")).toBe("Extra Two");
      expect(group(m.lookupLive()!, "M").guideAt).toBeUndefined();
      httpGetBytes.mockClear();
      vi.setSystemTime(T + 31 * MIN);
      await m.loadLive(new Date());
      await until(() => httpGetBytes.mock.calls.length >= 2);
      expect(httpGetBytes.mock.calls.map((c) => c[0])).toEqual(["http://epg.example/guide.xml", EXTRA]);
    });

    it("a portal whose get_epg_info fails", async () => {
      playlists = [stalker("S", { extraGuide: EXTRA })];
      fetchEpg.mockRejectedValue(new Error("timed out"));
      httpGetBytes.mockImplementation(async () =>
        bytes(guide(Date.now(), [["s2.xml", "Stal Two", "Extra Stal Two"]])),
      );
      const m = await import("./source");
      await m.loadLive(new Date());
      await until(() => group(m.lookupLive()!, "S").epgError);
      expect(group(m.lookupLive()!, "S").epgError).toMatch(/guide download failed/);
      expect(group(m.lookupLive()!, "S").guideAt).toBeUndefined();
      fetchEpg.mockClear();
      vi.setSystemTime(T + 31 * MIN);
      await m.loadLive(new Date());
      await until(() => fetchEpg.mock.calls.length > 0);
      expect(fetchEpg).toHaveBeenCalledTimes(1);
    });
  });

  describe("a Stalker portal with no guide of its own", () => {
    beforeEach(() => {
      playlists = [stalker("S", { extraGuide: EXTRA })];
      fetchEpg.mockResolvedValue(new Map());
      httpGetBytes.mockImplementation(async () =>
        bytes(
          guide(Date.now(), [
            ["s1.xml", "Stal One", "Extra Stal One"],
            ["s2.xml", "Stal Two", "Extra Stal Two"],
          ]),
        ),
      );
    });

    it("is stamped when its extra guide fills a channel, and keeps the portal's note", async () => {
      const m = await stamped("S");
      const g = group(m.lookupLive()!, "S");
      expect(g.guideAt).toBe(T);
      expect(g.epgError).toMatch(/returned no guide data/);
      expect(title(m.lookupLive()!, "S:101")).toBe("Extra Stal One");
    });

    it("a second load inside twelve hours asks neither the portal nor the extra guide, and keeps the fills", async () => {
      const m = await stamped("S");
      await remount(m, 31 * MIN);
      expect(fetchChannels).toHaveBeenCalledTimes(1);
      expect(fetchEpg).not.toHaveBeenCalled();
      expect(httpGetBytes).not.toHaveBeenCalled();
      const d = m.lookupLive()!;
      expect(title(d, "S:102")).toBe("Extra Stal Two");
      expect(group(d, "S").epgError).toMatch(/returned no guide data/);
    });

    it("past twelve hours it asks for both again", async () => {
      const m = await stamped("S");
      await remount(m, 13 * HOUR);
      await until(() => group(m.lookupLive()!, "S").guideAt === T + 13 * HOUR);
      expect(fetchEpg).toHaveBeenCalledTimes(1);
      expect(httpGetBytes).toHaveBeenCalledTimes(1);
    });
  });

  describe("an extra guide's note on a source that has a guide of its own", () => {
    it("reads the same after a reused load as after the load that produced it", async () => {
      playlists = [xtream("A", { extraGuide: EXTRA })];
      httpGetBytes.mockRejectedValue(new Error("connect failed"));
      const m = await stamped("A");
      const first = group(m.lookupLive()!, "A").extraGuideError;
      expect(first).toMatch(/^download failed/);
      await remount(m, 31 * MIN);
      // Reused: neither guide was asked, and Settings → Sources still says why
      // the extra one gave nothing, for as long as it is not asked again.
      expect(fetchXmltv).not.toHaveBeenCalled();
      expect(httpGetBytes).not.toHaveBeenCalled();
      expect(group(m.lookupLive()!, "A").extraGuideError).toBe(first);
      expect(group(m.lookupLive()!, "A").guideAt).toBe(T);
    });

    it("and is gone when the extra guide is asked again and gives something", async () => {
      playlists = [xtream("A", { extraGuide: EXTRA })];
      httpGetBytes.mockRejectedValue(new Error("connect failed"));
      const m = await stamped("A");
      httpGetBytes.mockImplementation(async () => bytes(guide(Date.now(), [["two.epg", "Two", "Extra Two"]])));
      await remount(m, 13 * HOUR);
      await until(() => group(m.lookupLive()!, "A").guideAt === T + 13 * HOUR);
      expect(group(m.lookupLive()!, "A").extraGuideError).toBeUndefined();
    });
  });
});

describe("changing the extra guide or the agent does not blank the lanes while the guide reloads", () => {
  it("the provider's programmes are carried across a forced load whose only change is the Advanced fields", async () => {
    playlists = [xtream("A")];
    const m = await import("./source");
    await m.refreshLiveNow();
    expect(title(m.lookupLive()!, "A:1")).toBe("Provider One");
    // The new config's guide never lands in this test.
    fetchXmltv.mockImplementation(() => new Promise(() => {}));
    playlists = [xtream("A", { extraGuide: EXTRA, userAgent: AGENT })];
    const half = await m.loadLive(new Date(), undefined, true);
    expect(title(half, "A:1")).toBe("Provider One");
  });
});
