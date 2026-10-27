import { beforeEach, describe, expect, it, vi } from "vitest";
import type { XtreamPlaylist } from "../features/settings/playlists";

/**
 * A playlist's movies and shows (plan 028): the six calls a Stream library is
 * read from. lib/http is replaced by a recorder, so what is asserted is the
 * call each makes: its address, the playlist's User-Agent, and the timeout of
 * the two whole-library lists. What the answers mean is features/xtvod's.
 */

const httpGetJson = vi.fn();
vi.mock("../lib/http", () => ({
  httpGetJson: (...a: unknown[]) => httpGetJson(...a),
  httpGetBytes: vi.fn(),
  httpGetText: vi.fn(),
}));

const X: XtreamPlaylist = {
  kind: "xtream",
  id: "x1",
  name: "Line",
  enabled: true,
  server: " http://panel.example.invalid:8080/ ",
  username: "us er",
  password: "p&ss",
};

const AGENT = "TestApp/9.1 (Provider Check)";

beforeEach(() => {
  httpGetJson.mockReset();
  httpGetJson.mockResolvedValue([]);
});

/** The query of the nth call's address. */
const query = (n = 0) => new URL(String(httpGetJson.mock.calls[n][0])).searchParams;

describe("the movie and show calls", () => {
  it("each ask player_api.php for their action, as the account", async () => {
    const x = await import("./xtream");
    await x.fetchVodCategories(X);
    await x.fetchSeriesCategories(X);
    await x.fetchVodStreams(X);
    await x.fetchSeries(X);
    await x.fetchVodInfo(X, 52114);
    await x.fetchSeriesInfo(X, "3101");
    expect(httpGetJson).toHaveBeenCalledTimes(6);
    const asked = httpGetJson.mock.calls.map((c) => new URL(String(c[0])));
    for (const u of asked) {
      expect(u.origin + u.pathname).toBe("http://panel.example.invalid:8080/player_api.php");
      expect(u.searchParams.get("username")).toBe("us er");
      expect(u.searchParams.get("password")).toBe("p&ss");
    }
    expect(asked.map((u) => u.searchParams.get("action"))).toEqual([
      "get_vod_categories",
      "get_series_categories",
      "get_vod_streams",
      "get_series",
      "get_vod_info",
      "get_series_info",
    ]);
    expect(asked[4].searchParams.get("vod_id")).toBe("52114");
    expect(asked[5].searchParams.get("series_id")).toBe("3101");
  });

  it("give the two whole-library lists two minutes, and the rest the client's default", async () => {
    const x = await import("./xtream");
    await x.fetchVodStreams(X);
    await x.fetchSeries(X);
    expect(httpGetJson.mock.calls[0][2]).toEqual({ timeoutSecs: 120 });
    expect(httpGetJson.mock.calls[1][2]).toEqual({ timeoutSecs: 120 });
    httpGetJson.mockClear();
    await x.fetchVodCategories(X);
    await x.fetchSeriesCategories(X);
    await x.fetchVodInfo(X, 1);
    await x.fetchSeriesInfo(X, 1);
    for (const c of httpGetJson.mock.calls) expect(c[2]).toBeUndefined();
  });

  it("send the playlist's own User-Agent with every one, and nothing without one", async () => {
    const x = await import("./xtream");
    const all = async (p: XtreamPlaylist) => {
      await x.fetchVodCategories(p);
      await x.fetchSeriesCategories(p);
      await x.fetchVodStreams(p);
      await x.fetchSeries(p);
      await x.fetchVodInfo(p, 1);
      await x.fetchSeriesInfo(p, 1);
    };
    await all({ ...X, userAgent: `  ${AGENT} ` });
    expect(httpGetJson.mock.calls.map((c) => c[1])).toEqual(Array(6).fill({ "User-Agent": AGENT }));
    httpGetJson.mockClear();
    await all(X);
    expect(httpGetJson.mock.calls.map((c) => c[1])).toEqual(Array(6).fill(undefined));
  });

  it("read the folders as Live's are read: ids as strings, a name, and the panel's adult flag", async () => {
    const x = await import("./xtream");
    httpGetJson.mockResolvedValue([
      { category_id: "11", category_name: "4K Movies", parent_id: 0 },
      { category_id: 14, category_name: "Premium Vault", is_adult: "1" },
      { category_id: "15" },
      { category_name: "no id" },
    ]);
    expect(await x.fetchVodCategories(X)).toEqual([
      { id: "11", name: "4K Movies", adult: false },
      { id: "14", name: "Premium Vault", adult: true },
      { id: "15", name: "15", adult: false },
    ]);
    expect(await x.fetchSeriesCategories(X)).toHaveLength(3);
  });

  it("return the lists as the panel sent them", async () => {
    const x = await import("./xtream");
    const raw = [{ stream_id: "5", name: "x" }, null, "junk"];
    httpGetJson.mockResolvedValue(raw);
    expect(await x.fetchVodStreams(X)).toEqual(raw);
    expect(await x.fetchSeries(X)).toEqual(raw);
    httpGetJson.mockResolvedValue([]);
    expect(await x.fetchVodStreams(X)).toEqual([]);
    expect(await x.fetchVodCategories(X)).toEqual([]);
  });

  it("read anything else that is not a list as none, as a live-only panel may answer", async () => {
    const x = await import("./xtream");
    const calls = [x.fetchVodStreams, x.fetchSeries, x.fetchVodCategories, x.fetchSeriesCategories];
    for (const bad of [{ error: "x" }, "no", null, 5, "<html>Blocked</html>", { user_info: { auth: 1 } }]) {
      httpGetJson.mockResolvedValue(bad);
      for (const call of calls) expect(await call(X)).toEqual([]);
    }
  });

  it("say what a lapsed account's panel says, when it answers every call with its sign-in object", async () => {
    const x = await import("./xtream");
    const calls = [x.fetchVodStreams, x.fetchSeries, x.fetchVodCategories, x.fetchSeriesCategories, x.fetchLiveStreams];
    httpGetJson.mockResolvedValue({ user_info: { auth: 0 } });
    for (const call of calls) await expect(call(X)).rejects.toThrow("the panel rejected the credentials");
    httpGetJson.mockResolvedValue({ user_info: { auth: 0, status: "Expired" } });
    await expect(x.fetchVodStreams(X)).rejects.toThrow("Expired");
    // Live's channels refuse any non-list; a signed-in object is not a refusal.
    httpGetJson.mockResolvedValue({ user_info: { auth: 1 } });
    await expect(x.fetchLiveStreams(X)).rejects.toThrow("the panel didn’t return a list");
  });

  it("return an info as the panel sent it, an empty array included", async () => {
    const x = await import("./xtream");
    httpGetJson.mockResolvedValue({ info: { name: "x" }, movie_data: {} });
    expect(await x.fetchVodInfo(X, 1)).toEqual({ info: { name: "x" }, movie_data: {} });
    httpGetJson.mockResolvedValue([]);
    expect(await x.fetchSeriesInfo(X, 1)).toEqual([]);
  });

  it("reject when the panel does, so a caller can tell a failure from an empty list", async () => {
    const x = await import("./xtream");
    httpGetJson.mockRejectedValue(new Error("HTTP 500"));
    await expect(x.fetchVodStreams(X)).rejects.toThrow("HTTP 500");
    await expect(x.fetchSeriesInfo(X, 1)).rejects.toThrow("HTTP 500");
    await expect(x.fetchVodCategories(X)).rejects.toThrow("HTTP 500");
  });

  it("leave Live's calls as they were", async () => {
    const x = await import("./xtream");
    httpGetJson.mockResolvedValue([{ category_id: "1", category_name: "News" }]);
    expect(await x.fetchLiveCategories(X)).toEqual([{ id: "1", name: "News", adult: false }]);
    expect(query(0).get("action")).toBe("get_live_categories");
    expect(httpGetJson.mock.calls[0][2]).toBeUndefined();
    // Live's folders are lenient about a non-list; its channels are not.
    httpGetJson.mockResolvedValue({ error: "x" });
    expect(await x.fetchLiveCategories(X)).toEqual([]);
    await expect(x.fetchLiveStreams(X)).rejects.toThrow("the panel didn’t return a list");
    httpGetJson.mockResolvedValue([{ stream_id: 1 }, { name: "no id" }]);
    expect(await x.fetchLiveStreams(X)).toEqual([{ stream_id: 1 }]);
  });
});
