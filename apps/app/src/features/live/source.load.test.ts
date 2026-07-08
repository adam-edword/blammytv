import { beforeEach, describe, expect, it, vi } from "vitest";

// Mock the network layer + saved playlists so loadLive exercises the real
// Xtream path (the single-flight guard) without touching localStorage or HTTP.
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
vi.mock("../settings/playlists", () => ({
  loadPlaylists: () => [
    {
      kind: "xtream",
      id: "pl1",
      name: "Meteor",
      enabled: true,
      server: "http://tv.example.com",
      username: "u",
      password: "p",
    },
  ],
}));

const delay = <T,>(v: T, ms: number) =>
  new Promise<T>((r) => setTimeout(() => r(v), ms));

describe("loadLive single-flight", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    authenticate.mockResolvedValue(undefined);
    fetchLiveCategories.mockImplementation(() => delay([], 20));
    fetchLiveStreams.mockImplementation(() =>
      delay([{ stream_id: 1, name: "BBC One" }], 20),
    );
    fetchXmltv.mockRejectedValue(new Error("no epg in this test"));
  });

  it("concurrent callers share one fetch pipeline and one result", async () => {
    // Fresh module state (cache + inflight are module-level).
    vi.resetModules();
    const { loadLive } = await import("./source");
    const now = new Date();
    const [a, b] = await Promise.all([
      loadLive(now),
      loadLive(now), // fired while the first is in the air (20ms fetches)
    ]);
    expect(a).toBe(b); // identical object, not merely equal
    expect(fetchLiveStreams).toHaveBeenCalledTimes(1);
    expect(authenticate).toHaveBeenCalledTimes(1);
  });

  it("joiners' stage callbacks still hear the narration", async () => {
    vi.resetModules();
    const { loadLive } = await import("./source");
    const now = new Date();
    const heard: string[] = [];
    const first = loadLive(now);
    const second = loadLive(now, (label) => heard.push(label));
    await Promise.all([first, second]);
    expect(heard.length).toBeGreaterThan(0); // fan-in delivered stages
  });

  it("a forced refresh does not join the stale in-flight load", async () => {
    vi.resetModules();
    const { loadLive } = await import("./source");
    const now = new Date();
    const first = loadLive(now);
    const forced = loadLive(now, undefined, true);
    await Promise.all([first, forced]);
    expect(fetchLiveStreams).toHaveBeenCalledTimes(2);
  });
});
