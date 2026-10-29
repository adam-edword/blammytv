import { describe, expect, it } from "vitest";
import type { VodItem } from "../stream/model";
import { TMDB_PARALLEL, TMDB_ROW } from "./genreRows";
import { popularInGenre, type TmdbDeps } from "./genreTmdb";
import type { TmdbCandidate } from "./tmdb";

const cand = (n: number, kind: "movie" | "series" = "movie"): TmdbCandidate => ({
  id: `tmdb:${kind}:${n}`,
  title: `${kind} ${n}`,
  kind,
});
const vod = (id: string, kind: "movie" | "series" = "movie"): VodItem => ({
  id,
  title: id,
  kind,
  genres: [],
  cast: [],
  seasons: [],
});

/** TMDB with `n` popular titles per type; the addons know every IMDb id
 * except those in `missing`. `asked` records what was requested. */
function fake(
  n: number,
  o: { missing?: string[]; noImdb?: string[]; throwOn?: string[]; enabled?: boolean } = {},
) {
  const asked = { popular: [] as string[], resolve: [] as string[], live: 0, peak: 0 };
  const deps: TmdbDeps = {
    enabled: () => o.enabled ?? true,
    genreIds: async (kind) =>
      new Map([["comedy", kind === "movie" ? 35 : 3500]]),
    popular: async (genre, kind) => {
      asked.popular.push(`${kind}:${genre}`);
      return Array.from({ length: n }, (_, i) => cand(i + 1, kind));
    },
    imdbId: async (c) => {
      asked.live++;
      asked.peak = Math.max(asked.peak, asked.live);
      await new Promise((r) => setTimeout(r, 1));
      asked.live--;
      if (o.throwOn?.includes(c.id)) throw new Error("boom");
      return o.noImdb?.includes(c.id) ? null : `tt${c.kind}${c.id.split(":")[2]}`;
    },
    resolve: async (kind, imdb) => {
      asked.resolve.push(`${kind}:${imdb}`);
      return o.missing?.includes(imdb) ? null : vod(imdb, kind);
    },
  };
  return { deps, asked };
}

describe("popularInGenre", () => {
  it("asks for the genre's films only on Movies, and resolves each through the addons", async () => {
    const { deps, asked } = fake(4);
    const out = await popularInGenre("Comedy", "movie", deps);
    expect(asked.popular).toEqual(["movie:35"]);
    expect(out.map((i) => i.id)).toEqual(["ttmovie1", "ttmovie2", "ttmovie3", "ttmovie4"]);
    expect(asked.resolve).toHaveLength(4);
  });

  it("asks for films and shows on Any, alternating, and for nothing on Series", async () => {
    const a = fake(3);
    const any = await popularInGenre("comedy", "all", a.deps);
    expect(a.asked.popular.sort()).toEqual(["movie:35", "series:3500"]);
    expect(any.map((i) => i.id)).toEqual([
      "ttmovie1", "ttseries1", "ttmovie2", "ttseries2", "ttmovie3", "ttseries3",
    ]);
    const b = fake(3);
    expect(await popularInGenre("Comedy", "series", b.deps)).toEqual([]);
    expect(b.asked.popular).toEqual([]);
  });

  it("is empty without a key, and for a genre TMDB has no name for", async () => {
    const off = fake(3, { enabled: false });
    expect(await popularInGenre("Comedy", "all", off.deps)).toEqual([]);
    expect(off.asked.popular).toEqual([]);
    const unknown = fake(3);
    expect(await popularInGenre("Anime", "all", unknown.deps)).toEqual([]);
  });

  it("leaves out a title the addons do not have, one with no IMDb id, and one whose lookup throws", async () => {
    const { deps } = fake(5, {
      missing: ["ttmovie2"],
      noImdb: ["tmdb:movie:3"],
      throwOn: ["tmdb:movie:4"],
    });
    const out = await popularInGenre("Comedy", "movie", deps);
    expect(out.map((i) => i.id)).toEqual(["ttmovie1", "ttmovie5"]);
  });

  it("keeps the first TMDB_ROW titles only, and never more than TMDB_PARALLEL lookups at once", async () => {
    const { deps, asked } = fake(30);
    const out = await popularInGenre("Comedy", "movie", deps);
    expect(out).toHaveLength(TMDB_ROW);
    expect(asked.resolve).toHaveLength(TMDB_ROW);
    expect(asked.peak).toBeLessThanOrEqual(TMDB_PARALLEL);
    expect(asked.peak).toBeGreaterThan(1);
  });

  it("is empty when TMDB itself fails", async () => {
    const { deps } = fake(3);
    deps.popular = async () => {
      throw new Error("503");
    };
    deps.genreIds = async () => {
      throw new Error("down");
    };
    expect(await popularInGenre("Comedy", "all", deps)).toEqual([]);
  });
});
