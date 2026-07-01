import { describe, expect, it } from "vitest";
import { catalogsFromManifest } from "./aiostreams";
import { liveCategoriesUrl } from "./xtream";

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
