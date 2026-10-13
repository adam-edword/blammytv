import { beforeEach, describe, expect, it, vi } from "vitest";
import type { StalkerPlaylist, XtreamPlaylist } from "../features/settings/playlists";

/**
 * A playlist's own User-Agent (plan 025, P5) reaches every request the data
 * layers make for it, as a header, and a playlist without one asks exactly as
 * it always did. lib/http is replaced by a recorder, so what is asserted is
 * the call the data layer makes: native merges a header over its browser
 * defaults (lib.rs http_get), which is why a header is all there is to send.
 */

const httpGetJson = vi.fn();
const httpGetBytes = vi.fn();
vi.mock("../lib/http", () => ({
  httpGetJson: (...a: unknown[]) => httpGetJson(...a),
  httpGetBytes: (...a: unknown[]) => httpGetBytes(...a),
  httpGetText: vi.fn(),
}));

const AGENT = "TestApp/9.1 (Provider Check)";
const MAG = /MAG200 stbapp/;

const X: XtreamPlaylist = {
  kind: "xtream",
  id: "x1",
  name: "Line",
  enabled: true,
  server: "http://panel.example",
  username: "u",
  password: "p",
};

const S: StalkerPlaylist = {
  kind: "stalker",
  id: "s1",
  name: "Portal",
  enabled: true,
  portal: "http://portal.example",
  mac: "00:1A:79:AA:BB:CC",
};

beforeEach(() => {
  // A portal keeps its session in the module: a fresh one for each test.
  vi.resetModules();
  httpGetJson.mockReset();
  httpGetBytes.mockReset();
  httpGetBytes.mockResolvedValue(new ArrayBuffer(0));
});

/** The headers of each call, in order: the second argument of every one. */
const headersOf = (fn: typeof httpGetJson) => fn.mock.calls.map((c) => c[1]);

describe("an Xtream line's requests", () => {
  const answer = (url: unknown) => {
    const action = new URL(String(url)).searchParams.get("action");
    if (!action) return { user_info: { auth: 1, active_cons: 1, max_connections: 3 } };
    return [];
  };

  it("send its User-Agent on sign-in, the categories, the streams and the connection count", async () => {
    httpGetJson.mockImplementation(async (url: unknown) => answer(url));
    const { authenticate, fetchConnections, fetchLiveCategories, fetchLiveStreams } = await import("./xtream");
    const p = { ...X, userAgent: `  ${AGENT} ` };
    await authenticate(p);
    await fetchLiveCategories(p);
    await fetchLiveStreams(p);
    await fetchConnections(p);
    expect(httpGetJson).toHaveBeenCalledTimes(4);
    expect(headersOf(httpGetJson)).toEqual(Array(4).fill({ "User-Agent": AGENT }));
  });

  it("send it with the guide download, beside its three minutes", async () => {
    const { fetchXmltv } = await import("./xtream");
    await fetchXmltv({ ...X, userAgent: AGENT });
    expect(httpGetBytes).toHaveBeenCalledTimes(1);
    expect(httpGetBytes.mock.calls[0][1]).toEqual({ "User-Agent": AGENT });
    expect(httpGetBytes.mock.calls[0][2]).toBe(180);
  });

  it("send no headers at all without one: the calls are the ones they always were", async () => {
    httpGetJson.mockImplementation(async (url: unknown) => answer(url));
    const { authenticate, fetchConnections, fetchLiveCategories, fetchLiveStreams, fetchXmltv } = await import("./xtream");
    await authenticate(X);
    await fetchLiveCategories(X);
    await fetchLiveStreams(X);
    await fetchConnections(X);
    await fetchXmltv(X);
    expect(headersOf(httpGetJson)).toEqual(Array(4).fill(undefined));
    expect(httpGetBytes.mock.calls[0][1]).toBeUndefined();
  });

  it("send none for an agent no header can hold, whatever was saved", async () => {
    httpGetJson.mockImplementation(async (url: unknown) => answer(url));
    const { authenticate } = await import("./xtream");
    await authenticate({ ...X, userAgent: "bad\r\nX-Evil: 1" });
    await authenticate({ ...X, userAgent: 42 as unknown as string });
    expect(headersOf(httpGetJson)).toEqual([undefined, undefined]);
  });
});

describe("a Stalker portal's requests", () => {
  /** A portal that answers the handshake, the profile and the genres, and
   * remembers the headers of every call. */
  function portal() {
    const seen: Record<string, string>[] = [];
    httpGetJson.mockImplementation(async (url: unknown, headers?: Record<string, string>) => {
      seen.push(headers ?? {});
      const action = new URL(String(url)).searchParams.get("action");
      if (action === "handshake") return { js: { token: "TOK" } };
      if (action === "get_profile") return { js: { blocked: "0" } };
      if (action === "get_genres") return { js: [{ id: "1", title: "News" }] };
      if (action === "get_epg_info") return { js: {} };
      return { js: [] };
    });
    return seen;
  }

  it("send the MAG box's agent when the playlist has none", async () => {
    const seen = portal();
    const { fetchGenres } = await import("./stalker");
    await fetchGenres({ ...S, portal: "http://portal.example/portal.php" });
    expect(seen.length).toBeGreaterThanOrEqual(3);
    for (const h of seen) expect(h["User-Agent"]).toMatch(MAG);
  });

  it("send the playlist's agent instead of the MAG box's, and keep the rest of the box", async () => {
    const seen = portal();
    const { fetchGenres } = await import("./stalker");
    await fetchGenres({ ...S, portal: "http://portal.example/portal.php", userAgent: AGENT });
    // Handshake, profile, genres: three calls, none of them as the box.
    expect(seen.length).toBe(3);
    for (const h of seen) {
      expect(h["User-Agent"]).toBe(AGENT);
      // What identifies the box to a portal stays: the model, the page it
      // says it is on, the MAC in the cookie.
      expect(h["X-User-Agent"]).toBe("Model: MAG254; Link: WiFi");
      expect(h.Referer).toBe("http://portal.example/c/");
      expect(h.Cookie).toContain("mac=00%3A1A%3A79%3AAA%3ABB%3ACC");
    }
    // The token flow is the one it was: no Authorization on the handshake,
    // the bearer token on what follows.
    expect(seen[0].Authorization).toBeUndefined();
    expect(seen[1].Authorization).toBe("Bearer TOK");
    expect(seen[2].Authorization).toBe("Bearer TOK");
  });

  it("take a blank or an unusable agent as none, and keep the MAG box's", async () => {
    for (const userAgent of ["", "   ", "café", undefined]) {
      const seen = portal();
      const { fetchGenres } = await import("./stalker");
      await fetchGenres({ ...S, id: `s-${String(userAgent)}`, portal: "http://portal.example/portal.php", userAgent });
      for (const h of seen) expect(h["User-Agent"], JSON.stringify(userAgent)).toMatch(MAG);
    }
  });
});
