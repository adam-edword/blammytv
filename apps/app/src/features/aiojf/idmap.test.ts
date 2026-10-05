import { beforeEach, describe, expect, it, vi } from "vitest";
import { jellyfinIdFor, rememberIds } from "./idmap";
import { jellyfinIdOf } from "./ids";

// An in-memory localStorage: the unit tests run without a DOM.
const mem = new Map<string, string>();
vi.stubGlobal("localStorage", {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
});

const BASE = "https://aio.example.com/jellyfin";
const HASHED = "b2" + "7".repeat(30);
const stored = () => JSON.parse(mem.get("blammytv.aiojfIds") ?? "null")?.data;

beforeEach(() => mem.clear());

describe("jellyfinIdFor", () => {
  it("computes an id it can, with nothing remembered", () => {
    expect(jellyfinIdFor(BASE, "movie", "tt0111161")).toBe(jellyfinIdOf("tt0111161", "movie"));
    expect(jellyfinIdFor(BASE, "series", "tt0903747:1:2")).toBe(jellyfinIdOf("tt0903747:1:2", "series"));
  });

  it("an id it cannot compute is null until a list has named it", () => {
    expect(jellyfinIdFor(BASE, "movie", "custom:abc")).toBeNull();
    rememberIds(BASE, [["custom:abc", "movie", HASHED]]);
    expect(jellyfinIdFor(BASE, "movie", "custom:abc")).toBe(HASHED);
  });

  it("looks in what was remembered before it computes", () => {
    const other = "a1" + "0".repeat(30);
    rememberIds(BASE, [["tt0111161", "movie", other]]);
    expect(jellyfinIdFor(BASE, "movie", "tt0111161")).toBe(other);
  });

  it("an aiojf: episode is its own hex, and only a hex", () => {
    expect(jellyfinIdFor(BASE, "series", `aiojf:${HASHED}`)).toBe(HASHED);
    expect(jellyfinIdFor(BASE, "series", `aiojf:${HASHED.toUpperCase()}`)).toBe(HASHED);
    expect(jellyfinIdFor(BASE, "series", "aiojf:nothex")).toBeNull();
  });

  it("the season for a Kitsu-style episode goes to the computation, and the map still comes first", () => {
    expect(jellyfinIdFor(BASE, "series", "kitsu:7442:3", { season: 2 })).toBe(jellyfinIdOf("kitsu:7442:3", "series", { season: 2 }));
    expect(jellyfinIdFor(BASE, "series", "kitsu:7442:3", { season: 2 })).not.toBe(jellyfinIdFor(BASE, "series", "kitsu:7442:3"));
    const learned = "a1" + "9".repeat(30);
    rememberIds(BASE, [["kitsu:7442:3", "series", learned]]);
    expect(jellyfinIdFor(BASE, "series", "kitsu:7442:3", { season: 2 })).toBe(learned);
  });

  it("belongs to the instance it was read from", () => {
    rememberIds(BASE, [["custom:abc", "movie", HASHED]]);
    expect(jellyfinIdFor("https://other.example.com/jellyfin", "movie", "custom:abc")).toBeNull();
  });
});

describe("rememberIds", () => {
  it("keeps only what the computation gets wrong", () => {
    rememberIds(BASE, [
      ["tt0111161", "movie", jellyfinIdOf("tt0111161", "movie") as string],
      ["custom:abc", "movie", HASHED],
    ]);
    expect(stored().pairs).toEqual([["custom:abc", HASHED]]);
  });

  it("an episode of a season the id does not say is kept", () => {
    const season2 = jellyfinIdOf("kitsu:7442:3", "series", { season: 2 }) as string;
    expect(season2).not.toBe(jellyfinIdOf("kitsu:7442:3", "series"));
    rememberIds(BASE, [["kitsu:7442:3", "series", season2]]);
    expect(jellyfinIdFor(BASE, "series", "kitsu:7442:3")).toBe(season2);
  });

  it("writes nothing when nothing is new, and leaves out an id that is not a hex or is hashed already", () => {
    rememberIds(BASE, [
      ["custom:a", "movie", "not-a-hex"],
      [`aiojf:${HASHED}`, "series", HASHED],
    ]);
    expect(mem.size).toBe(0);
    rememberIds(BASE, [["custom:abc", "movie", HASHED]]);
    const before = mem.get("blammytv.aiojfIds");
    rememberIds(BASE, [["custom:abc", "movie", HASHED]]);
    expect(mem.get("blammytv.aiojfIds")).toBe(before);
  });

  it("an id the computation gives clears what was stored for that title", () => {
    // A boxset id (kind 5) learned for a plain film before BoxSets were left out.
    const computed = jellyfinIdOf("tt0111161", "movie") as string;
    const boxset = computed.replace(/^a111/, "a151");
    rememberIds(BASE, [["tt0111161", "movie", boxset], ["custom:abc", "movie", HASHED]]);
    expect(jellyfinIdFor(BASE, "movie", "tt0111161")).toBe(boxset);
    rememberIds(BASE, [["tt0111161", "movie", computed]]);
    expect(jellyfinIdFor(BASE, "movie", "tt0111161")).toBe(computed);
    // Only that title's entry went.
    expect(stored().pairs).toEqual([["custom:abc", HASHED]]);
  });

  it("a computed id with nothing stored for it writes nothing, and another instance's entries are left alone", () => {
    const computed = jellyfinIdOf("tt0111161", "movie") as string;
    rememberIds(BASE, [["tt0111161", "movie", computed]]);
    expect(mem.size).toBe(0);
    rememberIds(BASE, [["custom:abc", "movie", HASHED]]);
    const before = mem.get("blammytv.aiojfIds");
    rememberIds(BASE, [["tt0111161", "movie", computed]]);
    expect(mem.get("blammytv.aiojfIds")).toBe(before);
    // A list from another instance, with nothing of its own to clear, does not
    // wipe this one's entries.
    rememberIds("https://other.example.com/jellyfin", [["tt0111161", "movie", computed]]);
    expect(mem.get("blammytv.aiojfIds")).toBe(before);
    expect(stored().base).toBe(BASE);
  });

  it("another instance starts it empty", () => {
    rememberIds(BASE, [["custom:abc", "movie", HASHED]]);
    rememberIds("https://other.example.com/jellyfin", [["custom:def", "movie", "c2" + "1".repeat(30)]]);
    expect(stored().base).toBe("https://other.example.com/jellyfin");
    expect(stored().pairs).toEqual([["custom:def", "c2" + "1".repeat(30)]]);
  });

  it("is capped, and the oldest go first", () => {
    const hex = (n: number) => "b2" + n.toString(16).padStart(30, "0");
    rememberIds(BASE, Array.from({ length: 1600 }, (_, i) => [`custom:${i}`, "movie", hex(i)] as const));
    const pairs = stored().pairs as [string, string][];
    expect(pairs.length).toBe(1500);
    expect(pairs[0][0]).toBe("custom:100");
    expect(pairs.at(-1)?.[0]).toBe("custom:1599");
    expect(jellyfinIdFor(BASE, "movie", "custom:5")).toBeNull();
    expect(jellyfinIdFor(BASE, "movie", "custom:1500")).toBe(hex(1500));
  });

  it("a changed id moves to the newest end", () => {
    const a = "b2" + "1".repeat(30);
    const b = "b2" + "2".repeat(30);
    const c = "b2" + "3".repeat(30);
    rememberIds(BASE, [["x", "movie", a], ["y", "movie", b]]);
    rememberIds(BASE, [["x", "movie", c]]);
    expect(stored().pairs).toEqual([["y", b], ["x", c]]);
  });

  it("reads past a stored value of the wrong shape", () => {
    mem.set("blammytv.aiojfIds", JSON.stringify({ v: 1, data: { base: BASE, pairs: [["ok", HASHED], 7, ["x"], [1, 2]] } }));
    expect(jellyfinIdFor(BASE, "movie", "ok")).toBe(HASHED);
    mem.set("blammytv.aiojfIds", JSON.stringify({ v: 1, data: "junk" }));
    expect(jellyfinIdFor(BASE, "movie", "custom:abc")).toBeNull();
  });
});
