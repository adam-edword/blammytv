import { describe, expect, it } from "vitest";
import { catalogsFromManifest } from "./aiostreams";
import { liveCategoriesUrl } from "./xtream";
import { addonBase, encSegment } from "./stremio";

describe("catalogsFromManifest", () => {
  it("maps catalogs to keyed entries and skips malformed ones", () => {
    const catalogs = catalogsFromManifest({
      catalogs: [
        { type: "movie", id: "top", name: "Top Movies" },
        { type: "series", id: "trending" },
        { name: "no id or type" },
      ],
    });
    expect(catalogs).toEqual([
      { key: "movie/top", type: "movie", name: "Top Movies" },
      { key: "series/trending", type: "series", name: "trending" },
    ]);
  });

  it("handles a manifest without catalogs", () => {
    expect(catalogsFromManifest({})).toEqual([]);
  });

  it("omits search-only catalogs (required search extra, both forms)", () => {
    const catalogs = catalogsFromManifest({
      catalogs: [
        { type: "movie", id: "top", name: "Top Movies" },
        {
          type: "movie",
          id: "search",
          name: "Movie Search",
          extra: [{ name: "search", isRequired: true }],
        },
        {
          type: "series",
          id: "search",
          name: "Series Search",
          extraRequired: ["search"],
        },
        {
          type: "movie",
          id: "browsable",
          name: "Browsable with optional search",
          extra: [{ name: "search", isRequired: false }],
        },
      ],
    });
    expect(catalogs.map((c) => c.name)).toEqual([
      "Top Movies",
      "Browsable with optional search",
    ]);
  });
});

describe("liveCategoriesUrl", () => {
  it("builds the player_api URL with encoded credentials", () => {
    const url = liveCategoriesUrl({
      kind: "xtream",
      id: "a",
      name: "x",
      enabled: true,
      server: "http://tv.example.com:8080/",
      username: "user name",
      password: "p&ss",
    });
    expect(url).toBe(
      "http://tv.example.com:8080/player_api.php?username=user+name&password=p%26ss&action=get_live_categories",
    );
  });
});

describe("addonBase / encSegment (stremio path invariants)", () => {
  it("strips /manifest.json and trailing slashes from the base", () => {
    expect(addonBase("https://aio.example/cfg/manifest.json")).toBe(
      "https://aio.example/cfg",
    );
    expect(addonBase("  https://aio.example/cfg/  ")).toBe(
      "https://aio.example/cfg",
    );
  });

  it("keeps the : in episode ids while escaping everything else", () => {
    // Load-bearing: Stremio episode ids keep their colons in the path.
    expect(encSegment("tt123:1:2")).toBe("tt123:1:2");
    expect(encSegment("a b/c:d")).toBe("a%20b%2Fc:d");
  });
});
