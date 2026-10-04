import { describe, expect, it } from "vitest";
import { packedFor } from "./report";
import { jellyfinIdOf, unpack } from "./ids";

// Vectors from ids.test.ts (AIOStreams' own `tryPack`): tt0111161 as a movie.
describe("packedFor", () => {
  it("packs a film from its IMDb id", () => {
    expect(packedFor({ itemId: "tt0111161", kind: "movie" })).toBe("a1110100000001b239ffffffff000000");
  });

  it("packs an episode from its own id, the season the id carries", () => {
    // Kind 4 (an episode) with the IMDb id type, the series type, 903747 as
    // six bytes, season 3, episode 7.
    expect(packedFor({ itemId: "tt0903747", kind: "series", episodeId: "tt0903747:3:7" })).toBe(
      "a14102" + "0000000dca43" + "0003" + "0007" + "000000",
    );
  });

  it("packs a Kitsu episode as anime, in the season it sits in", () => {
    const a = packedFor({ itemId: "kitsu:1555", kind: "series", episodeId: "kitsu:1555:4", season: 2 });
    // type byte 3 (anime), season 2, episode 4.
    expect(a).toBe("a14403" + "000000000613" + "0002" + "0004" + "000000");
    // Without a season it is the first, as ids.ts defaults.
    expect(packedFor({ itemId: "kitsu:1555", kind: "series", episodeId: "kitsu:1555:4" })).toBe(
      "a14403" + "000000000613" + "0001" + "0004" + "000000",
    );
  });

  it("is null for an id AIOStreams would not pack", () => {
    // Short of the seven digits it pads to, so the id does not rebuild.
    expect(packedFor({ itemId: "tt123", kind: "movie" })).toBeNull();
    expect(packedFor({ itemId: "tt100002", kind: "series", episodeId: "tt100002:1:1" })).toBeNull();
    // An id type AIOStreams does not pack.
    expect(packedFor({ itemId: "animeplanet:603", kind: "movie" })).toBeNull();
    // A zero-padded episode number is not the id AIOStreams would write.
    expect(packedFor({ itemId: "tt0903747", kind: "series", episodeId: "tt0903747:3:07" })).toBeNull();
  });

  it("packs every anime-only id's episode as anime, as jellyfinIdOf does (plan 024)", () => {
    // Kitsu was the only one before; MAL's is served under the same type.
    const mal = packedFor({ itemId: "mal:16498", kind: "series", episodeId: "mal:16498:3", season: 1 });
    expect(mal).toBe(jellyfinIdOf("mal:16498:3", "series", { season: 1 }));
    expect(mal && unpack(mal)?.type).toBe("anime");
  });

  it("is null for a series play without an episode", () => {
    expect(packedFor({ itemId: "tt0903747", kind: "series" })).toBeNull();
  });
});
