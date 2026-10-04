import { describe, expect, it } from "vitest";
import type { SkipRange } from "../stream/aniskip";
import type { WatchEntry } from "../stream/watching";
import { mergeProgress, type Playback } from "../trakt/progress";
import { packEpisode, packMovie, packSeries } from "./ids";
import {
  episodeLabel,
  itemRef,
  mergeAioProgress,
  playedFrom,
  reportBody,
  resumeFrom,
  secToTicks,
  skipsFrom,
  ticksToSec,
  upNextFrom,
  type BaseItem,
  type Resume,
} from "./rules";

const T = (iso: string) => Date.parse(iso);

function must<V>(v: V | null | undefined): V {
  if (v == null) throw new Error("a fixture id did not pack");
  return v;
}

const MIN = 600_000_000; // a minute of ticks

// Fixtures are shaped from AIOStreams v2.35.9's own builders, packages/
// core/src/jellyfin/dto.ts, and cut to the fields the rules read.

// An episode, as buildEpisode makes it (dto.ts:714-778): IndexNumber and
// ParentIndexNumber at 750-751, SeriesId and SeriesName at 752-753, the
// premiere at 758, RunTimeTicks at 763, SeriesPrimaryImageTag at 767, and a
// UserData from userDataFromRow (dto.ts:163-185). The id packs, as it does
// when the meta's video id is the plain `tt…:S:E`.
const episode = (over: BaseItem = {}): BaseItem => ({
  Id: must(packEpisode("tt0903747:3:7")),
  Type: "Episode",
  Name: "Fly",
  SeriesId: must(packSeries("tt0903747")),
  SeriesName: "Breaking Bad",
  IndexNumber: 7,
  ParentIndexNumber: 3,
  PremiereDate: "2010-05-09T00:00:00.000Z",
  RunTimeTicks: 45 * MIN,
  SeriesPrimaryImageTag: "abcdefghijk1aHR0cHM6Ly9leGFtcGxlLmNvbS9wLmpwZw",
  ProviderIds: { Imdb: "tt1491829" },
  UserData: { PlaybackPositionTicks: 20 * MIN, Played: false, LastPlayedDate: "2026-09-20T10:00:00.000Z" },
  ...over,
});

// A film, as buildContentItem makes it (dto.ts:470-570): ProviderIds from
// providerIdsFor (dto.ts:188-210), ProductionYear and RunTimeTicks at 523.
const film = (over: BaseItem = {}): BaseItem => ({
  Id: must(packMovie("tt0111161")),
  Type: "Movie",
  Name: "The Shawshank Redemption",
  ProductionYear: 1994,
  RunTimeTicks: 142 * MIN,
  ProviderIds: { Imdb: "tt0111161" },
  UserData: { PlaybackPositionTicks: 60 * MIN, Played: false, LastPlayedDate: "2026-09-21T08:00:00.000Z" },
  ...over,
});

describe("ticks", () => {
  it("ticksToSec: ten million to a second", () => {
    expect(ticksToSec(10_000_000)).toBe(1);
    expect(ticksToSec(36_000_000_000)).toBe(3600);
    expect(ticksToSec(5_000_000)).toBe(0.5);
    expect(ticksToSec(0)).toBe(0);
  });

  it("ticksToSec: nothing readable is zero", () => {
    expect(ticksToSec(-10_000_000)).toBe(0);
    expect(ticksToSec(NaN)).toBe(0);
    expect(ticksToSec(Infinity)).toBe(0);
  });

  it("secToTicks: whole ticks", () => {
    expect(secToTicks(1)).toBe(10_000_000);
    expect(secToTicks(90.5)).toBe(905_000_000);
    expect(secToTicks(0)).toBe(0);
    // 12345678.912 ticks rounds, so the body never carries a fraction.
    expect(secToTicks(1.2345678912)).toBe(12_345_679);
    expect(Number.isInteger(secToTicks(1234.56789))).toBe(true);
  });

  it("secToTicks: nothing readable, or a negative, is zero", () => {
    expect(secToTicks(-5)).toBe(0);
    expect(secToTicks(NaN)).toBe(0);
    expect(secToTicks(Infinity)).toBe(0);
  });

  it("the two undo each other for a position the player reports", () => {
    expect(ticksToSec(secToTicks(4521.25))).toBe(4521.25);
  });
});

describe("reportBody", () => {
  // playstate.ts:152-176 reads ItemId and PositionTicks, and IsPaused on a
  // progress tick; PlaySessionId and MediaSourceId are optional.
  const id = must(packMovie("tt0111161"));

  it("carries the packed id, the position in ticks, and plays direct", () => {
    expect(reportBody(id, 90.5)).toEqual({
      ItemId: id,
      PositionTicks: 905_000_000,
      IsPaused: false,
      CanSeek: true,
      PlayMethod: "DirectPlay",
    });
  });

  it("says when it is paused", () => {
    expect(reportBody(id, 12, true).IsPaused).toBe(true);
    expect(reportBody(id, 12, false).IsPaused).toBe(false);
  });

  it("always has PositionTicks, at the very start too", () => {
    // A stop without one marks the item played on a real Jellyfin.
    const body = reportBody(id, 0);
    expect(body).toHaveProperty("PositionTicks", 0);
    expect(JSON.parse(JSON.stringify(body))).toHaveProperty("PositionTicks", 0);
    expect(JSON.parse(JSON.stringify(reportBody(id, NaN)))).toHaveProperty("PositionTicks", 0);
  });
});

describe("itemRef", () => {
  it("a film: its IMDb id", () => {
    expect(itemRef(film())).toEqual({ id: "tt0111161", kind: "movie" });
  });

  it("a film takes ProviderIds.Imdb before the packed id", () => {
    const kitsuFilm = film({ Id: must(packMovie("kitsu:1555", "anime")), ProviderIds: { Imdb: "tt0123456", Kitsu: "1555" } });
    expect(itemRef(kitsuFilm)).toEqual({ id: "tt0123456", kind: "movie" });
  });

  it("a film with no IMDb id: the packed id's", () => {
    expect(itemRef(film({ ProviderIds: {} }))).toEqual({ id: "tt0111161", kind: "movie" });
    expect(itemRef(film({ ProviderIds: undefined }))).toEqual({ id: "tt0111161", kind: "movie" });
    expect(itemRef(film({ Id: must(packMovie("kitsu:1555", "anime")), ProviderIds: { Kitsu: "1555" } }))).toEqual({
      id: "kitsu:1555",
      kind: "movie",
    });
  });

  it("an IMDb id that is not one is not used", () => {
    expect(itemRef(film({ ProviderIds: { Imdb: "nope" } }))).toEqual({ id: "tt0111161", kind: "movie" });
    expect(itemRef(film({ ProviderIds: { Imdb: "" } }))).toEqual({ id: "tt0111161", kind: "movie" });
  });

  it("a film whose id is hashed and has no IMDb id: null", () => {
    expect(itemRef(film({ Id: "b2" + "0".repeat(30), ProviderIds: {} }))).toBeNull();
    expect(itemRef(film({ Id: undefined, ProviderIds: {} }))).toBeNull();
  });

  it("a film whose id is hashed but carries an IMDb id: the IMDb id", () => {
    expect(itemRef(film({ Id: "b2" + "0".repeat(30) }))).toEqual({ id: "tt0111161", kind: "movie" });
  });

  it("a show: the same rule, as a series", () => {
    const show: BaseItem = { Id: must(packSeries("tt0903747")), Type: "Series", Name: "Breaking Bad", ProviderIds: { Imdb: "tt0903747" } };
    expect(itemRef(show)).toEqual({ id: "tt0903747", kind: "series" });
    expect(itemRef({ ...show, ProviderIds: {} })).toEqual({ id: "tt0903747", kind: "series" });
    expect(itemRef({ ...show, Id: "b2" + "0".repeat(30), ProviderIds: {} })).toBeNull();
  });

  it("an episode: its own id for the episode, its series' for the show", () => {
    expect(itemRef(episode())).toEqual({
      id: "tt0903747",
      seriesId: "tt0903747",
      episodeId: "tt0903747:3:7",
      kind: "episode",
    });
  });

  it("an episode never takes the IMDb id in its ProviderIds: that one is the episode's", () => {
    expect(itemRef(episode({ ProviderIds: { Imdb: "tt1491829" } }))).toMatchObject({ seriesId: "tt0903747", episodeId: "tt0903747:3:7" });
  });

  it("a Kitsu episode: kitsu:N:E, under kitsu:N", () => {
    const item = episode({
      Id: must(packEpisode("kitsu:7442:5", { type: "anime" })),
      SeriesId: must(packSeries("kitsu:7442", "anime")),
      ParentIndexNumber: 1,
      IndexNumber: 5,
    });
    expect(itemRef(item)).toEqual({ id: "kitsu:7442", seriesId: "kitsu:7442", episodeId: "kitsu:7442:5", kind: "episode" });
  });

  it("an episode with no readable SeriesId still finds its show, in its own id", () => {
    expect(itemRef(episode({ SeriesId: undefined }))).toMatchObject({ seriesId: "tt0903747", episodeId: "tt0903747:3:7" });
    expect(itemRef(episode({ SeriesId: "b2" + "0".repeat(30) }))).toMatchObject({ seriesId: "tt0903747" });
  });

  it("an episode that does not decode: null", () => {
    expect(itemRef(episode({ Id: "b2" + "0".repeat(30) }))).toBeNull();
    expect(itemRef(episode({ Id: undefined }))).toBeNull();
    expect(itemRef(episode({ Id: "not an id" }))).toBeNull();
    // A film's id on an episode, and an id type BlammyTV does not have.
    expect(itemRef(episode({ Id: must(packMovie("tt0903747")) }))).toBeNull();
    expect(itemRef(episode({ Id: "a14202" + "00000000025b" + "00030007" + "000000" }))).toBeNull();
  });

  it("an episode with no season or number in its id: null", () => {
    expect(itemRef(episode({ Id: "a141020000000dca43ffffffff000000" }))).toBeNull();
  });

  it("anything else is not a title: null", () => {
    for (const Type of ["Season", "BoxSet", "CollectionFolder", "Genre", "Person", "", undefined]) {
      expect(itemRef(film({ Type })), String(Type)).toBeNull();
    }
  });
});

describe("resumeFrom", () => {
  const now = T("2026-10-04T12:00:00Z");

  it("a film: position, duration and when, with what the card needs", () => {
    expect(resumeFrom([film()], now)).toEqual([
      {
        id: "tt0111161",
        title: "The Shawshank Redemption",
        kind: "movie",
        year: 1994,
        posSec: 3600,
        durSec: 8520,
        at: T("2026-09-21T08:00:00Z"),
      },
    ]);
  });

  it("an episode: under its series, with its own id, season and number", () => {
    expect(resumeFrom([episode()], now)).toEqual([
      {
        id: "tt0903747",
        episodeId: "tt0903747:3:7",
        title: "Breaking Bad",
        kind: "series",
        season: 3,
        episode: 7,
        epTitle: "Fly",
        posSec: 1200,
        durSec: 2700,
        at: T("2026-09-20T10:00:00Z"),
      },
    ]);
  });

  it("with no LastPlayedDate, the time the sync ran", () => {
    const [r] = resumeFrom([film({ UserData: { PlaybackPositionTicks: 60 * MIN } })], now);
    expect(r.at).toBe(now);
    const [bad] = resumeFrom([film({ UserData: { PlaybackPositionTicks: 60 * MIN, LastPlayedDate: "not a date" } })], now);
    expect(bad.at).toBe(now);
  });

  it("with no runtime, no duration", () => {
    const [r] = resumeFrom([film({ RunTimeTicks: undefined })], now);
    expect(r).not.toHaveProperty("durSec");
    expect(resumeFrom([film({ RunTimeTicks: 0 })], now)[0]).not.toHaveProperty("durSec");
  });

  it("an episode with no title keeps the rest", () => {
    const [r] = resumeFrom([episode({ Name: undefined })], now);
    expect(r).not.toHaveProperty("epTitle");
    expect(r.episodeId).toBe("tt0903747:3:7");
  });

  it("no position is no resume point", () => {
    expect(resumeFrom([film({ UserData: { PlaybackPositionTicks: 0, Played: true } })], now)).toEqual([]);
    expect(resumeFrom([film({ UserData: undefined })], now)).toEqual([]);
    expect(resumeFrom([film({ UserData: { Played: false } })], now)).toEqual([]);
  });

  it("what does not decode, or has no title, is left out; the rest stay in order", () => {
    const items = [
      episode({ Id: "b2" + "0".repeat(30) }),
      film(),
      { Id: must(packSeries("tt0903747")), Type: "Series", Name: "Breaking Bad", UserData: { PlaybackPositionTicks: MIN } },
      episode({ SeriesName: undefined }),
      film({ Name: undefined }),
      film({ Id: must(packMovie("tt0068646")), Name: "The Godfather", ProviderIds: { Imdb: "tt0068646" } }),
      episode(),
    ];
    expect(resumeFrom(items, now).map((r) => r.episodeId ?? r.id)).toEqual(["tt0111161", "tt0068646", "tt0903747:3:7"]);
  });

  it("nothing in, nothing out", () => {
    expect(resumeFrom([], now)).toEqual([]);
  });
});

describe("episodeLabel", () => {
  it("reads like Continue Watching's: S1 · E3: Title", () => {
    expect(episodeLabel(2, 5, "Title")).toBe("S2 · E5: Title");
  });

  it("is the label Trakt's merge writes for the same episode", () => {
    const p: Playback = {
      id: 1,
      progress: 10,
      paused_at: "2026-09-20T10:00:00Z",
      type: "episode",
      show: { title: "S", ids: { imdb: "tt5" } },
      episode: { season: 4, number: 12, title: "Ep 12", ids: {} },
    };
    expect(mergeProgress([], [p])[0].label).toBe(episodeLabel(4, 12, "Ep 12"));
  });

  it("without a title, just the numbers", () => {
    expect(episodeLabel(1, 1)).toBe("S1 · E1");
    expect(episodeLabel(1, 1, "")).toBe("S1 · E1");
  });
});

describe("mergeAioProgress (plan 023, D3)", () => {
  const film1 = (over: Partial<Resume> = {}): Resume => ({
    id: "tt1",
    title: "Film tt1",
    kind: "movie",
    posSec: 3600,
    durSec: 7200,
    at: T("2026-09-20T10:00:00Z"),
    ...over,
  });
  const ep = (id: string, season: number, number: number, over: Partial<Resume> = {}): Resume => ({
    id,
    episodeId: `${id}:${season}:${number}`,
    title: `Show ${id}`,
    kind: "series",
    season,
    episode: number,
    epTitle: `Ep ${number}`,
    posSec: 600,
    durSec: 2700,
    at: T("2026-09-10T00:00:00Z"),
    ...over,
  });
  const localFilm = (over: Partial<WatchEntry> = {}): WatchEntry => ({
    id: "tt1",
    title: "F",
    kind: "movie",
    at: T("2026-09-19T00:00:00Z"),
    posSec: 60,
    durSec: 6000,
    ...over,
  });

  it("a film played elsewhere joins Continue Watching at its position", () => {
    expect(mergeAioProgress([], [film1({ year: 2020 })])).toEqual([
      { id: "tt1", title: "Film tt1", kind: "movie", year: 2020, at: T("2026-09-20T10:00:00Z"), posSec: 3600, durSec: 7200 },
    ]);
  });

  it("the newer position wins: AIOStreams' when it was played later", () => {
    const [e] = mergeAioProgress([localFilm({ art: "a.jpg" })], [film1({ posSec: 1500, durSec: 5999 })]);
    expect(e.posSec).toBe(1500);
    expect(e.at).toBe(T("2026-09-20T10:00:00Z"));
    expect(e.title).toBe("Film tt1");
    // The player's own duration for the same film, not the meta's runtime.
    expect(e.durSec).toBe(6000);
    // And what only this side knows is kept.
    expect(e.art).toBe("a.jpg");
  });

  it("this side's when it was played later", () => {
    const local = localFilm({ at: T("2026-09-21T00:00:00Z") });
    expect(mergeAioProgress([local], [film1()])).toEqual([local]);
  });

  it("at the same moment, this side stays", () => {
    const local = localFilm({ at: T("2026-09-20T10:00:00Z") });
    expect(mergeAioProgress([local], [film1()])).toEqual([local]);
  });

  it("a series moves to the episode played most recently, whatever order they come in", () => {
    const local: WatchEntry[] = [
      { id: "tt5", title: "S", kind: "series", episodeId: "tt5:1:1", season: 1, episode: 1, at: T("2026-09-01T00:00:00Z"), posSec: 100, durSec: 3000 },
    ];
    const [e] = mergeAioProgress(local, [
      ep("tt5", 1, 3, { at: T("2026-09-12T00:00:00Z"), posSec: 1200, durSec: 2700 }),
      ep("tt5", 1, 2, { at: T("2026-09-10T00:00:00Z") }),
    ]);
    expect(e).toMatchObject({
      episodeId: "tt5:1:3",
      season: 1,
      episode: 3,
      epTitle: "Ep 3",
      label: "S1 · E3: Ep 3",
      posSec: 1200,
      at: T("2026-09-12T00:00:00Z"),
    });
    // A different episode: its own duration, not the old episode's.
    expect(e.durSec).toBe(2700);
  });

  it("another episode's title and label do not outlive it", () => {
    const local: WatchEntry[] = [
      {
        id: "tt5",
        title: "S",
        kind: "series",
        episodeId: "tt5:1:1",
        season: 1,
        episode: 1,
        epTitle: "Pilot",
        label: "S1 · E1: Pilot",
        at: T("2026-09-01T00:00:00Z"),
        posSec: 100,
        durSec: 3000,
      },
    ];
    const [e] = mergeAioProgress(local, [ep("tt5", 1, 2, { epTitle: undefined, durSec: undefined })]);
    expect(e.episodeId).toBe("tt5:1:2");
    expect(e).not.toHaveProperty("epTitle");
    expect(e).not.toHaveProperty("label");
    // Nor the other episode's duration.
    expect(e).not.toHaveProperty("durSec");
  });

  it("the same episode keeps the duration the player knew", () => {
    const local: WatchEntry[] = [
      { id: "tt5", title: "S", kind: "series", episodeId: "tt5:1:2", season: 1, episode: 2, at: T("2026-09-01T00:00:00Z"), posSec: 100, durSec: 3000 },
    ];
    const [e] = mergeAioProgress(local, [ep("tt5", 1, 2, { durSec: 2700 })]);
    expect(e.durSec).toBe(3000);
    expect(e.posSec).toBe(600);
  });

  it("with no duration anywhere, the entry comes in without one", () => {
    const [e] = mergeAioProgress([], [film1({ durSec: undefined })]);
    expect(e).not.toHaveProperty("durSec");
    expect(e.posSec).toBe(3600);
  });

  it("a year this side has is kept; one it lacks is filled", () => {
    expect(mergeAioProgress([localFilm({ year: 1999 })], [film1({ year: 2020 })])[0].year).toBe(1999);
    expect(mergeAioProgress([localFilm()], [film1({ year: 2020 })])[0].year).toBe(2020);
  });

  it("keeps the rest of the list, newest first", () => {
    const other: WatchEntry = { id: "tt9", title: "Other", at: T("2026-09-25T00:00:00Z") };
    const old: WatchEntry = { id: "tt8", title: "Old", at: T("2026-08-01T00:00:00Z") };
    const out = mergeAioProgress([old, other], [film1()]);
    expect(out.map((e) => e.id)).toEqual(["tt9", "tt1", "tt8"]);
  });

  it("nothing incoming leaves the list as it was, newest first", () => {
    const a: WatchEntry = { id: "a", title: "A", at: 1 };
    const b: WatchEntry = { id: "b", title: "B", at: 2 };
    expect(mergeAioProgress([a, b], [])).toEqual([b, a]);
  });

  it("does not change what it was given", () => {
    const local = [localFilm()];
    const incoming = [film1(), ep("tt5", 1, 1)];
    const before = JSON.stringify([local, incoming]);
    mergeAioProgress(local, incoming);
    expect(JSON.stringify([local, incoming])).toBe(before);
  });

  it("keeps the store's cap of 20, newest first", () => {
    const many = Array.from({ length: 25 }, (_, i) => film1({ id: `tt${i}`, at: Date.UTC(2026, 8, 1, i) }));
    const out = mergeAioProgress([], many);
    expect(out).toHaveLength(20);
    expect(out[0].id).toBe("tt24");
    expect(out[19].id).toBe("tt5");
  });

  describe("with the list full", () => {
    const full: WatchEntry[] = Array.from({ length: 20 }, (_, i) => ({ id: `old${i}`, title: `Old ${i}`, at: 1000 + i }));

    it("a title older than the oldest kept is not added", () => {
      const out = mergeAioProgress(full, [film1({ id: "new", at: 500 })]);
      expect(out).toHaveLength(20);
      expect(out.map((e) => e.id)).not.toContain("new");
    });

    it("one as old as the oldest kept is not added either", () => {
      const out = mergeAioProgress(full, [film1({ id: "new", at: 1000 })]);
      expect(out.map((e) => e.id)).not.toContain("new");
    });

    it("a newer one is, and the oldest goes", () => {
      const out = mergeAioProgress(full, [film1({ id: "new", at: 5000 })]);
      expect(out).toHaveLength(20);
      expect(out[0].id).toBe("new");
      expect(out.map((e) => e.id)).not.toContain("old0");
      expect(out.map((e) => e.id)).toContain("old1");
    });

    it("a title already in the list updates in place and nothing goes", () => {
      const out = mergeAioProgress(full, [film1({ id: "old3", at: 5000, posSec: 777 })]);
      expect(out).toHaveLength(20);
      expect(out[0]).toMatchObject({ id: "old3", posSec: 777 });
      expect(out.map((e) => e.id)).toContain("old0");
    });
  });

  it("with room, an old resume point still joins", () => {
    const out = mergeAioProgress([{ id: "tt9", title: "Other", at: T("2026-09-25T00:00:00Z") }], [film1({ at: T("2020-01-01T00:00:00Z") })]);
    expect(out.map((e) => e.id)).toEqual(["tt9", "tt1"]);
  });
});

describe("playedFrom", () => {
  // /Items?Recursive=true&IsPlayed=true (library.ts:446, 623): items whose
  // UserData.Played is true, films and episodes among shows and seasons.
  const played = (item: BaseItem): BaseItem => ({ ...item, UserData: { PlaybackPositionTicks: 0, Played: true } });
  const ep = (id: string, over: BaseItem = {}) =>
    played(
      episode({
        Id: must(packEpisode(id, { type: id.startsWith("kitsu") ? "anime" : "series" })),
        SeriesId: must(packSeries(id.startsWith("kitsu") ? "kitsu:7442" : id.split(":")[0], id.startsWith("kitsu") ? "anime" : "series")),
        ...over,
      }),
    );

  it("episodes by series, films apart, in the shape of malWatched", () => {
    const out = playedFrom([ep("tt0903747:1:1"), played(film()), ep("tt0903747:1:2"), ep("tt0944947:1:1"), ep("kitsu:7442:1")]);
    expect(out).toEqual({
      episodes: {
        tt0903747: ["tt0903747:1:1", "tt0903747:1:2"],
        tt0944947: ["tt0944947:1:1"],
        "kitsu:7442": ["kitsu:7442:1"],
      },
      films: ["tt0111161"],
      skipped: 0,
    });
  });

  it("sorted by season, then number, not as text", () => {
    const out = playedFrom([ep("tt0903747:10:1"), ep("tt0903747:2:5"), ep("tt0903747:2:10"), ep("tt0903747:2:9"), ep("tt0903747:1:20")]);
    expect(out.episodes.tt0903747).toEqual(["tt0903747:1:20", "tt0903747:2:5", "tt0903747:2:9", "tt0903747:2:10", "tt0903747:10:1"]);
  });

  it("Kitsu episodes sorted by number, not as text", () => {
    const out = playedFrom([ep("kitsu:7442:10"), ep("kitsu:7442:2"), ep("kitsu:7442:3")]);
    expect(out.episodes["kitsu:7442"]).toEqual(["kitsu:7442:2", "kitsu:7442:3", "kitsu:7442:10"]);
  });

  it("two syncs of the same answer, in another order, store the same", () => {
    const items = [ep("tt0903747:1:1"), ep("tt0903747:1:2"), played(film()), played(film({ Id: must(packMovie("tt0068646")), ProviderIds: { Imdb: "tt0068646" } }))];
    expect(playedFrom([...items].reverse())).toEqual(playedFrom(items));
  });

  it("an episode or film listed twice counts once", () => {
    const out = playedFrom([ep("tt0903747:1:1"), ep("tt0903747:1:1"), played(film()), played(film())]);
    expect(out.episodes.tt0903747).toEqual(["tt0903747:1:1"]);
    expect(out.films).toEqual(["tt0111161"]);
  });

  it("shows, seasons and collections are not entries and are not counted as skipped", () => {
    const out = playedFrom([
      played({ Id: must(packSeries("tt0903747")), Type: "Series" }),
      played({ Id: "a131020000000dca430002ffff000000", Type: "Season" }),
      played({ Id: "x", Type: "BoxSet" }),
      played({ Id: "x", Type: "Folder" }),
    ]);
    expect(out).toEqual({ episodes: {}, films: [], skipped: 0 });
  });

  it("what does not decode is counted, and left out", () => {
    const out = playedFrom([
      ep("tt0903747:1:1"),
      played(episode({ Id: "b2" + "0".repeat(30) })),
      played(film({ Id: "b2" + "0".repeat(30), ProviderIds: {} })),
      played(film({ Id: undefined, ProviderIds: {} })),
    ]);
    expect(out.episodes).toEqual({ tt0903747: ["tt0903747:1:1"] });
    expect(out.films).toEqual([]);
    expect(out.skipped).toBe(3);
  });

  it("a film takes its IMDb id when it has one", () => {
    const out = playedFrom([played(film({ Id: must(packMovie("kitsu:1555", "anime")), ProviderIds: { Imdb: "tt0123456" } }))]);
    expect(out.films).toEqual(["tt0123456"]);
  });

  it("an item the server says is not played is not played", () => {
    const out = playedFrom([
      { ...film(), UserData: { Played: false, PlaybackPositionTicks: 5 * MIN } },
      { ...episode(), UserData: { Played: false } },
    ]);
    expect(out).toEqual({ episodes: {}, films: [], skipped: 0 });
  });

  it("an item with no UserData is taken on the filter's word", () => {
    const { UserData: _drop, ...bare } = film();
    expect(playedFrom([bare]).films).toEqual(["tt0111161"]);
  });

  it("nothing in, nothing out", () => {
    expect(playedFrom([])).toEqual({ episodes: {}, films: [], skipped: 0 });
  });
});

describe("upNextFrom", () => {
  // /Shows/NextUp (library.ts:898) and /Shows/Upcoming (library.ts:1141) send
  // episodes as buildEpisode makes them, and Upcoming adds films that premiere
  // ahead (library.ts datedFilm). Both are in the server's order.
  const unaired = (over: BaseItem = {}) =>
    episode({
      Id: must(packEpisode("tt0944947:9:1")),
      SeriesId: must(packSeries("tt0944947")),
      SeriesName: "Fable",
      Name: "The Return",
      ParentIndexNumber: 9,
      IndexNumber: 1,
      PremiereDate: "2026-11-02T01:00:00.000Z",
      UserData: { PlaybackPositionTicks: 0, Played: false },
      ...over,
    });

  it("a card: the series, the episode, the label, the poster, when it airs", () => {
    const series = must(packSeries("tt0903747"));
    expect(upNextFrom([episode()])).toEqual([
      {
        seriesId: "tt0903747",
        episodeId: "tt0903747:3:7",
        seriesTitle: "Breaking Bad",
        label: "S3 · E7: Fly",
        imagePath: `/Items/${series}/Images/Primary?tag=abcdefghijk1aHR0cHM6Ly9leGFtcGxlLmNvbS9wLmpwZw`,
        airsAt: T("2010-05-09T00:00:00Z"),
      },
    ]);
  });

  it("the label reads as Continue Watching's does", () => {
    expect(upNextFrom([unaired()])[0].label).toBe(episodeLabel(9, 1, "The Return"));
    expect(upNextFrom([unaired()])[0].label).toBe("S9 · E1: The Return");
  });

  it("an episode with no title: just the numbers", () => {
    expect(upNextFrom([unaired({ Name: undefined })])[0].label).toBe("S9 · E1");
  });

  it("an upcoming episode: the time it airs", () => {
    expect(upNextFrom([unaired()])[0].airsAt).toBe(T("2026-11-02T01:00:00Z"));
  });

  it("no premiere date, no airsAt", () => {
    expect(upNextFrom([unaired({ PremiereDate: undefined })])[0]).not.toHaveProperty("airsAt");
    expect(upNextFrom([unaired({ PremiereDate: "soon" })])[0]).not.toHaveProperty("airsAt");
  });

  it("no poster tag, or no series id to ask it of, no imagePath", () => {
    expect(upNextFrom([episode({ SeriesPrimaryImageTag: undefined })])[0]).not.toHaveProperty("imagePath");
    expect(upNextFrom([episode({ SeriesPrimaryImageTag: "" })])[0]).not.toHaveProperty("imagePath");
    // The series id still reads from the episode's own, but the poster has
    // nothing to be asked of.
    const [card] = upNextFrom([episode({ SeriesId: undefined })]);
    expect(card.seriesId).toBe("tt0903747");
    expect(card).not.toHaveProperty("imagePath");
  });

  it("the tag is escaped into the path", () => {
    expect(upNextFrom([episode({ SeriesPrimaryImageTag: "a+b/c=" })])[0].imagePath).toMatch(/\?tag=a%2Bb%2Fc%3D$/);
  });

  it("the image path names the item as the server does, packed, not BlammyTV's id", () => {
    const [card] = upNextFrom([episode()]);
    expect(card.imagePath?.startsWith(`/Items/${must(packSeries("tt0903747"))}/Images/Primary`)).toBe(true);
    expect(card.imagePath).not.toContain("tt0903747");
  });

  it("a Kitsu episode", () => {
    const [card] = upNextFrom([
      episode({
        Id: must(packEpisode("kitsu:7442:5", { type: "anime" })),
        SeriesId: must(packSeries("kitsu:7442", "anime")),
        ParentIndexNumber: 1,
        IndexNumber: 5,
      }),
    ]);
    expect(card).toMatchObject({ seriesId: "kitsu:7442", episodeId: "kitsu:7442:5", label: "S1 · E5: Fly" });
  });

  it("a film that premieres ahead is not a card; nor is what does not decode", () => {
    const items = [
      film({ PremiereDate: "2026-12-25T00:00:00.000Z" }),
      unaired({ Id: "b2" + "0".repeat(30) }),
      unaired({ SeriesName: undefined }),
      { Id: must(packSeries("tt0944947")), Type: "Series", Name: "Fable" },
      unaired(),
    ];
    expect(upNextFrom(items).map((c) => c.episodeId)).toEqual(["tt0944947:9:1"]);
  });

  it("keeps the server's order", () => {
    const a = unaired();
    const b = episode();
    expect(upNextFrom([a, b]).map((c) => c.seriesId)).toEqual(["tt0944947", "tt0903747"]);
    expect(upNextFrom([b, a]).map((c) => c.seriesId)).toEqual(["tt0903747", "tt0944947"]);
  });

  it("nothing in, nothing out", () => {
    expect(upNextFrom([])).toEqual([]);
  });
});

describe("skipsFrom", () => {
  // /MediaSegments/{id} (server/src/routes/jellyfin/segments.ts:82-97): each
  // item has Id, ItemId, Type (Intro, Recap or Outro), StartTicks, EndTicks.
  const seg = (Type: string, start: number, end: number) => ({
    Id: "0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f0f",
    ItemId: "a141020000000dca4300030007000000",
    Type,
    StartTicks: start * 10_000_000,
    EndTicks: end * 10_000_000,
  });
  const answer = (...Items: unknown[]) => ({ Items, TotalRecordCount: Items.length, StartIndex: 0 });

  it("Intro is op, Recap is recap, Outro is ed, in seconds", () => {
    const out: SkipRange[] = skipsFrom(answer(seg("Intro", 62.5, 92), seg("Recap", 0, 60), seg("Outro", 2500, 2700)));
    expect(out).toEqual([
      { type: "recap", start: 0, end: 60 },
      { type: "op", start: 62.5, end: 92 },
      { type: "ed", start: 2500, end: 2700 },
    ]);
  });

  it("sorted by start, whatever order the server sent", () => {
    const out = skipsFrom(answer(seg("Outro", 2500, 2700), seg("Intro", 62, 92), seg("Recap", 0, 60)));
    expect(out.map((r) => r.type)).toEqual(["recap", "op", "ed"]);
  });

  it("any other type is dropped", () => {
    const out = skipsFrom(
      answer(seg("Commercial", 100, 200), seg("Intro", 10, 20), seg("Preview", 0, 5), seg("Unknown", 1, 2), seg("intro", 30, 40), seg("", 1, 2), seg("constructor", 1, 2), seg("toString", 1, 2)),
    );
    expect(out).toEqual([{ type: "op", start: 10, end: 20 }]);
  });

  it("a marker that does not end after it starts is dropped", () => {
    const out = skipsFrom(answer(seg("Intro", 50, 50), seg("Recap", 60, 10), seg("Outro", 100, 200)));
    expect(out).toEqual([{ type: "ed", start: 100, end: 200 }]);
  });

  it("an open-ended marker (no end) is dropped", () => {
    const out = skipsFrom(answer({ Type: "Outro", StartTicks: 1_000_000_000 }, { Type: "Outro", StartTicks: 1_000_000_000, EndTicks: 0 }, seg("Intro", 5, 9)));
    expect(out).toEqual([{ type: "op", start: 5, end: 9 }]);
  });

  it("a marker with ticks that are not numbers is dropped", () => {
    const out = skipsFrom(
      answer({ Type: "Intro", StartTicks: "10", EndTicks: "20" }, { Type: "Intro", StartTicks: null, EndTicks: 5 }, { Type: "Intro", StartTicks: NaN, EndTicks: 5 }, seg("Intro", 5, 9)),
    );
    expect(out).toEqual([{ type: "op", start: 5, end: 9 }]);
  });

  it("junk among the items is passed over", () => {
    expect(skipsFrom(answer(null, undefined, 7, "x", [], {}, seg("Intro", 5, 9)))).toEqual([{ type: "op", start: 5, end: 9 }]);
  });

  it("an answer with nothing in it, or not an answer", () => {
    expect(skipsFrom(answer())).toEqual([]);
    expect(skipsFrom({ Items: [] })).toEqual([]);
    expect(skipsFrom({})).toEqual([]);
    expect(skipsFrom({ Items: "none" })).toEqual([]);
    expect(skipsFrom({ Items: { length: 1 } })).toEqual([]);
    expect(skipsFrom(null)).toEqual([]);
    expect(skipsFrom(undefined)).toEqual([]);
    expect(skipsFrom("Intro")).toEqual([]);
    expect(skipsFrom(42)).toEqual([]);
  });
});
