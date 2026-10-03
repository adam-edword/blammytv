import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * The catalog follows the playlists on every screen (audit LV3).
 *
 * Only the Guide used to listen for a playlist change, so on Sports or
 * Multi-view the new key's catalog never loaded and lookupLive() answered
 * null. watchPlaylists is App's listener; these run it with no Guide mounted,
 * and with the Guide's own listener beside it, which must not double the load.
 *
 * vitest's node environment has no window, and announceRefresh and
 * onLiveRefreshed need one, so a bare EventTarget stands in.
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

const xtream = (id: string, password = "p") => ({
  kind: "xtream",
  id,
  name: id,
  enabled: true,
  server: "http://tv.example.com",
  username: "u",
  password,
});
let playlists = [xtream("A")];
const listeners = new Set<() => void>();
vi.mock("../settings/playlists", () => ({
  loadPlaylists: () => playlists,
  onPlaylistsChange: (cb: () => void) => {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
}));
vi.mock("../settings/adultFilter", () => ({ loadShowAdult: () => false }));
vi.mock("./diskCache", () => ({
  diskGet: async () => null,
  diskPut: async () => {},
}));

/** What Settings does after a save: every listener hears it. */
const emit = () => listeners.forEach((cb) => cb());

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  listeners.clear();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-09-24T19:00:00Z"));
  vi.stubGlobal("window", new EventTarget());
  playlists = [xtream("A")];
  authenticate.mockResolvedValue(undefined);
  fetchLiveCategories.mockResolvedValue([]);
  fetchLiveStreams.mockImplementation(async (p: { id: string }) => [
    { stream_id: p.id === "A" ? 1 : 2, name: `ch${p.id}` },
  ]);
  // The guide never lands, so the only announcement is the channels'.
  fetchXmltv.mockImplementation(() => new Promise(() => {}));
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** The app up on a catalog of [A], then B is added in Settings. */
async function addB() {
  const m = await import("./source");
  // The builders yield a macrotask between stages, which a faked clock holds.
  const first = m.loadLive(new Date());
  await vi.advanceTimersByTimeAsync(10);
  await first;
  expect(m.lookupLive()?.channels.length).toBe(1);
  const loaded = authenticate.mock.calls.length;
  playlists = [xtream("A"), xtream("B")];
  return { m, loaded, loadsSince: () => authenticate.mock.calls.length - loaded };
}

describe("a playlist change loads the catalog on any screen (LV3)", () => {
  it("once, with no Guide mounted, and lookupLive answers the new key", async () => {
    const { m, loadsSince } = await addB();
    const stop = m.watchPlaylists();
    let heard: number | undefined;
    let announced = 0;
    m.onLiveRefreshed(() => {
      announced++;
      heard ??= m.peekLive()?.channels.length;
    });
    emit();
    // Nothing yet: Settings saves once per toggle, and a burst settles first.
    expect(m.lookupLive()).toBeNull();
    await vi.advanceTimersByTimeAsync(m.PLAYLIST_SETTLE_MS + 50);
    // One load of the two sources, not a second one.
    expect(loadsSince()).toBe(2);
    expect(m.lookupLive()?.channels.map((c) => c.id)).toEqual(["A:1", "B:2"]);
    // And the readers that follow the announcement are told, with the new
    // catalog already in the cache for them to re-read.
    expect(announced).toBe(1);
    expect(heard).toBe(2);
    stop();
  });

  it("a burst of saves settles into one load", async () => {
    const { m, loadsSince } = await addB();
    const stop = m.watchPlaylists();
    for (let i = 0; i < 4; i++) {
      emit();
      await vi.advanceTimersByTimeAsync(200);
    }
    await vi.advanceTimersByTimeAsync(m.PLAYLIST_SETTLE_MS + 50);
    expect(loadsSince()).toBe(2);
    stop();
  });

  it("the Guide's own listener beside it doesn't double the load", async () => {
    const { m, loadsSince } = await addB();
    const stop = m.watchPlaylists();
    // LiveScreen's: the same wait, then a forced load.
    let screen: Promise<unknown> = Promise.resolve();
    const off = (() => {
      const cb = () => {
        setTimeout(() => {
          screen = m.loadLive(new Date(), undefined, true);
        }, m.PLAYLIST_SETTLE_MS);
      };
      listeners.add(cb);
      return () => listeners.delete(cb);
    })();
    emit();
    await vi.advanceTimersByTimeAsync(m.PLAYLIST_SETTLE_MS + 50);
    await screen;
    expect(loadsSince()).toBe(2); // two sources, one pipeline each, once
    expect(m.lookupLive()?.channels.length).toBe(2);
    off();
    stop();
  });

  it("a change to no enabled source loads nothing", async () => {
    const { m, loadsSince } = await addB();
    playlists = [];
    const stop = m.watchPlaylists();
    emit();
    await vi.advanceTimersByTimeAsync(m.PLAYLIST_SETTLE_MS + 50);
    expect(loadsSince()).toBe(0);
    stop();
  });

  it("a load that finds nothing announces nothing", async () => {
    const { m } = await addB();
    authenticate.mockRejectedValue(new Error("HTTP 503"));
    playlists = [xtream("A", "other"), xtream("B", "other")];
    const stop = m.watchPlaylists();
    let announced = 0;
    m.onLiveRefreshed(() => announced++);
    emit();
    await vi.advanceTimersByTimeAsync(m.PLAYLIST_SETTLE_MS + 50);
    expect(announced).toBe(0);
    stop();
  });

  it("stopping it takes the listener away", async () => {
    const { m, loadsSince } = await addB();
    m.watchPlaylists()();
    expect(listeners.size).toBe(0);
    emit();
    await vi.advanceTimersByTimeAsync(m.PLAYLIST_SETTLE_MS + 50);
    expect(loadsSince()).toBe(0);
  });
});
