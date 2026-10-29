import { beforeEach, describe, expect, it, vi } from "vitest";
import type { RecRecord } from "../../lib/tauri";

const startRecording = vi.fn((_a: unknown) => Promise.resolve("s1"));
const tauriRecScheduleFail = vi.fn((_id: string, _why: string) => Promise.resolve());
const lookupLive = vi.fn((): unknown => null);
const loadLive = vi.fn((_now: Date): Promise<unknown> => Promise.resolve({ channels: [] }));
const resolveStreamUrl = vi.fn((_c: unknown): Promise<string | null> => Promise.resolve(null));
const streamUserAgent = vi.fn((_id: string): string | undefined => undefined);

vi.mock("./store", () => ({ startRecording: (a: unknown) => startRecording(a) }));
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
