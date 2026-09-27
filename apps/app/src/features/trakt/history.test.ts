import { describe, expect, it } from "vitest";
import { historyToPush, ledgerFromTrakt, moviesFromTrakt, type WatchedShow } from "./history";

const show = (imdb: string | undefined, seasons: [number, number[]][]): WatchedShow => ({
  show: { title: "x", ids: imdb ? { imdb } : { trakt: 1 } },
  seasons: seasons.map(([number, eps]) => ({ number, episodes: eps.map((n) => ({ number: n })) })),
});

describe("watched history (plan 015, T3)", () => {
  it("Trakt's watched shows become the episode ledger", () => {
    expect(ledgerFromTrakt([show("tt1", [[1, [1, 2]], [2, [1]]])])).toEqual({
      tt1: ["tt1:1:1", "tt1:1:2", "tt1:2:1"],
    });
  });

  it("a show with no IMDb id is left out (D5)", () => {
    expect(ledgerFromTrakt([show(undefined, [[1, [1]]])])).toEqual({});
  });

  it("films come in with when they were last watched", () => {
    expect(
      moviesFromTrakt([
        { last_watched_at: "2026-09-01T20:00:00.000Z", movie: { ids: { imdb: "tt9" } } },
        { movie: { ids: { tmdb: 5 } } },
      ]),
    ).toEqual({ tt9: Date.parse("2026-09-01T20:00:00.000Z") });
  });

  it("the first sync sends only what Trakt lacks, grouped by season, dated unknown", () => {
    const body = historyToPush(
      { tt1: ["tt1:1:1", "tt1:1:2", "tt1:2:5"], tt2: ["tt2:1:1"] },
      { tt1: ["tt1:1:1"], tt2: ["tt2:1:1"] },
    );
    expect(body).toEqual({
      shows: [
        {
          ids: { imdb: "tt1" },
          seasons: [
            { number: 1, episodes: [{ number: 2, watched_at: "unknown" }] },
            { number: 2, episodes: [{ number: 5, watched_at: "unknown" }] },
          ],
        },
      ],
    });
  });

  it("films finished here go with the time they were finished", () => {
    const body = historyToPush({}, {}, new Map([["tt9", Date.parse("2026-09-01T20:00:00.000Z")], ["tt8", 5]]), { tt8: 1 });
    expect(body).toEqual({ movies: [{ ids: { imdb: "tt9" }, watched_at: "2026-09-01T20:00:00.000Z" }] });
  });

  it("nothing Trakt lacks, nothing to send", () => {
    expect(historyToPush({ tt1: ["tt1:1:1"] }, { tt1: ["tt1:1:1", "tt1:1:2"] })).toBeNull();
  });

  it("episodes not keyed by IMDb never go (D5)", () => {
    expect(historyToPush({ "kitsu:1": ["kitsu:1:1:1"] }, {})).toBeNull();
  });
});
