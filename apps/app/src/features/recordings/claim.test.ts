import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { RecRecord } from "../../lib/tauri";

const MIN = 60_000;
let list: RecRecord[] = [];
let playlists: unknown[] = [];
const stopRecording = vi.fn((_id: string): Promise<unknown> => Promise.resolve({}));
const fetchConnections = vi.fn((_p: unknown): Promise<unknown> => Promise.resolve(null));
const startRecording = vi.fn((_a: unknown) => Promise.resolve("s1"));
const tauriRecScheduleFail = vi.fn((_id: string, _why: string) => Promise.resolve());
const lookupLive = vi.fn((): unknown => null);
const loadLive = vi.fn((_now: Date): Promise<unknown> => Promise.resolve({ channels: [] }));
const resolveStreamUrl = vi.fn((_c: unknown): Promise<string | null> => Promise.resolve(null));
const streamUserAgent = vi.fn((_id: string): string | undefined => undefined);

vi.mock("./store", () => ({
  listNow: () => list,
  startRecording: (a: unknown) => startRecording(a),
  stopRecording: (id: string) => stopRecording(id),
}));
vi.mock("../../data/xtream", () => ({ fetchConnections: (p: unknown) => fetchConnections(p) }));
vi.mock("../settings/playlists", () => ({ loadPlaylists: () => playlists }));
vi.mock("../../lib/tauri", () => ({
  tauriRecScheduleFail: (id: string, why: string) => tauriRecScheduleFail(id, why),
}));
vi.mock("../live/source", () => ({
  lookupLive: () => lookupLive(),
  loadLive: (n: Date) => loadLive(n),
}));
vi.mock("../live/stream", () => ({
  resolveStreamUrl: (c: unknown) => resolveStreamUrl(c),
  streamUserAgent: (id: string) => streamUserAgent(id),
}));
vi.mock("../settings/recordingsFolder", () => ({ loadRecordingsFolder: () => "D:\\TV" }));

const due = (o: Partial<RecRecord> = {}): RecRecord => ({
  id: "s1",
  channel: "BBC One",
  programme: "News",
  playlistId: "p1",
  startedAt: 5000,
  endedAt: null,
  path: "",
  bytes: 0,
  status: "scheduled",
  reason: null,
  buffer: false,
  channelId: "p1:7",
  startAt: 4000,
  stopAt: 9000,
  due: true,
  ...o,
});

const channel = { id: "p1:7", name: "BBC One" };

beforeEach(() => {
  list = [];
  playlists = [];
  startRecording.mockClear();
  startRecording.mockImplementation(() => Promise.resolve("s1"));
  tauriRecScheduleFail.mockClear();
  lookupLive.mockReset().mockReturnValue({ channels: [channel] });
  loadLive.mockClear();
  resolveStreamUrl.mockReset().mockResolvedValue("http://x/live/u/p/7.ts");
  streamUserAgent.mockReset().mockReturnValue("Agent/1.0");
});

const claim = async (r: RecRecord) => {
  vi.resetModules();
  const m = await import("./claim");
  await m.claimDue(r);
};

describe("a scheduled start that has come (plan 029, Phase 3)", () => {
  it("finds the channel's link and starts it as Record does, in the scheduled record's place", async () => {
    await claim(due());
    expect(resolveStreamUrl).toHaveBeenCalledWith(channel);
    expect(streamUserAgent).toHaveBeenCalledWith("p1:7");
    expect(startRecording).toHaveBeenCalledWith({
      url: "http://x/live/u/p/7.ts",
      userAgent: "Agent/1.0",
      channel: "BBC One",
      programme: "News",
      playlistId: "p1",
      folder: "D:\\TV",
      scheduleId: "s1",
    });
    expect(tauriRecScheduleFail).not.toHaveBeenCalled();
  });

  it("loads the catalog when none is cached", async () => {
    lookupLive.mockReturnValue(null);
    loadLive.mockResolvedValue({ channels: [channel] });
    await claim(due());
    expect(loadLive).toHaveBeenCalledTimes(1);
    expect(startRecording).toHaveBeenCalledTimes(1);
  });

  it("fails the record, saying why, when the channel is gone from the playlist", async () => {
    lookupLive.mockReturnValue({ channels: [{ id: "p1:8", name: "ITV" }] });
    await claim(due());
    expect(startRecording).not.toHaveBeenCalled();
    expect(tauriRecScheduleFail).toHaveBeenCalledWith("s1", "the channel is no longer in the playlist");
  });

  it("fails the record when there is no link for the channel", async () => {
    resolveStreamUrl.mockResolvedValue(null);
    await claim(due());
    expect(startRecording).not.toHaveBeenCalled();
    expect(tauriRecScheduleFail).toHaveBeenCalledWith("s1", "there is no link for this channel");
  });

  it("fails the record when the link cannot be made, without the token in the words", async () => {
    resolveStreamUrl.mockRejectedValue(new Error("create_link failed: http://portal.example/c/?token=SECRET123"));
    await claim(due());
    const [id, why] = tauriRecScheduleFail.mock.calls[0];
    expect(id).toBe("s1");
    expect(why).toContain("create_link failed");
    expect(why).not.toContain("SECRET123");
  });

  it("reports a refused start too, which native leaves alone once it has failed the record itself", async () => {
    startRecording.mockRejectedValue("HTTP 403 from the provider");
    await claim(due());
    expect(tauriRecScheduleFail).toHaveBeenCalledWith("s1", "HTTP 403 from the provider");
  });

  it("starts a record once when it is asked twice at the same time", async () => {
    vi.resetModules();
    const m = await import("./claim");
    await Promise.all([m.claimDue(due()), m.claimDue(due())]);
    expect(startRecording).toHaveBeenCalledTimes(1);
  });
});

describe("a start that comes due while an earlier recording is in its padding", () => {
  const T = new Date("2026-10-30T20:00:00Z").getTime(); // the next programme starts here
  const earlier = (id = "a", o: Partial<RecRecord> = {}): RecRecord => ({
    ...due(),
    id,
    status: "recording",
    startedAt: T - 31 * MIN,
    channelId: undefined,
    due: false,
    stopAt: T + MIN, // its programme ends at T; the minute after is padding
    ...o,
  });
  const next = () => due({ startedAt: T, startAt: T - MIN, stopAt: T + 31 * MIN });
  const order: string[] = [];
  let claimDue: (r: RecRecord) => Promise<void>;

  beforeEach(async () => {
    vi.resetModules();
    ({ claimDue } = await import("./claim"));
    vi.useFakeTimers();
    vi.setSystemTime(T - MIN); // its own padding has begun: the start is due
    order.length = 0;
    playlists = [{ id: "p1", kind: "xtream" }];
    fetchConnections.mockReset().mockResolvedValue({ active: 1, max: 1 });
    stopRecording.mockReset().mockImplementation((id: string) => {
      order.push(`stop ${id}`);
      return Promise.resolve({});
    });
    startRecording.mockImplementation(() => {
      order.push("start");
      return Promise.resolve("s1");
    });
  });
  afterEach(() => vi.useRealTimers());

  it("stops it at its programme's end, and then starts", async () => {
    list = [earlier(), next()];
    const p = claimDue(next());
    // A moment early: the earlier programme is still on, so nothing is stopped.
    await vi.advanceTimersByTimeAsync(MIN - 1);
    expect(order).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    await p;
    expect(order).toEqual(["stop a", "start"]);
  });

  it("leaves it alone when the line has room", async () => {
    list = [earlier(), next()];
    fetchConnections.mockResolvedValue({ active: 1, max: 2 });
    await claimDue(next());
    expect(order).toEqual(["start"]);
  });

  it("leaves it alone when the line reports no limit, or cannot be asked", async () => {
    list = [earlier(), next()];
    fetchConnections.mockResolvedValue(null);
    await claimDue(next());
    fetchConnections.mockRejectedValue(new Error("offline"));
    await claimDue(next());
    playlists = [{ id: "p1", kind: "m3u" }];
    await claimDue(next());
    expect(order).toEqual(["start", "start", "start"]);
  });

  it("asks the panel nothing when no earlier recording is in the way", async () => {
    list = [earlier("long", { stopAt: T + 20 * MIN }), earlier("buffer", { buffer: true }), next()];
    await claimDue(next());
    expect(fetchConnections).not.toHaveBeenCalled();
    expect(order).toEqual(["start"]);
  });

  it("does not stop it when the scheduled record was cancelled while it waited", async () => {
    list = [earlier(), next()];
    const p = claimDue(next());
    await vi.advanceTimersByTimeAsync(10_000);
    list = [earlier()];
    await vi.advanceTimersByTimeAsync(MIN);
    await p;
    expect(order).not.toContain("stop a");
  });
});
