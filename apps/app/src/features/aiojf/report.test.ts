import { beforeEach, describe, expect, it, vi } from "vitest";
import { packedFor } from "./report";
import { rememberIds } from "./idmap";
import { jellyfinIdOf, unpack } from "./ids";

// An in-memory localStorage: the unit tests run without a DOM. The id map
// (idmap.ts) and the store's sign-in are kept in it.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});
beforeEach(() => mem.clear());

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

describe("packedFor signed in (plan 024)", () => {
  const BASE = "https://aio.example.com/jellyfin";
  const HASHED = "b2" + "7".repeat(30);
  const signIn = () => mem.set("blammytv.aiojf", JSON.stringify({ v: 1, data: { signedIn: { base: BASE } } }));

  it("a title from an addon's own id scheme is named by the id its list gave, and is not packed without a sign-in", () => {
    rememberIds(BASE, [["custom:abc", "movie", HASHED]]);
    const t = { itemId: "custom:abc", kind: "movie" as const };
    expect(packedFor(t)).toBeNull();
    signIn();
    expect(packedFor(t)).toBe(HASHED);
    expect(packedFor(t, BASE)).toBe(HASHED);
  });

  it("an episode AIOStreams hashed (aiojf:<hex>) is its own hex", () => {
    const t = { itemId: "tt0903747", kind: "series" as const, episodeId: `aiojf:${HASHED}` };
    expect(packedFor(t)).toBeNull();
    signIn();
    expect(packedFor(t)).toBe(HASHED);
  });

  it("a Kitsu episode the episode list named, season and all, is that id", () => {
    const learned = jellyfinIdOf("kitsu:7442:3", "series", { season: 2 }) as string;
    rememberIds(BASE, [["kitsu:7442:3", "series", learned]]);
    signIn();
    expect(packedFor({ itemId: "kitsu:7442", kind: "series", episodeId: "kitsu:7442:3" })).toBe(learned);
  });

  it("what the ids compute still packs, with the season it is given, and is the same as without a sign-in", () => {
    const t = { itemId: "kitsu:1555", kind: "series" as const, episodeId: "kitsu:1555:4", season: 2 };
    const bare = packedFor(t);
    signIn();
    expect(packedFor(t)).toBe(bare);
    expect(packedFor({ itemId: "tt0111161", kind: "movie" })).toBe("a1110100000001b239ffffffff000000");
  });

  it("a map entry belongs to the instance it was read from", () => {
    rememberIds("https://other.example.com/jellyfin", [["custom:abc", "movie", HASHED]]);
    signIn();
    expect(packedFor({ itemId: "custom:abc", kind: "movie" })).toBeNull();
  });
});
