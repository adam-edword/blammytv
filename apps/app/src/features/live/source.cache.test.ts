import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LiveData } from "./model";

/**
 * The live cache's clock (v0.9.84, plan 016 item 1.1). Three bugs, one
 * shape: something read the cache while it was stale or while a load for a
 * different config was landing, and got the wrong answer.
 *
 * Xtream is mocked at the data layer, the saved playlists are a mutable
 * list so a test can change the config mid-load, and the disk cache is a
 * one-record fake so the hydrate path runs for real.
 */

const fetchLiveStreams = vi.fn();
const fetchLiveCategories = vi.fn();
const authenticate = vi.fn();
const fetchXmltv = vi.fn();
vi.mock("../../data/xtream", () => ({
  authenticate: (...a: unknown[]) => authenticate(...a),
  fetchLiveCategories: (...a: unknown[]) => fetchLiveCategories(...a),
  fetchLiveStreams: (...a: unknown[]) => fetchLiveStreams(...a),
  fetchXmltv: (...a: unknown[]) => fetchXmltv(...a),
}));

const xtream = (id: string) => ({
  kind: "xtream",
  id,
  name: id,
  enabled: true,
  server: "http://tv.example.com",
  username: "u",
  password: "p",
});
let playlists = [xtream("A")];
vi.mock("../settings/playlists", () => ({ loadPlaylists: () => playlists }));

let disk: { key: string; at: number; data: LiveData } | null = null;
const diskPut = vi.fn();
vi.mock("./diskCache", () => ({
  diskGet: async (key: string) => (disk && disk.key === key ? disk : null),
  diskPut: (r: unknown) => diskPut(r),
}));

const MIN = 60_000;
const delay = <T,>(v: T, ms: number) =>
  new Promise<T>((r) => setTimeout(() => r(v), ms));
const never = () => new Promise<never>(() => {});

/** A snapshot with a guide in it, covering `now`, shaped as disk holds it. */
function snapshot(now: number): LiveData {
  return {
    groups: [{ id: "A", name: "A", folders: [] }],
    channels: [
      { id: "A:1", name: "BBC One", url: "http://x/1.ts", group: "A" } as never,
    ],
    programmes: new Map([
      [
        "A:1",
        [
          {
            title: "News",
            start: new Date(now - 10 * MIN),
            end: new Date(now + 50 * MIN),
          } as never,
        ],
      ],
    ]),
  };
}

/** The disk record's key for the current config, learned the way the app
 * writes it: one real load, then the delayed disk write. */
async function diskKey(): Promise<string> {
  const { loadLive } = await import("./source");
  await loadLive(new Date());
  await delay(null, 1600); // the guide phase, then scheduleDiskPut's 1.5s
  const written = diskPut.mock.calls.at(-1)?.[0] as { key: string } | undefined;
  if (!written) throw new Error("the first load wrote no disk record");
  diskPut.mockClear();
  return written.key;
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-09-24T19:00:00Z"));
  playlists = [xtream("A")];
  disk = null;
  authenticate.mockResolvedValue(undefined);
  fetchLiveCategories.mockImplementation(() => delay([], 5));
  fetchLiveStreams.mockImplementation(() =>
    delay([{ stream_id: 1, name: "BBC One" }], 5),
  );
  fetchXmltv.mockRejectedValue(new Error("no epg in this test"));
});
afterEach(() => vi.useRealTimers());

describe("the live cache's clock", () => {
  it("a channel can still be looked up after the half-hour TTL (F1)", async () => {
    const { loadLive, lookupLive, peekLive } = await import("./source");
    await loadLive(new Date());
    await delay(null, 20); // the guide phase lands
    vi.setSystemTime(Date.now() + 31 * MIN);
    // peekLive is the Live screen's "should I refetch" and says yes...
    expect(peekLive()).toBeNull();
    // ...but a lookup by id, which is what Sports tunes with, still works.
    expect(lookupLive()?.channels.length).toBe(1);
  });

  it("Sports still tunes 31 minutes in (F1, through tunedChannel)", async () => {
    const { loadLive } = await import("./source");
    const { tunedChannel } = await import("../sports/catalog");
    const live = await loadLive(new Date());
    await delay(null, 20);
    const id = live.channels[0].id;
    expect(tunedChannel(id)?.name).toBe("BBC One");
    vi.setSystemTime(Date.now() + 31 * MIN);
    // Every rail click, a game's autoplay and failover go through this.
    // Through peekLive it returned null here, and each of them did nothing.
    expect(tunedChannel(id)?.name).toBe("BBC One");
  });

  it("a hydrated snapshot is current at launch, however old it is (F1)", async () => {
    const key = await diskKey();
    // Relaunch with that record two hours old: well inside the disk window,
    // well past the TTL. Its revalidation stays in the air.
    vi.resetModules();
    disk = { key, at: Date.now() - 120 * MIN, data: snapshot(Date.now()) };
    fetchLiveStreams.mockImplementation(never);
    const { loadLive, peekLive } = await import("./source");
    await loadLive(new Date());
    // The Sports board and a remounted Guide ask peekLive first. Stamped
    // with the snapshot's age, this was null for the whole revalidation.
    expect(peekLive()?.programmes.size).toBe(1);
  });

  it("a stale guide is not downgraded while its reload is in flight (F2)", async () => {
    const key = await diskKey();
    // Relaunch with a guide on disk; the revalidation's XMLTV never lands.
    vi.resetModules();
    disk = { key, at: Date.now(), data: snapshot(Date.now()) };
    fetchXmltv.mockImplementation(never);
    const { loadLive, lookupLive } = await import("./source");
    await loadLive(new Date()); // hydrate, revalidation behind it
    vi.setSystemTime(Date.now() + 31 * MIN); // the snapshot goes stale
    await loadLive(new Date()); // something asks while it reloads
    await delay(null, 30); // the channel phase lands; the guide never does
    // The guide that was already here is still here.
    expect(lookupLive()?.programmes.size).toBe(1);
  });

  it("a guide for a config the user has changed does not land (F3)", async () => {
    const { loadLive, lookupLive } = await import("./source");
    let landA!: (v: string) => void;
    fetchXmltv.mockImplementationOnce(
      () => new Promise<string>((r) => (landA = r)),
    );
    await loadLive(new Date()); // config A: channels in, guide in the air
    // The user changes the config (a second source), and B loads fully.
    playlists = [xtream("A"), xtream("B")];
    await loadLive(new Date(), undefined, true);
    await delay(null, 20);
    expect(lookupLive()?.groups.length).toBe(2);
    // A's guide finally lands.
    landA("<tv></tv>");
    await delay(null, 20);
    // It must not replace B's catalog with A's.
    expect(lookupLive()?.groups.length).toBe(2);
    await delay(null, 1600);
    const keys = diskPut.mock.calls.map((c) => (c[0] as { key: string }).key);
    expect(new Set(keys).size).toBe(1); // only B's record was written
  });
});
