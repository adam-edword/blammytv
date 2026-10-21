import { beforeEach, describe, expect, it, vi } from "vitest";

// An in-memory localStorage and a window that only hears events: the unit
// tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
vi.stubGlobal("window", new EventTarget());

import { buildIndex, malEpisodeOf, malFilmOf, type AnimeIndexes } from "../stream/animemap";
import { loadLedger, markWatched, replaceLedger } from "../stream/watched";
import { historyToPush } from "../trakt/history";
import { episodeRef, imdbOf } from "../trakt/ids";
import { historyFor, scrobbleItem } from "../trakt/scrobble";

// A provider's titles are keyed by the provider's own ids (xtvod/keys.ts), and
// neither Trakt nor MyAnimeList knows them: both key a title by IMDb id (or
// Kitsu's). Plan 028 says a provider's title is never scrobbled or ticked
// there, the same as a Jellyfin title with no IMDb id. Each test pairs the
// refusal with a control that the same call answers for an IMDb id, so a
// refusal is the key's and not the call's.

const MOVIE = "xt:p:m:t617126";
const SHOW = "xt:p:s:t4521";
const EPISODE = `${SHOW}:1:2`;

beforeEach(() => mem.clear());

describe("Trakt", () => {
  it("does not know the key as an IMDb id or an episode (trakt/ids.ts: both are patterns on `tt` ids)", () => {
    expect(imdbOf("tt0111161")).toBe("tt0111161");
    expect(imdbOf(MOVIE)).toBeNull();
    expect(imdbOf(SHOW)).toBeNull();
    expect(episodeRef("tt0903747:1:2")).not.toBeNull();
    expect(episodeRef(EPISODE)).toBeNull();
  });

  it("scrobbles neither a film nor an episode of it (trakt/scrobble.ts scrobbleItem; an episode's own Trakt id is looked up by episodeRef, so there is none)", () => {
    expect(scrobbleItem({ itemId: "tt0111161", kind: "movie", title: "A" })).not.toBeNull();
    expect(scrobbleItem({ itemId: MOVIE, kind: "movie", title: "A" })).toBeNull();
    expect(scrobbleItem({ itemId: SHOW, kind: "series", title: "B", episodeId: EPISODE })).toBeNull();
  });

  it("queues no history for a finished watch of it (trakt/scrobble.ts historyFor)", () => {
    expect(historyFor({ itemId: "tt0111161", kind: "movie" }, 1)).not.toBeNull();
    expect(historyFor({ itemId: "tt0903747", kind: "series", episodeId: "tt0903747:1:2" }, 1)).not.toBeNull();
    expect(historyFor({ itemId: MOVIE, kind: "movie" }, 1)).toBeNull();
    expect(historyFor({ itemId: SHOW, kind: "series", episodeId: EPISODE }, 1)).toBeNull();
  });

  it("sends none of its ticks or films in the first sync's push (trakt/history.ts historyToPush)", () => {
    const control = historyToPush({ tt0903747: ["tt0903747:1:2"] }, {}, new Map([["tt0111161", 5]]));
    expect(control?.shows).toHaveLength(1);
    expect(control?.movies).toHaveLength(1);
    expect(historyToPush({ [SHOW]: [EPISODE] }, {}, new Map([[MOVIE, 5]]))).toBeNull();
  });

  it("leaves its local ticks alone when Trakt's ledger replaces the others (stream/watched.ts replaceLedger)", () => {
    markWatched(SHOW, EPISODE);
    markWatched("tt0903747", "tt0903747:1:1");
    replaceLedger({ tt0903747: ["tt0903747:1:2"] });
    expect(loadLedger()).toEqual({ [SHOW]: [EPISODE], tt0903747: ["tt0903747:1:2"] });
  });
});

describe("MyAnimeList", () => {
  const imdb = buildIndex([{ imdb_id: "tt2560140", mal_id: 16498, type: "TV", season: { tvdb: 1 } }]);
  const movieIdx = buildIndex([{ imdb_id: "tt5311514", mal_id: 32281, type: "MOVIE" }]);
  const idx: AnimeIndexes = { imdb: { ...imdb, ...movieIdx }, kitsu: {} };

  it("places no episode of it: the IMDb index has no row for the key (stream/animemap.ts malEpisodeOf)", () => {
    expect(malEpisodeOf("tt2560140", "tt2560140:1:3", [], idx)).toEqual({ mal: 16498, ep: 3 });
    expect(malEpisodeOf(SHOW, EPISODE, [], idx)).toBeNull();
  });

  it("places no film of it (stream/animemap.ts malFilmOf)", () => {
    expect(malFilmOf("tt5311514", idx)).toEqual({ mal: 32281, ep: 1 });
    expect(malFilmOf(MOVIE, idx)).toBeNull();
  });
});
