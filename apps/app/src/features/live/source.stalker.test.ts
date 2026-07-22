import { beforeEach, describe, expect, it, vi } from "vitest";

// The Stalker branch of loadLive end-to-end: a saved Stalker playlist + a
// mocked httpGetJson playing portal, with disk/adult stubbed. Asserts the
// handshake → genres → channels → EPG pipeline lands in the standard
// LiveData shape (streamCmd carried, adult drops, EPG clamped + namespaced).

const httpGetJson = vi.fn();
vi.mock("../../lib/http", () => ({
  httpGetJson: (...a: unknown[]) => httpGetJson(...a),
  httpGetText: vi.fn(),
}));
vi.mock("./diskCache", () => ({
  diskGet: vi.fn().mockResolvedValue(null),
  diskPut: vi.fn().mockResolvedValue(undefined),
}));
let showAdult = false;
vi.mock("../settings/adultFilter", () => ({
  loadShowAdult: () => showAdult,
}));
vi.mock("../settings/playlists", async (importOriginal) => ({
  ...(await importOriginal<object>()),
  loadPlaylists: () => [
    {
      kind: "stalker",
      id: "s1",
      name: "My Portal",
      enabled: true,
      portal: "http://portal.example",
      mac: "00:1A:79:AA:BB:CC",
    },
  ],
}));

const NOW = new Date("2026-07-09T20:00:00Z");
const sec = (d: Date, offsetS: number) => Math.floor(d.getTime() / 1000) + offsetS;

function installPortal() {
  httpGetJson.mockImplementation((rawUrl: unknown, rawHeaders?: unknown) => {
    const url = new URL(String(rawUrl));
    const headers = (rawHeaders ?? {}) as Record<string, string>;
    const action = url.searchParams.get("action") ?? "";
    if (url.pathname !== "/portal.php") return Promise.reject(new Error("404"));
    if (action === "handshake")
      return Promise.resolve({ js: { token: "T", random: "r" } });
    if (headers.Authorization !== "Bearer T")
      return Promise.resolve({ js: { error: "Authorization failed" } });
    switch (action) {
      case "get_profile":
        return Promise.resolve({ js: { id: 1, blocked: "0" } });
      case "get_genres":
        return Promise.resolve({
          js: [
            { id: "*", title: "All" },
            { id: "1", title: "News" },
            { id: "2", title: "XXX After Dark" }, // adult by NAME
          ],
        });
      case "get_all_channels":
        return Promise.resolve({
          js: {
            data: [
              { id: 101, name: "News One", number: 7, cmd: "ffconc http://p/ch/101", tv_genre_id: "1", censored: 0 },
              { id: 102, name: "Sneaky Flagged", cmd: "ffconc http://p/ch/102", tv_genre_id: "1", censored: 1 },
              { id: 103, name: "Night Feature", cmd: "ffconc http://p/ch/103", tv_genre_id: "2", censored: 0 },
            ],
          },
        });
      case "get_epg_info":
        return Promise.resolve({
          js: {
            "101": [
              // airing now
              { name: "The Brief", descr: "News now.", start_timestamp: sec(NOW, -1800), stop_timestamp: sec(NOW, 1800) },
              // far outside the −1h..+12h window — must be clamped away
              { name: "Ancient Rerun", start_timestamp: sec(NOW, -90000), stop_timestamp: sec(NOW, -86400) },
            ],
            "103": [
              { name: "Hidden Listing", start_timestamp: sec(NOW, 0), stop_timestamp: sec(NOW, 3600) },
            ],
          },
        });
      default:
        return Promise.reject(new Error(`unexpected action ${action}`));
    }
  });
}

describe("loadLive Stalker path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    showAdult = false;
    installPortal();
  });

  it("maps genres/channels/EPG and drops adult content on both axes", async () => {
    const { loadLive } = await import("./source");
    const data = await loadLive(NOW);
    // The name-adult genre is gone; only News remains as a folder.
    expect(data.groups[0].folders).toEqual([{ id: "s1:1", name: "News" }]);
    expect(data.groups[0].error).toBeUndefined();
    // censored channel (102) and adult-genre channel (103) both dropped.
    expect(data.channels.map((c) => c.id)).toEqual(["s1:101"]);
    const ch = data.channels[0];
    expect(ch).toMatchObject({
      name: "News One",
      number: 7,
      folderId: "s1:1",
      streamCmd: "ffconc http://p/ch/101",
    });
    // EPG: namespaced key, window-clamped (the ancient rerun is gone), and
    // no listings for dropped channels.
    const progs = data.programmes.get("s1:101")!;
    expect(progs.map((p) => p.title)).toEqual(["The Brief"]);
    expect(data.programmes.has("s1:103")).toBe(false);
  });

  it("keeps adult genres and censored channels when the filter is off", async () => {
    showAdult = true;
    const { loadLive } = await import("./source");
    const data = await loadLive(NOW);
    expect(data.groups[0].folders.map((f) => f.name)).toContain("XXX After Dark");
    expect(data.channels.map((c) => c.id).sort()).toEqual([
      "s1:101",
      "s1:102",
      "s1:103",
    ]);
  });

  it("surfaces a portal failure as the group error without sinking the load", async () => {
    httpGetJson.mockRejectedValue(new Error("connect refused http://portal.example/portal.php?secret=1"));
    const { loadLive } = await import("./source");
    const data = await loadLive(NOW);
    expect(data.groups[0].error).toBeTruthy();
    // The URL is scrubbed to its origin — no query material leaks.
    expect(data.groups[0].error).not.toContain("secret");
    expect(data.channels).toEqual([]);
  });
});
