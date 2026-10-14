import { describe, expect, it } from "vitest";
import {
  PAGE,
  SEARCH_CATALOGS,
  catalogOf,
  catalogQuery,
  catalogType,
  episodesQuery,
  metaDetailOf,
  metaPreviewOf,
  searchQuery,
  videoOf,
} from "./browse";
import { BASE, EP1, EP2, EP3, FIX, SEVERANCE, ZZZ, ZZZ_EP, item } from "./fixture";

describe("catalogs", () => {
  it("are the movies and shows libraries, by their own id", () => {
    expect(FIX.views.map((v) => v.CollectionType)).toEqual(["movies", "tvshows"]);
    const [movies, shows] = FIX.views.map((v) => catalogOf(v));
    expect(movies).toEqual({ type: "movie", id: FIX.views[0].Id, name: "Movies", extra: [{ name: "genre" }, { name: "skip" }] });
    expect(shows).toMatchObject({ type: "series", id: FIX.views[1].Id, name: "Shows" });
  });

  it("leave out a library Stream does not show", () => {
    for (const t of ["music", "boxsets", "homevideos", "livetv", "books", undefined]) {
      expect(catalogType({ CollectionType: t })).toBeNull();
      expect(catalogOf({ Id: "a".repeat(32), Name: "X", CollectionType: t })).toBeNull();
    }
    expect(catalogOf({ CollectionType: "movies", Id: "a".repeat(32) })).toBeNull();
  });

  it("claim a genre extra with no options (any genre) and never a search extra", () => {
    const c = catalogOf(FIX.views[0]);
    expect(c?.extra?.find((e) => e.name === "genre")).toEqual({ name: "genre" });
    expect(c?.extra?.some((e) => e.name === "search")).toBe(false);
  });

  it("have search catalogs that need a search and cannot clash with a library id", () => {
    for (const s of SEARCH_CATALOGS) {
      expect(s.extra).toEqual([{ name: "search", isRequired: true }]);
      expect(s.id).toMatch(/^jf\./);
    }
  });
});

describe("queries", () => {
  const USER = FIX.items[SEVERANCE] && "d41f6b82a3c94e57b0e8c9a7f2d63b15";
  const movies = catalogOf(FIX.views[0])!;
  const shows = catalogOf(FIX.views[1])!;

  it("always name the types, so a library's folders never come back", () => {
    expect(catalogQuery(USER, movies).IncludeItemTypes).toBe("Movie");
    expect(catalogQuery(USER, shows).IncludeItemTypes).toBe("Series");
    expect(searchQuery(USER, "movie", {}).IncludeItemTypes).toBe("Movie");
    expect(searchQuery(USER, "series", {}).IncludeItemTypes).toBe("Series");
  });

  it("a page is the library, the user, a window and the fields, and nothing credential-like", () => {
    const q = catalogQuery(USER, movies, { skip: 100 });
    expect(q).toMatchObject({
      userId: USER,
      ParentId: movies.id,
      Recursive: "true",
      StartIndex: "100",
      Limit: String(PAGE),
      SortBy: "SortName",
    });
    expect(q.Fields).toContain("ProviderIds");
    for (const k of Object.keys(q)) expect(k.toLowerCase()).not.toMatch(/key|token/);
  });

  it("a search or a genre rides on the query, and a search names no library", () => {
    expect(catalogQuery(USER, shows, { genre: "Drama" }).Genres).toBe("Drama");
    const s = searchQuery(USER, "movie", { search: "turn", skip: 0, limit: 20 });
    expect(s).toMatchObject({ SearchTerm: "turn", Limit: "20", StartIndex: "0" });
    expect("ParentId" in s).toBe(false);
  });

  it("clamp a nonsense window", () => {
    const q = catalogQuery(USER, movies, { skip: -5, limit: 0 });
    expect(q.StartIndex).toBe("0");
    expect(q.Limit).toBe("1");
  });

  it("an episode list asks for the user's data and one picture each", () => {
    expect(episodesQuery(USER)).toMatchObject({ userId: USER, EnableUserData: "true", ImageTypeLimit: "1" });
  });
});

describe("a title as a preview", () => {
  it("carries what the server knows", () => {
    const p = metaPreviewOf(item(SEVERANCE), BASE)!;
    expect(p).toMatchObject({
      id: "tt11280740",
      type: "series",
      name: "Severance",
      imdbRating: 8.394,
      releaseInfo: "2022",
      genres: ["Drama", "Mystery", "Sci-Fi & Fantasy"],
    });
    expect(p.description).toMatch(/^Mark leads a team/);
    expect(p.poster).toMatch(new RegExp(`^${BASE}/Items/${SEVERANCE}/Images/Primary\\?tag=[0-9a-f]+$`));
    expect(p.background).toContain(`/Items/${SEVERANCE}/Images/Backdrop/0?tag=`);
  });

  it("a film is a movie, and a title with nothing matched is still shown under its own key", () => {
    expect(metaPreviewOf(item(FIX.movieId), BASE)).toMatchObject({ id: "tt2043923", type: "movie", name: "The Turn", releaseInfo: "2016" });
    const z = metaPreviewOf(item(ZZZ), BASE)!;
    expect(z).toMatchObject({ id: `jf:${ZZZ}`, type: "series", name: "Zzz Test Show" });
    expect("poster" in z).toBe(false);
    expect("imdbRating" in z).toBe(false);
    expect("runtime" in z).toBe(false);
  });

  it("leaves out a zero rating and a zero runtime", () => {
    const p = metaPreviewOf({ ...item(FIX.movieId), CommunityRating: 0, RunTimeTicks: 0 }, BASE)!;
    expect("imdbRating" in p).toBe(false);
    expect("runtime" in p).toBe(false);
    expect(metaPreviewOf({ ...item(FIX.movieId), RunTimeTicks: 77_400_000_000 }, BASE)?.runtime).toBe("129 min");
  });

  it("is null for what is not a title, or has no name", () => {
    expect(metaPreviewOf(item(EP1), BASE)).toBeNull();
    expect(metaPreviewOf(FIX.junk[0], BASE)).toBeNull();
    expect(metaPreviewOf({ ...item(SEVERANCE), Name: "" }, BASE)).toBeNull();
  });

  it("makes no image URL from an id that is not an item id", () => {
    const p = metaPreviewOf({ ...item(FIX.movieId), Id: "../../x" }, BASE);
    expect(p).toBeNull();
    const q = metaPreviewOf({ ...item(SEVERANCE), ImageTags: { Primary: "a b&c" } }, BASE)!;
    expect(q.poster).toContain("tag=a%20b%26c");
  });
});

describe("a title's detail", () => {
  const eps = [item(EP1), item(EP2), item(EP3)];

  it("lists a show's episodes under its IMDb key", () => {
    const d = metaDetailOf(item(SEVERANCE), eps, BASE)!;
    expect(d.videos?.map((v) => [v.id, v.season, v.episode, v.title])).toEqual([
      ["tt11280740:1:1", 1, 1, "Good News About Hell"],
      ["tt11280740:1:2", 1, 2, "Half Loop"],
      ["tt11280740:1:3", 1, 3, "In Perpetuity"],
    ]);
    expect(d.cast?.length).toBeGreaterThan(0);
  });

  it("gives a show with no IMDb id its episodes' own ids", () => {
    const d = metaDetailOf(item(ZZZ), [item(ZZZ_EP)], BASE)!;
    expect(d.videos?.map((v) => v.id)).toEqual([`jf:${ZZZ_EP}`]);
  });

  it("gives a film no videos and cast only from actors", () => {
    const m = { ...item(FIX.movieId), People: [{ Name: "A", Type: "Actor" }, { Name: "B", Type: "Director" }] };
    const d = metaDetailOf(m, [], BASE)!;
    expect(d.cast).toEqual(["A"]);
    expect("videos" in d).toBe(false);
  });

  it("an episode is a video with its still, air date and runtime; one without numbers is left out", () => {
    const v = videoOf(item(EP3), "tt11280740", BASE)!;
    expect(v).toMatchObject({ id: "tt11280740:1:3", season: 1, episode: 3, title: "In Perpetuity", runtime: "10 min" });
    expect(videoOf({ ...item(EP3), IndexNumber: undefined }, "tt11280740", BASE)).toBeNull();
    expect(videoOf(item(SEVERANCE), "tt11280740", BASE)).toBeNull();
  });

  it("does not set `available`, so an unaired episode still shows", () => {
    expect("available" in videoOf(item(EP1), "tt11280740", BASE)!).toBe(false);
  });
});
