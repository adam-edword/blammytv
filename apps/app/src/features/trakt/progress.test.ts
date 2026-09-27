import { describe, expect, it } from "vitest";
import type { WatchEntry } from "../stream/watching";
import { mergeProgress, type Playback } from "./progress";

const T = (iso: string) => Date.parse(iso);
const movie = (id: number, imdb: string, progress: number, paused: string, runtime?: number): Playback => ({
  id,
  progress,
  paused_at: paused,
  type: "movie",
  movie: { title: `Film ${imdb}`, year: 2020, ids: { imdb }, ...(runtime ? { runtime } : {}) },
});
const episode = (id: number, show: string, season: number, number: number, progress: number, paused: string): Playback => ({
  id,
  progress,
  paused_at: paused,
  type: "episode",
  show: { title: `Show ${show}`, year: 2019, ids: { imdb: show } },
  episode: { season, number, title: `Ep ${number}`, runtime: 50, ids: { trakt: 99 } },
});

describe("progress in (plan 015, T4)", () => {
  it("a film paused elsewhere joins Continue Watching at its position", () => {
    const out = mergeProgress([], [movie(7, "tt1", 50, "2026-09-20T10:00:00Z", 120)]);
    expect(out).toEqual([
      {
        id: "tt1",
        title: "Film tt1",
        kind: "movie",
        year: 2020,
        runtimeMin: 120,
        at: T("2026-09-20T10:00:00Z"),
        trakt: 7,
        posSec: 3600,
        durSec: 7200,
      },
    ]);
  });

  it("the newer position wins: Trakt's when it was paused later", () => {
    const local: WatchEntry[] = [{ id: "tt1", title: "F", kind: "movie", at: T("2026-09-19T00:00:00Z"), posSec: 60, durSec: 6000 }];
    const [e] = mergeProgress(local, [movie(7, "tt1", 25, "2026-09-20T10:00:00Z")]);
    expect(e.posSec).toBe(1500);
    expect(e.durSec).toBe(6000);
    expect(e.title).toBe("Film tt1");
    expect(e.trakt).toBe(7);
  });

  it("this side's when it was played later, and it learns Trakt's id for it", () => {
    const local: WatchEntry[] = [{ id: "tt1", title: "F", kind: "movie", at: T("2026-09-21T00:00:00Z"), posSec: 60, durSec: 6000 }];
    const [e] = mergeProgress(local, [movie(7, "tt1", 25, "2026-09-20T10:00:00Z")]);
    expect(e.posSec).toBe(60);
    expect(e.trakt).toBe(7);
  });

  it("a series moves to the episode paused most recently", () => {
    const local: WatchEntry[] = [
      { id: "tt5", title: "S", kind: "series", episodeId: "tt5:1:1", season: 1, episode: 1, at: T("2026-09-01T00:00:00Z"), posSec: 100, durSec: 3000 },
    ];
    const [e] = mergeProgress(local, [
      episode(1, "tt5", 1, 2, 10, "2026-09-10T00:00:00Z"),
      episode(2, "tt5", 1, 3, 40, "2026-09-12T00:00:00Z"),
    ]);
    expect(e).toMatchObject({ episodeId: "tt5:1:3", season: 1, episode: 3, epTitle: "Ep 3", label: "S1 · E3: Ep 3", trakt: 2 });
    // A different episode: its own runtime, not the old episode's duration.
    expect(e.durSec).toBe(3000);
    expect(e.posSec).toBe(1200);
  });

  it("with no duration anywhere, the entry comes in without a position", () => {
    const [e] = mergeProgress([], [movie(7, "tt1", 50, "2026-09-20T10:00:00Z")]);
    expect(e.posSec).toBeUndefined();
    expect(e.durSec).toBeUndefined();
  });

  it("titles not keyed by IMDb are skipped (D5)", () => {
    const p: Playback = { id: 1, progress: 10, paused_at: "2026-09-20T10:00:00Z", type: "movie", movie: { ids: { tmdb: 3 } } };
    expect(mergeProgress([], [p])).toEqual([]);
  });

  it("keeps the store's cap of 20, newest first", () => {
    const many = Array.from({ length: 25 }, (_, i) => movie(i, `tt${i}`, 10, new Date(Date.UTC(2026, 8, 1, i)).toISOString(), 100));
    const out = mergeProgress([], many);
    expect(out).toHaveLength(20);
    expect(out[0].id).toBe("tt24");
  });
});
