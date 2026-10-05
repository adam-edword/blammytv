import { describe, expect, it } from "vitest";
import { catalogsFromManifest } from "../../data/aiostreams";
import type { CatalogDef } from "../../data/stremio";
import { pickCatalogs, pickSearchCatalogs, servesGenre } from "../discover/data";
import { groupSources, mapSeasons, mapStreams, metaPreviewToVod, metaToVod } from "../stream/mapper";
import { catalogOf, metaDetailOf, metaPreviewOf, SEARCH_CATALOGS, streamsOf, type SourceItem } from "./browse";
import { packEpisode, packMovie, packSeries } from "./ids";
import { stremioIdOf, type BaseItem } from "./rules";

function must<V>(v: V | null | undefined): V {
  if (v == null) throw new Error("a fixture did not decode");
  return v;
}

const MIN = 600_000_000; // a minute of ticks
const BASE = "https://aio.example.com/jellyfin";

// Fixtures are shaped from AIOStreams v2.35.9's own builders, packages/
// core/src/jellyfin/dto.ts and media.ts, and cut to the fields browse.ts
// reads. The image tags look like imageTagsFor's (images.ts:60-97): an
// 11-character signature, a host code, then the rest of the URL in base64url.
const POSTER = "abcdefghijk2dzUwMC9zaGF3c2hhbmsuanBn";
const BACKDROP = "bcdefghijkl2b3JpZ2luYWwvc2hhd3NoYW5rLWJnLmpwZw";
const LOGO = "cdefghijklm4ZmFuYXJ0L3NoYXdzaGFuay1sb2dvLnBuZw";

// A view, as buildView makes it (dto.ts:335-357): Path at 352, and the
// `aiostreams` marker at 354 only when the genre extra is required. Its id is
// a2 + 15 bytes of a hash (ids.ts:viewId), nothing to unpack.
const view = (over: BaseItem = {}): BaseItem => ({
  Id: "a2" + "1".repeat(30),
  Name: "Popular Movies",
  Type: "CollectionFolder",
  Path: "/aiostreams/movie/tmdb.top",
  ...over,
});

// A film, as buildContentItem makes it (dto.ts:470-557): Overview at 514,
// ProductionYear 516, CommunityRating 519, RunTimeTicks 523, Genres 524,
// People 538 (peopleDtos, :274-292), the image tags 547, and Path at 555 with
// the playable extension on a film.
const film = (over: BaseItem = {}): BaseItem => ({
  Id: must(packMovie("tt0111161")),
  Type: "Movie",
  Name: "The Shawshank Redemption",
  Overview: "Two imprisoned men bond over a number of years.",
  ProductionYear: 1994,
  CommunityRating: 9.3,
  RunTimeTicks: 142 * MIN,
  Genres: ["Drama", "Crime"],
  People: [
    { Name: "Tim Robbins", Type: "Actor" },
    { Name: "Morgan Freeman", Type: "Actor" },
    { Name: "Frank Darabont", Type: "Director" },
  ],
  ImageTags: { Primary: POSTER, Logo: LOGO },
  BackdropImageTags: [BACKDROP],
  Path: "/aiostreams/movie/tt0111161/The Shawshank Redemption.mkv",
  ...over,
});

// A show, the same builder as a Series: no extension on a folder's Path.
const show = (over: BaseItem = {}): BaseItem => ({
  Id: must(packSeries("tt0903747")),
  Type: "Series",
  Name: "Breaking Bad",
  Overview: "A chemistry teacher turns to crime.",
  ProductionYear: 2008,
  CommunityRating: 9.5,
  RunTimeTicks: 47 * MIN,
  Genres: ["Drama"],
  People: [{ Name: "Bryan Cranston", Type: "Actor" }],
  ImageTags: { Primary: POSTER },
  BackdropImageTags: [BACKDROP],
  Path: "/aiostreams/series/tt0903747/Breaking Bad",
  ...over,
});

// An episode, as buildEpisode makes it (dto.ts:714-): the status at 748,
// IndexNumber and ParentIndexNumber at 750-751, Overview 757, PremiereDate
// 758, the Primary image 764. The id packs when the video id is `tt…:S:E`.
const episode = (over: BaseItem = {}): BaseItem => ({
  Id: must(packEpisode("tt0903747:1:1")),
  Type: "Episode",
  Name: "Pilot",
  IndexNumber: 1,
  ParentIndexNumber: 1,
  PremiereDate: "2008-01-20T00:00:00.000Z",
  Overview: "Walter White is diagnosed.",
  ImageTags: { Primary: POSTER },
  ...over,
});

describe("catalogOf", () => {
  it("the type and id come from the Path, the name from Name, and skip is always there", () => {
    expect(catalogOf(view())).toEqual({
      type: "movie",
      id: "tmdb.top",
      name: "Popular Movies",
      extra: [{ name: "genre" }, { name: "skip" }],
    });
  });

  it("genres given: a genre extra with them as its options, before skip", () => {
    expect(catalogOf(view(), ["Action", "Drama"])?.extra).toEqual([
      { name: "genre", options: ["Action", "Drama"] },
      { name: "skip" },
    ]);
  });

  it("the genre extra is required when AIOStreams says so (dto.ts:354)", () => {
    const required = view({ aiostreams: { genreRequired: true } });
    expect(catalogOf(required, ["Action"])?.extra).toEqual([
      { name: "genre", isRequired: true, options: ["Action"] },
      { name: "skip" },
    ]);
    // Required with the genres not given: still required, nothing to list.
    expect(catalogOf(required)?.extra).toEqual([{ name: "genre", isRequired: true }, { name: "skip" }]);
  });

  it("an explicit false is not required", () => {
    expect(catalogOf(view({ aiostreams: { genreRequired: false } }), ["Action"])?.extra?.[0]).toEqual({
      name: "genre",
      options: ["Action"],
    });
  });

  it("no genres, or an empty list, and none required: a movie or series view still takes a genre, with no options", () => {
    // Discover reads a genre extra with no options as "serves any genre"; with
    // none it benches the catalog from every genre page. AIOStreams answers an
    // empty page for a genre a catalog cannot serve, so claiming it is safe.
    for (const type of ["movie", "series"]) {
      const v = view({ Path: `/aiostreams/${type}/some.catalog` });
      expect(catalogOf(v)?.extra, type).toEqual([{ name: "genre" }, { name: "skip" }]);
      expect(catalogOf(v, [])?.extra, type).toEqual([{ name: "genre" }, { name: "skip" }]);
    }
    expect(catalogOf(view(), ["", "Action"])?.extra?.[0]).toEqual({ name: "genre", options: ["Action"] });
  });

  it("a type Discover does not browse claims a genre only with options, or when it is required", () => {
    const anime = view({ Path: "/aiostreams/anime/kitsu.trending" });
    expect(catalogOf(anime)?.extra).toEqual([{ name: "skip" }]);
    expect(catalogOf(anime, [])?.extra).toEqual([{ name: "skip" }]);
    expect(catalogOf(anime, ["Mecha"])?.extra).toEqual([{ name: "genre", options: ["Mecha"] }, { name: "skip" }]);
    expect(catalogOf({ ...anime, aiostreams: { genreRequired: true } })?.extra).toEqual([
      { name: "genre", isRequired: true },
      { name: "skip" },
    ]);
  });

  it("never a search extra: search is SEARCH_CATALOGS", () => {
    for (const c of [catalogOf(view()), catalogOf(view(), ["A"]), catalogOf(view({ aiostreams: { genreRequired: true } }), ["A"])]) {
      expect(c?.extra?.some((e) => e.name === "search")).toBe(false);
    }
  });

  it("a catalog id with dots, colons or slashes is kept whole", () => {
    expect(catalogOf(view({ Path: "/aiostreams/series/mdblist.12345" }))?.id).toBe("mdblist.12345");
    expect(catalogOf(view({ Path: "/aiostreams/anime/kitsu:trending" }))).toMatchObject({ type: "anime", id: "kitsu:trending" });
    expect(catalogOf(view({ Path: "/aiostreams/movie/lists/top 250" }))?.id).toBe("lists/top 250");
  });

  it("a view with no name is called by its id, as the manifest path does", () => {
    expect(catalogOf(view({ Name: undefined }))?.name).toBe("tmdb.top");
    expect(catalogOf(view({ Name: "" }))?.name).toBe("tmdb.top");
  });

  it("a view whose Path does not parse: null", () => {
    for (const Path of [undefined, "", "/aiostreams/", "/aiostreams/movie", "/aiostreams/movie/", "/aiostreams//tmdb.top", "/other/movie/tmdb.top", "movie/tmdb.top"]) {
      expect(catalogOf(view({ Path })), String(Path)).toBeNull();
    }
  });

  it("is read the way the manifest path reads a catalog: a required genre is no row, the rest are", () => {
    const plain = must(catalogOf(view({ Path: "/aiostreams/movie/a" }), ["Action", "Drama"]));
    const series = must(catalogOf(view({ Path: "/aiostreams/series/b" })));
    const needsGenre = must(catalogOf(view({ Path: "/aiostreams/movie/c", aiostreams: { genreRequired: true } }), ["Action"]));
    const picked = pickCatalogs([plain, series, needsGenre]);
    expect(picked.map((c) => c.id)).toEqual(["a", "b"]);
    expect(picked[0]).toEqual({ type: "movie", id: "a", genreCapable: true, genres: ["Action", "Drama"] });
    expect(picked[1]).toEqual({ type: "series", id: "b", genreCapable: true, genres: [] });
  });

  it("a catalog with no options is not benched from a genre page: Discover reads it as any genre", () => {
    // The bug data.ts `servesGenre` was written against: a genre extra with no
    // options, read as one that serves nothing, left Discover's genre pages to
    // the few catalogs that listed their genres.
    const bare = must(pickCatalogs([must(catalogOf(view({ Path: "/aiostreams/movie/bare" })))])[0]);
    const listed = must(pickCatalogs([must(catalogOf(view({ Path: "/aiostreams/movie/listed" }), ["Drama"]))])[0]);
    expect(servesGenre(bare, "Action")).toBe(true);
    expect(servesGenre(listed, "Action")).toBe(false);
    expect(servesGenre(listed, "Drama")).toBe(true);
  });
});

describe("SEARCH_CATALOGS", () => {
  it("one per type Discover searches, each with a required search extra and nothing else", () => {
    expect(SEARCH_CATALOGS.map((c) => c.type)).toEqual(["movie", "series"]);
    for (const c of SEARCH_CATALOGS) expect(c.extra).toEqual([{ name: "search", isRequired: true }]);
  });

  it("ids that a config's catalog cannot have", () => {
    expect(SEARCH_CATALOGS.map((c) => c.id)).toEqual(["aiojf.search.movie", "aiojf.search.series"]);
    for (const c of SEARCH_CATALOGS) expect(c.id.startsWith("aiojf.search.")).toBe(true);
  });

  it("Discover asks them for a search (pickSearchCatalogs)", () => {
    expect(pickSearchCatalogs(SEARCH_CATALOGS)).toEqual([
      { type: "movie", id: "aiojf.search.movie", genreCapable: false, genres: [] },
      { type: "series", id: "aiojf.search.series", genreCapable: false, genres: [] },
    ]);
  });

  it("and nothing shows them as a row: not Discover's grid, not the Stream tab's hero", () => {
    // pickCatalogs and source.ts' isBrowseable are the same test: no required extra.
    expect(pickCatalogs(SEARCH_CATALOGS)).toEqual([]);
    expect(catalogsFromManifest({ catalogs: SEARCH_CATALOGS })).toEqual([]);
  });

  it("beside real catalogs they add to search and take nothing from the rows", () => {
    const real: CatalogDef[] = [must(catalogOf(view({ Path: "/aiostreams/movie/a" }))), must(catalogOf(view({ Path: "/aiostreams/series/b" })))];
    const all = [...real, ...SEARCH_CATALOGS];
    expect(pickCatalogs(all).map((c) => c.id)).toEqual(["a", "b"]);
    expect(pickSearchCatalogs(all).map((c) => c.id)).toEqual(["aiojf.search.movie", "aiojf.search.series"]);
    expect(catalogsFromManifest({ catalogs: all }).map((c) => c.key)).toEqual(["movie/a", "series/b"]);
  });
});

describe("stremioIdOf", () => {
  it("a film: its type and id from the Path, the id the third segment", () => {
    expect(stremioIdOf(film())).toEqual({ type: "movie", id: "tt0111161" });
  });

  it("a show", () => {
    expect(stremioIdOf(show())).toEqual({ type: "series", id: "tt0903747" });
  });

  it("a name with a slash in it does not move the id", () => {
    expect(stremioIdOf(film({ Name: "Face/Off", Path: "/aiostreams/movie/tt0119094/Face/Off.mkv", Id: must(packMovie("tt0119094")) }))).toEqual({
      type: "movie",
      id: "tt0119094",
    });
    expect(stremioIdOf(show({ Path: "/aiostreams/series/tt0903747/A/B/C" }))).toEqual({ type: "series", id: "tt0903747" });
  });

  it("an id AIOStreams hashed has only its Path to read, and that is enough", () => {
    // An addon's own id scheme: the item's id is b2 + a hash, not packed.
    const hashed = film({ Id: "b2" + "0".repeat(30), Path: "/aiostreams/movie/yt:dQw4w9WgXcQ/Rick.mkv" });
    expect(stremioIdOf(hashed)).toEqual({ type: "movie", id: "yt:dQw4w9WgXcQ" });
  });

  it("the type is the Stremio type the title is listed under, not the Jellyfin kind", () => {
    // A show in an anime catalog: Series in Jellyfin, `anime` in Stremio.
    const anime = show({ Id: must(packSeries("kitsu:7442", "anime")), Path: "/aiostreams/anime/kitsu:7442/Cowboy Bebop" });
    expect(stremioIdOf(anime)).toEqual({ type: "anime", id: "kitsu:7442" });
    // A leaf `tv` entry is a Movie in Jellyfin (isLeafEntry, dto.ts:428-441).
    expect(stremioIdOf(film({ Id: "b2" + "0".repeat(30), Path: "/aiostreams/tv/ch-1/News.mkv" }))).toEqual({ type: "tv", id: "ch-1" });
  });

  it("a collection entry is a title too: a catalog named for collections lists films as BoxSets", () => {
    expect(stremioIdOf(film({ Type: "BoxSet", Path: "/aiostreams/movie/tt0111161/The Shawshank Redemption" }))).toEqual({
      type: "movie",
      id: "tt0111161",
    });
    // Its own id is packed as a collection (kind 5), which tryPack returns for
    // `{ k: "boxset", t: "movie", i: "tmdb:603" }` and reads back the same.
    const boxset = film({ Type: "BoxSet", Id: "a1520100000000025bffffffff000000", Path: "/aiostreams/movie/tmdb:603/The Matrix" });
    expect(stremioIdOf(boxset)).toEqual({ type: "movie", id: "tmdb:603" });
    expect(stremioIdOf({ ...boxset, Path: undefined })).toEqual({ type: "movie", id: "tmdb:603" });
  });

  it("the packed id alone is enough when the Path cannot be read", () => {
    expect(stremioIdOf(film({ Path: undefined }))).toEqual({ type: "movie", id: "tt0111161" });
    expect(stremioIdOf(film({ Path: "/elsewhere/movie/tt0111161/x.mkv" }))).toEqual({ type: "movie", id: "tt0111161" });
    expect(stremioIdOf(film({ Path: "/aiostreams/movie//x.mkv" }))).toEqual({ type: "movie", id: "tt0111161" });
  });

  it("a Path and a packed id that disagree: neither is trusted", () => {
    // The id says tt0903747, the Path tt0111161.
    expect(stremioIdOf(film({ Id: must(packMovie("tt0903747")) }))).toBeNull();
    // The same id under another type.
    expect(stremioIdOf(film({ Id: must(packMovie("tt0111161", "series")) }))).toBeNull();
    expect(stremioIdOf(film({ Id: must(packMovie("tt0111161", "anime")) }))).toBeNull();
  });

  it("neither reads: null", () => {
    expect(stremioIdOf(film({ Id: "b2" + "0".repeat(30), Path: undefined }))).toBeNull();
    expect(stremioIdOf(film({ Id: undefined, Path: "movie/tt0111161" }))).toBeNull();
    expect(stremioIdOf(film({ Id: "not an id", Path: "" }))).toBeNull();
  });

  it("a packed id that is not a title's (a season, an episode) is no help", () => {
    expect(stremioIdOf(film({ Id: must(packEpisode("tt0111161:1:1")), Path: undefined }))).toBeNull();
  });

  it("anything that is not a film or a show: null, whatever its Path says", () => {
    for (const Type of ["Episode", "Season", "CollectionFolder", "Genre", "Person", "", undefined]) {
      expect(stremioIdOf(film({ Type })), String(Type)).toBeNull();
    }
    // An episode's Path starts like a show's (dto.ts:719); it must not pass for it.
    expect(stremioIdOf(episode({ Path: "/aiostreams/series/tt0903747/Season 1/Pilot.mkv" }))).toBeNull();
  });
});

describe("metaPreviewOf", () => {
  it("a film, every field", () => {
    expect(metaPreviewOf(film(), BASE)).toEqual({
      id: "tt0111161",
      type: "movie",
      name: "The Shawshank Redemption",
      poster: `${BASE}/Items/${must(packMovie("tt0111161"))}/Images/Primary?tag=${POSTER}`,
      background: `${BASE}/Items/${must(packMovie("tt0111161"))}/Images/Backdrop/0?tag=${BACKDROP}`,
      logo: `${BASE}/Items/${must(packMovie("tt0111161"))}/Images/Logo?tag=${LOGO}`,
      imdbRating: 9.3,
      releaseInfo: "1994",
      runtime: "142 min",
      description: "Two imprisoned men bond over a number of years.",
      genres: ["Drama", "Crime"],
    });
  });

  it("a show", () => {
    expect(metaPreviewOf(show(), BASE)).toMatchObject({
      id: "tt0903747",
      type: "series",
      name: "Breaking Bad",
      releaseInfo: "2008",
      runtime: "47 min",
      imdbRating: 9.5,
    });
  });

  it("the base's trailing slash does not double, and a tag is escaped", () => {
    const p = metaPreviewOf(film({ ImageTags: { Primary: "a/b+c" } }), `${BASE}//`);
    expect(p?.poster).toBe(`${BASE}/Items/${must(packMovie("tt0111161"))}/Images/Primary?tag=a%2Fb%2Bc`);
  });

  it("a field the item lacks is left out, not set to nothing", () => {
    const bare = metaPreviewOf({ Id: must(packMovie("tt0111161")), Type: "Movie", Name: "Bare", Path: "/aiostreams/movie/tt0111161/Bare.mkv" }, BASE);
    expect(bare).toEqual({ id: "tt0111161", type: "movie", name: "Bare" });
    expect(Object.keys(bare as object).sort()).toEqual(["id", "name", "type"]);
  });

  it("an image is only there with its tag; the backdrop is the first of its tags", () => {
    const p = metaPreviewOf(film({ ImageTags: {}, BackdropImageTags: [] }), BASE);
    expect(p).not.toHaveProperty("poster");
    expect(p).not.toHaveProperty("logo");
    expect(p).not.toHaveProperty("background");
    expect(metaPreviewOf(film({ BackdropImageTags: ["first", "second"] }), BASE)?.background).toContain("?tag=first");
  });

  it("a rating of zero, a runtime under a minute, a year that is not a number: left out", () => {
    const p = metaPreviewOf(film({ CommunityRating: 0, RunTimeTicks: 20 * 10_000_000, ProductionYear: "1994" as unknown as number, Genres: [], Overview: "" }), BASE);
    for (const key of ["imdbRating", "runtime", "releaseInfo", "genres", "description"]) expect(p, key).not.toHaveProperty(key);
  });

  it("a runtime is rounded to the minute, as mapper's parseRuntime wants it", () => {
    expect(metaPreviewOf(film({ RunTimeTicks: 89.6 * MIN }), BASE)?.runtime).toBe("90 min");
    expect(metaPreviewOf(film({ RunTimeTicks: 169 * MIN }), BASE)?.runtime).toBe("169 min");
  });

  it("null when there is no name, or the item is not a title that reads", () => {
    expect(metaPreviewOf(film({ Name: undefined }), BASE)).toBeNull();
    expect(metaPreviewOf(film({ Name: "" }), BASE)).toBeNull();
    expect(metaPreviewOf(episode(), BASE)).toBeNull();
    expect(metaPreviewOf(film({ Id: "b2" + "0".repeat(30), Path: undefined }), BASE)).toBeNull();
  });

  it("reads through mapper.ts into the same VodItem a manifest meta would", () => {
    const id = must(packMovie("tt0111161"));
    expect(metaPreviewToVod(must(metaPreviewOf(film(), BASE)))).toEqual({
      id: "tt0111161",
      title: "The Shawshank Redemption",
      kind: "movie",
      year: 1994,
      poster: `${BASE}/Items/${id}/Images/Primary?tag=${POSTER}`,
      backdrop: `${BASE}/Items/${id}/Images/Backdrop/0?tag=${BACKDROP}`,
      logo: `${BASE}/Items/${id}/Images/Logo?tag=${LOGO}`,
      rating: 9.3,
      runtimeMin: 142,
      synopsis: "Two imprisoned men bond over a number of years.",
      genres: ["Drama", "Crime"],
      cast: [],
      seasons: [],
    });
    expect(metaPreviewToVod(must(metaPreviewOf(show(), BASE))).kind).toBe("series");
  });
});

describe("metaDetailOf", () => {
  it("a film: the preview, and the actors by name (not the director)", () => {
    const d = must(metaDetailOf(film(), [], BASE));
    expect(d).toMatchObject({ id: "tt0111161", type: "movie", name: "The Shawshank Redemption", runtime: "142 min" });
    expect(d.cast).toEqual(["Tim Robbins", "Morgan Freeman"]);
    expect(d).not.toHaveProperty("videos");
  });

  it("no actors: no cast key", () => {
    expect(metaDetailOf(film({ People: [{ Name: "Frank Darabont", Type: "Director" }] }), [], BASE)).not.toHaveProperty("cast");
    expect(metaDetailOf(film({ People: undefined }), [], BASE)).not.toHaveProperty("cast");
  });

  it("a show: its episodes as videos, in the server's order", () => {
    const eps = [
      episode(),
      episode({ Id: must(packEpisode("tt0903747:1:2")), Name: "Cat's in the Bag...", IndexNumber: 2, PremiereDate: "2008-01-27T00:00:00.000Z" }),
      episode({ Id: must(packEpisode("tt0903747:2:1")), Name: "Seven Thirty-Seven", IndexNumber: 1, ParentIndexNumber: 2 }),
    ];
    const d = must(metaDetailOf(show(), eps, BASE));
    expect(d.videos?.map((v) => [v.id, v.season, v.episode, v.title])).toEqual([
      ["tt0903747:1:1", 1, 1, "Pilot"],
      ["tt0903747:1:2", 1, 2, "Cat's in the Bag..."],
      ["tt0903747:2:1", 2, 1, "Seven Thirty-Seven"],
    ]);
  });

  it("a video carries its title, premiere, overview and still", () => {
    const d = must(metaDetailOf(show(), [episode()], BASE));
    expect(d.videos).toEqual([
      {
        id: "tt0903747:1:1",
        season: 1,
        episode: 1,
        title: "Pilot",
        released: "2008-01-20T00:00:00.000Z",
        thumbnail: `${BASE}/Items/${must(packEpisode("tt0903747:1:1"))}/Images/Primary?tag=${POSTER}`,
        overview: "Walter White is diagnosed.",
      },
    ]);
  });

  it("an episode's id is its Stremio id for every packed type", () => {
    const ids = ["tt0903747:3:7", "tmdb:1396:3:7", "tvdb:81189:2:5", "kitsu:7442:5", "mal:16498:4", "anilist:16498:2", "anidb:9541:3", "simkl:12345:2"];
    const eps = ids.map((id, i) =>
      episode({ Id: must(packEpisode(id, { type: "anime" })), IndexNumber: i + 1, ParentIndexNumber: 1, Name: id }),
    );
    expect(must(metaDetailOf(show(), eps, BASE)).videos?.map((v) => v.id)).toEqual(ids);
  });

  it("an episode AIOStreams hashed gets an opaque aiojf: id, with its numbers from the item", () => {
    const hashed = episode({ Id: "b2" + "7".repeat(30), IndexNumber: 4, ParentIndexNumber: 2 });
    expect(must(metaDetailOf(show(), [hashed], BASE)).videos).toMatchObject([{ id: `aiojf:b2${"7".repeat(30)}`, season: 2, episode: 4 }]);
  });

  it("numbers the server left out come from the packed id; with neither the episode is left out", () => {
    const packed = episode({ IndexNumber: undefined, ParentIndexNumber: undefined });
    expect(must(metaDetailOf(show(), [packed], BASE)).videos).toMatchObject([{ id: "tt0903747:1:1", season: 1, episode: 1 }]);
    const neither = episode({ Id: "b2" + "7".repeat(30), IndexNumber: undefined, ParentIndexNumber: undefined });
    const onlySeason = episode({ Id: "b2" + "8".repeat(30), IndexNumber: undefined });
    expect(must(metaDetailOf(show(), [neither, onlySeason], BASE)).videos).toEqual([]);
  });

  it("what is not an episode, or has no id, is left out of the videos", () => {
    const items: BaseItem[] = [
      { Id: "a3" + "1".repeat(30), Type: "Season", Name: "Season 1", IndexNumber: 1 },
      episode({ Id: undefined }),
      { ...episode(), Type: "Movie" },
      episode(),
    ];
    expect(must(metaDetailOf(show(), items, BASE)).videos).toHaveLength(1);
  });

  it("a show with no episodes has an empty list, not a missing one", () => {
    expect(must(metaDetailOf(show(), [], BASE)).videos).toEqual([]);
  });

  it("an unaired episode keeps `available` unset, and the season list still shows it (mapper.ts:229)", () => {
    // buildEpisode marks one 'Virtual' (dto.ts:748) when the config asks it to.
    const unaired: BaseItem & { LocationType: string } = {
      ...episode({ Id: must(packEpisode("tt0903747:6:1")), Name: "Not Yet", ParentIndexNumber: 6, PremiereDate: "2031-01-01T00:00:00.000Z" }),
      LocationType: "Virtual",
    };
    const d = must(metaDetailOf(show(), [episode(), unaired], BASE));
    for (const v of d.videos ?? []) expect(v).not.toHaveProperty("available");
    const seasons = mapSeasons(d.videos ?? []);
    expect(seasons.map((s) => s.number)).toEqual([1, 6]);
    expect(seasons[1].episodes[0]).toMatchObject({ id: "tt0903747:6:1", title: "Not Yet" });
  });

  it("reads through mapper.ts into seasons, cast and runtime, Specials first", () => {
    const eps = [
      episode(),
      episode({ Id: must(packEpisode("tt0903747:0:1")), Name: "Good Cop Bad Cop", IndexNumber: 1, ParentIndexNumber: 0 }),
    ];
    const vod = metaToVod(must(metaDetailOf(show(), eps, BASE)));
    expect(vod).toMatchObject({ id: "tt0903747", kind: "series", year: 2008, rating: 9.5, runtimeMin: 47, cast: ["Bryan Cranston"] });
    expect(vod.seasons.map((s) => [s.name, s.episodes.map((e) => e.id)])).toEqual([
      ["Specials", ["tt0903747:0:1"]],
      ["Season 1", ["tt0903747:1:1"]],
    ]);
    expect(vod.seasons[1].episodes[0].airDate).toBe("Jan 20, 2008");
    expect(vod.seasons[1].episodes[0].still).toContain("/Images/Primary?tag=");
  });

  it("every actor is passed on; mapper keeps the first 20", () => {
    const people = Array.from({ length: 25 }, (_, i) => ({ Name: `Actor ${i + 1}`, Type: "Actor" }));
    const d = must(metaDetailOf(film({ People: people }), [], BASE));
    expect(d.cast).toHaveLength(25);
    expect(metaToVod(d).cast).toHaveLength(20);
  });

  it("null when the item does not read as a title", () => {
    expect(metaDetailOf(episode(), [], BASE)).toBeNull();
    expect(metaDetailOf(film({ Name: undefined }), [], BASE)).toBeNull();
  });
});

// A media source as buildMediaSource makes it (media.ts:576-615): Path is the
// stream's URL at 597, Type 'Default' at 598, Container 599, Size 600, Name
// the label at 601 (label.ts:46-56: name and description joined), and the
// extension from extensionFor (media.ts:133-163) with the msid as `id`, at
// 612-613.
const GB = 1024 ** 3;
const SIZE = Math.round(4.2 * GB);
const source = (over: SourceItem = {}): SourceItem => ({
  Id: "a6" + "1".repeat(30),
  Path: "https://rd.example.com/d/ABC123/Show.S01E01.1080p.mkv",
  Name: "⚡ [RD+] Torrentio\n1080p BluRay x265 | 4.20 GB",
  Type: "Default",
  Size: SIZE,
  Container: "mkv",
  RunTimeTicks: 45 * MIN,
  IsInfiniteStream: false,
  aiostreams: {
    name: "⚡ [RD+] Torrentio",
    description: "1080p BluRay x265 | 4.20 GB",
    service: "realdebrid",
    cached: true,
    type: "debrid",
    bingeGroup: "Torrentio|1080p|x265",
    filename: "Show.S01E01.1080p.mkv",
  },
  ...over,
});

// A notice, as noticeRecordFrom makes one (media.ts:238-262) and
// placeholderMediaSource shows it (media.ts:643-): Type 'Placeholder', and a
// Path that is not a stream.
const notice = (over: SourceItem = {}): SourceItem => ({
  Id: "a6" + "2".repeat(30),
  Path: "",
  Name: "Statistics\nFetched 80 streams in 1.2s",
  Type: "Placeholder",
  aiostreams: { name: "Statistics", description: "Fetched 80 streams in 1.2s", type: "statistic" },
  ...over,
});

describe("streamsOf", () => {
  it("one source as the stream the Stremio side hands over", () => {
    expect(streamsOf([source()])).toEqual([
      {
        name: "⚡ [RD+] Torrentio",
        description: "1080p BluRay x265 | 4.20 GB",
        url: "https://rd.example.com/d/ABC123/Show.S01E01.1080p.mkv",
        behaviorHints: { bingeGroup: "Torrentio|1080p|x265", filename: "Show.S01E01.1080p.mkv", videoSize: SIZE },
        streamData: { type: "debrid", service: { id: "realdebrid", cached: true } },
      },
    ]);
  });

  it("name and description are the formatter's two parts, not the joined Name", () => {
    const [s] = streamsOf([source()]);
    expect(s.name).toBe("⚡ [RD+] Torrentio");
    expect(s.description).toBe("1080p BluRay x265 | 4.20 GB");
    expect(s.name).not.toContain("\n");
  });

  it("keeps only Default sources with an http(s) Path, in the server's order", () => {
    const a = source({ Path: "https://a.example.com/1.mkv", aiostreams: { name: "A" } });
    const b = source({ Path: "http://b.example.com/2.mkv", aiostreams: { name: "B" } });
    const c = source({ Path: "HTTPS://C.EXAMPLE.COM/3.mkv", aiostreams: { name: "C" } });
    const out = streamsOf([
      notice(),
      a,
      source({ Type: "Placeholder", Path: "https://x.example.com/placeholder.mkv", aiostreams: { name: "Placeholder with a URL" } }),
      source({ Path: "magnet:?xt=urn:btih:abc", aiostreams: { name: "magnet" } }),
      b,
      source({ Path: "ftp://f.example.com/x.mkv", aiostreams: { name: "ftp" } }),
      source({ Path: "" , aiostreams: { name: "empty" } }),
      source({ Path: undefined, aiostreams: { name: "none" } }),
      source({ Type: undefined, aiostreams: { name: "no type" } }),
      c,
      notice({ Id: "a6" + "3".repeat(30), Name: "Error", aiostreams: { name: "Error", type: "error" } }),
    ]);
    expect(out.map((s) => s.name)).toEqual(["A", "B", "C"]);
    expect(out.map((s) => s.url)).toEqual(["https://a.example.com/1.mkv", "http://b.example.com/2.mkv", "HTTPS://C.EXAMPLE.COM/3.mkv"]);
  });

  it("nothing playable: an empty list", () => {
    expect(streamsOf([])).toEqual([]);
    expect(streamsOf([notice(), notice({ Id: "a6" + "4".repeat(30) })])).toEqual([]);
  });

  it("an uncached stream says so: cached false is kept, not dropped as falsy", () => {
    const [s] = streamsOf([source({ aiostreams: { name: "RD", service: "realdebrid", cached: false, type: "debrid" } })]);
    expect(s.streamData).toEqual({ type: "debrid", service: { id: "realdebrid", cached: false } });
  });

  it("a direct link has no service: none is claimed", () => {
    const [s] = streamsOf([source({ aiostreams: { name: "Direct", type: "http" } })]);
    expect(s.streamData).toEqual({ type: "http" });
    expect(s.streamData).not.toHaveProperty("service");
  });

  it("autoplay off sends no bingeGroup, and a source with no filename or size sends neither hint", () => {
    const [s] = streamsOf([source({ Size: undefined, aiostreams: { name: "N", description: "D" } })]);
    expect(s.behaviorHints).toEqual({});
  });

  it("a source without AIOStreams' extension falls back to the joined Name, with no description or streamData", () => {
    const [s] = streamsOf([source({ aiostreams: undefined })]);
    expect(s).toEqual({
      name: "⚡ [RD+] Torrentio\n1080p BluRay x265 | 4.20 GB",
      url: "https://rd.example.com/d/ABC123/Show.S01E01.1080p.mkv",
      behaviorHints: { videoSize: SIZE },
    });
  });

  it("an empty name part is kept as it is, so the description alone is not mistaken for the Name", () => {
    const [s] = streamsOf([source({ aiostreams: { name: "", description: "Only a description" } })]);
    expect(s.name).toBe("");
    expect(s.description).toBe("Only a description");
  });

  it("reads through mapper.ts as the Stremio side's streams do: badge, cache and lines", () => {
    const cached = source();
    const uncached = source({
      Path: "https://rd.example.com/d/DEF456/Show.S01E01.2160p.mkv",
      aiostreams: {
        name: "⏳ [RD download] Torrentio",
        description: "2160p WEB-DL HDR\n18.00 GB",
        service: "realdebrid",
        cached: false,
        type: "debrid",
        bingeGroup: "Torrentio|2160p|hevc",
      },
    });
    const direct = source({
      Path: "https://cdn.example.com/x.mp4",
      aiostreams: { name: "Direct 720p", description: "720p", type: "http" },
    });
    const mapped = mapStreams(streamsOf([uncached, notice(), cached, direct]));
    expect(mapped).toHaveLength(3);
    expect(mapped[0]).toMatchObject({ quality: "2160p", cached: false, cache: "uncached", lines: ["2160p WEB-DL HDR", "18.00 GB"], bingeGroup: "Torrentio|2160p|hevc" });
    expect(mapped[1]).toMatchObject({ quality: "1080p", cached: true, cache: "cached", lines: ["1080p BluRay x265 | 4.20 GB"], bingeGroup: "Torrentio|1080p|x265" });
    expect(mapped[1].streamUrl).toBe("https://rd.example.com/d/ABC123/Show.S01E01.1080p.mkv");
    expect(mapped[2]).toMatchObject({ quality: "720p", cached: false, cache: "unknown" });
    // The cache groups come out as AIOStreams' flags put them.
    expect(groupSources(mapped).map((g) => [g.label, g.sources.length])).toEqual([
      ["Cached", 1],
      ["Other sources", 1],
      ["Not cached", 1],
    ]);
  });
});
