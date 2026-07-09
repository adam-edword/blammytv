import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StalkerPlaylist } from "../features/settings/playlists";

// Exercise the Stalker adapter against an in-mock portal: httpGetJson is
// replaced with a router that enforces the real protocol's auth shape
// (Bearer token from the handshake, Cookie carrying the MAC, MAG UA), so
// these tests cover exactly the header assembly the browser-mode E2E can't
// (fetch refuses to send Cookie).

const httpGetJson = vi.fn();
vi.mock("../lib/http", () => ({
  httpGetJson: (...a: unknown[]) => httpGetJson(...a),
  httpGetText: vi.fn(),
}));

const P: StalkerPlaylist = {
  kind: "stalker",
  id: "s1",
  name: "My Portal",
  enabled: true,
  portal: "http://portal.example",
  mac: "00:1A:79:AA:BB:CC",
};

const TOKEN = "TOK123";
const CHANNELS = [
  {
    id: 101,
    name: "News One",
    number: "7",
    cmd: "ffconc http://portal.example/ch/101",
    tv_genre_id: "1",
    logo: "misc/logos/one.png",
    censored: 0,
  },
  {
    id: 102,
    name: "Late Feature",
    number: "",
    cmd: "ffconc http://portal.example/ch/102",
    tv_genre_id: "3",
    logo: "http://cdn.example/two.png",
    censored: 1,
  },
];

/** A scriptable fake portal living inside the httpGetJson mock. */
function installPortal(opts: { bulk?: boolean } = {}) {
  const bulk = opts.bulk ?? true;
  const calls: Array<{ action: string; headers: Record<string, string> }> = [];
  // Flip on to make the NEXT authed call fail once — a token expiring
  // between calls, the exact case withSession's re-handshake covers.
  const state = { rejectNextAuthed: false };
  httpGetJson.mockImplementation((rawUrl: unknown, rawHeaders?: unknown) => {
    const url = new URL(String(rawUrl));
    const headers = (rawHeaders ?? {}) as Record<string, string>;
    const action = url.searchParams.get("action") ?? "";
    calls.push({ action, headers });
    // Only the documented endpoint path answers — proves the path probe.
    if (url.pathname !== "/portal.php") return Promise.reject(new Error("404"));
    if (url.searchParams.get("JsHttpRequest") !== "1-xml")
      return Promise.reject(new Error("bad transport marker"));
    if (action === "handshake") {
      if (headers.Authorization) throw new Error("handshake must not send auth");
      return Promise.resolve({ js: { token: TOKEN, random: "r" } });
    }
    // The real portals' auth shape, verbatim.
    const authed =
      headers.Authorization === `Bearer ${TOKEN}` &&
      (headers.Cookie ?? "").includes("mac=") &&
      (headers["User-Agent"] ?? "").includes("MAG");
    if (!authed) return Promise.resolve({ js: { error: "Authorization failed" } });
    if (state.rejectNextAuthed) {
      state.rejectNextAuthed = false;
      return Promise.resolve({ js: { error: "Authorization failed" } });
    }
    switch (action) {
      case "get_profile":
        return Promise.resolve({ js: { id: 1, blocked: "0" } });
      case "get_genres":
        return Promise.resolve({
          js: [
            { id: "*", title: "All" },
            { id: "1", title: "News" },
            { id: "3", title: "Adults Only", censored: 1 },
          ],
        });
      case "get_all_channels":
        return Promise.resolve({ js: { data: bulk ? CHANNELS : [] } });
      case "get_ordered_list": {
        const genre = url.searchParams.get("genre");
        const rows = CHANNELS.filter((c) => c.tv_genre_id === genre);
        return Promise.resolve({
          js: { total_items: rows.length, max_page_items: 1, data: [rows[Number(url.searchParams.get("p")) - 1]].filter(Boolean) },
        });
      }
      case "create_link": {
        const cmd = url.searchParams.get("cmd") ?? "";
        const ch = cmd.slice(cmd.lastIndexOf("/") + 1);
        return Promise.resolve({
          js: { cmd: `ffmpeg http://portal.example/live/${ch}.ts?play_token=PT1` },
        });
      }
      default:
        return Promise.reject(new Error(`unexpected action ${action}`));
    }
  });
  return { calls, state };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules(); // fresh module = fresh session cache per test
});

describe("stalker adapter", () => {
  it("probes endpoints, handshakes, and maps genres (dropping the * pseudo-genre)", async () => {
    const { calls } = installPortal();
    const { fetchGenres } = await import("./stalker");
    const genres = await fetchGenres(P);
    expect(genres).toEqual([
      { id: "1", title: "News", censored: false },
      { id: "3", title: "Adults Only", censored: true },
    ]);
    // Handshake happened exactly once, without Authorization; the itv call
    // carried the full MAG identity.
    const handshakes = calls.filter((c) => c.action === "handshake");
    expect(handshakes.filter((c) => c.headers.Authorization)).toHaveLength(0);
    const genresCall = calls.find((c) => c.action === "get_genres");
    expect(genresCall?.headers.Authorization).toBe(`Bearer ${TOKEN}`);
    expect(genresCall?.headers.Cookie).toContain("mac=00%3A1A%3A79%3A");
    expect(genresCall?.headers["X-User-Agent"]).toContain("MAG254");
  });

  it("maps bulk channels: number coercion, relative logo resolution, cmd carried", async () => {
    installPortal();
    const { fetchChannels } = await import("./stalker");
    const chans = await fetchChannels(P, ["1", "3"]);
    expect(chans).toHaveLength(2);
    expect(chans[0]).toMatchObject({
      id: "101",
      name: "News One",
      number: 7,
      cmd: "ffconc http://portal.example/ch/101",
      logo: "http://portal.example/misc/logos/one.png", // relative → portal origin
      censored: false,
    });
    expect(chans[1].number).toBeUndefined(); // number:"" is not a chip
    expect(chans[1].logo).toBe("http://cdn.example/two.png");
    expect(chans[1].censored).toBe(true);
  });

  it("falls back to the paginated per-genre walk when the bulk call is empty", async () => {
    installPortal({ bulk: false });
    const { fetchChannels } = await import("./stalker");
    const chans = await fetchChannels(P, ["1", "3"]);
    expect(chans.map((c) => c.id).sort()).toEqual(["101", "102"]);
  });

  it("createLink strips the solution prefix down to the playable URL", async () => {
    installPortal();
    const { createLink } = await import("./stalker");
    const url = await createLink(P, "ffconc http://portal.example/ch/101");
    expect(url).toBe("http://portal.example/live/101.ts?play_token=PT1");
  });

  it("re-handshakes once and retries when the cached token expires", async () => {
    const { calls, state } = installPortal();
    const { fetchGenres } = await import("./stalker");
    await fetchGenres(P); // opens + caches the session
    const handshakesBefore = calls.filter((c) => c.action === "handshake").length;
    state.rejectNextAuthed = true; // the token "expires" between calls
    const genres = await fetchGenres(P);
    expect(genres.length).toBe(2); // the retry landed
    const handshakesAfter = calls.filter((c) => c.action === "handshake").length;
    expect(handshakesAfter).toBeGreaterThan(handshakesBefore); // re-handshook
  });
});
