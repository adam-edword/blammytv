import { beforeEach, describe, expect, it, vi } from "vitest";
import type { VodItem } from "./model";

// getAniskipRanges against a stubbed network: the Fribb dataset and the
// AniSkip API are the only things faked, so the real animemap placement runs.

const store = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
});

/** The AniSkip URLs asked for, in order. */
const asked: string[] = [];
vi.mock("../../lib/http", () => ({
  httpGetJson: async (url: string) => {
    if (url.includes("anime-list-mini")) {
      return [
        { kitsu_id: 1555, mal_id: 21, type: "TV" },
        { kitsu_id: 7442, mal_id: 16498, imdb_id: "tt2560140", type: "TV", season: { tvdb: 1 } },
        { kitsu_id: 3936, mal_id: 5114, type: "MOVIE" },
        { imdb_id: "tt2560140", mal_id: 25777, type: "TV", season: { tvdb: 2 } },
      ];
    }
    asked.push(url);
    return { found: true, results: [{ interval: { startTime: 12, endTime: 95 }, skipType: "op" }] };
  },
}));

const { getAniskipRanges } = await import("./aniskip");

const item = (over: Partial<VodItem>): VodItem => ({
  id: "x",
  title: "X",
  kind: "series",
  genres: [],
  cast: [],
  seasons: [],
  ...over,
});
const skipPath = () => asked.map((u) => /skip-times\/(\d+)\/(\d+)/.exec(u)?.slice(1).join("/"));

describe("exact skip ranges", () => {
  beforeEach(() => {
    store.clear();
    asked.length = 0;
  });

  it("finds a Kitsu-keyed episode's skips under its MAL id and the episode number", async () => {
    // The Kitsu addon's genres don't say Animation, so no genre gate here.
    const ranges = await getAniskipRanges(item({ id: "kitsu:1555", genres: ["Action"] }), "kitsu:1555:7");
    expect(skipPath()).toEqual(["21/7"]);
    expect(ranges).toEqual([{ type: "op", start: 12, end: 95 }]);
  });

  it("finds a Kitsu film's under episode 1, and a one-video entry's", async () => {
    await getAniskipRanges(item({ id: "kitsu:3936", kind: "movie" }), null);
    await getAniskipRanges(item({ id: "kitsu:1555" }), "kitsu:1555");
    expect(skipPath()).toEqual(["5114/1", "21/1"]);
  });

  it("asks for nothing when the title or the episode is not in the mapping", async () => {
    expect(await getAniskipRanges(item({ id: "kitsu:99999" }), "kitsu:99999:1")).toEqual([]);
    // Someone else's episode id on this title.
    expect(await getAniskipRanges(item({ id: "kitsu:1555" }), "kitsu:777:1")).toEqual([]);
    expect(asked).toEqual([]);
  });

  it("leaves an IMDb-keyed title as it was: the genre gate, then its season rows", async () => {
    expect(await getAniskipRanges(item({ id: "tt2560140", genres: ["Drama"] }), "tt2560140:2:3")).toEqual([]);
    expect(asked).toEqual([]);
    await getAniskipRanges(item({ id: "tt2560140", genres: ["Animation"] }), "tt2560140:2:3");
    expect(skipPath()).toEqual(["25777/3"]);
  });
});
