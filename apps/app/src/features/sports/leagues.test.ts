import { describe, expect, it } from "vitest";
import {
  ALL_LEAGUES,
  SPORTS,
  league,
  searchLeagues,
  searchSports,
  sportOf,
} from "./leagues";

/* The catalog is GENERATED, so these guard the generator as much as the
 * reader: a bad regeneration should fail here rather than reach a picker. */
describe("the catalog", () => {
  it("carries every sport and league the harvest verified", () => {
    expect(SPORTS.length).toBeGreaterThanOrEqual(14);
    expect(ALL_LEAGUES.length).toBeGreaterThanOrEqual(150);
  });

  it("has a usable row for every league", () => {
    for (const l of ALL_LEAGUES) {
      // The path is the id AND the endpoint, so it has to be both halves.
      expect(l.path).toMatch(/^[a-z-]+\/[\w.-]+$/);
      expect(l.label.length).toBeGreaterThan(0);
      expect(l.name.length).toBeGreaterThan(0);
    }
  });

  it("keys nothing twice", () => {
    expect(new Set(ALL_LEAGUES.map((l) => l.path)).size).toBe(ALL_LEAGUES.length);
    expect(new Set(SPORTS.map((s) => s.key)).size).toBe(SPORTS.length);
  });

  it("serves every mark over https", () => {
    // The webview refuses mixed content, and ESPN hands a few of these back
    // over http; the generator rewrites them. A regeneration that stopped
    // doing that would show as missing logos and nothing else.
    for (const l of ALL_LEAGUES)
      if (l.logo) expect(l.logo.startsWith("https://")).toBe(true);
  });

  it("puts every league under the sport its path names", () => {
    for (const s of SPORTS)
      for (const l of s.leagues) expect(l.path.split("/")[0]).toBe(s.key);
  });

  it("still carries the five the hub shipped with", () => {
    for (const p of [
      "football/nfl",
      "basketball/nba",
      "baseball/mlb",
      "hockey/nhl",
      "soccer/eng.1",
    ])
      expect(league(p), p).toBeDefined();
  });
});

describe("lookup", () => {
  it("finds a league and its sport by path", () => {
    expect(league("soccer/eng.1")?.label).toBe("Premier League");
    expect(sportOf("soccer/eng.1")?.name).toBe("Fútbol");
    expect(sportOf("football/nfl")?.name).toBe("American Football");
  });

  it("answers undefined for a path we no longer carry", () => {
    // What a saved follow looks like after a regeneration drops its league.
    expect(league("soccer/gone.1")).toBeUndefined();
    expect(sportOf("soccer/gone.1")).toBeUndefined();
  });
});

describe("search", () => {
  it("matches sports on their own name, not their leagues' names", () => {
    expect(searchSports("foot").map((s) => s.name)).toContain(
      "American Football",
    );
    // "cup" is in a dozen league names across four sports, and step one is
    // asking which SPORT.
    expect(searchSports("cup")).toHaveLength(0);
  });

  it("gives everything back for an empty query", () => {
    expect(searchSports("  ")).toHaveLength(SPORTS.length);
    expect(searchLeagues("")).toHaveLength(ALL_LEAGUES.length);
  });

  it("matches leagues on the label, the formal name, or the code", () => {
    expect(searchLeagues("premier").some((l) => l.path === "soccer/eng.1")).toBe(
      true,
    );
    expect(searchLeagues("english").some((l) => l.path === "soccer/eng.1")).toBe(
      true,
    );
    expect(searchLeagues("eng.1").map((l) => l.path)).toContain("soccer/eng.1");
  });

  it("narrows to one sport when given one", () => {
    const soccer = SPORTS.find((s) => s.key === "soccer")!;
    const all = searchLeagues("cup");
    const just = searchLeagues("cup", soccer);
    expect(just.length).toBeLessThan(all.length);
    expect(just.every((l) => l.path.startsWith("soccer/"))).toBe(true);
  });
});

describe("searchLeagues finds a whole sport by name", () => {
  it("answers 'hockey' with every hockey league", () => {
    // The half that makes search feel like it works: nothing in a hockey
    // league's own row says the word "hockey".
    const hits = searchLeagues("hockey");
    const hockey = SPORTS.find((s) => s.key === "hockey")!;
    expect(hits.length).toBe(hockey.leagues.length);
    expect(hits.map((l) => l.path).sort()).toEqual(
      hockey.leagues.map((l) => l.path).sort(),
    );
  });

  it("matches a sport by its display name as well as its key", () => {
    // They diverge: "hockey" against "Ice Hockey", "mma" against "Fighting".
    expect(searchLeagues("fighting").map((l) => l.path).sort()).toEqual(
      searchLeagues("mma").map((l) => l.path).sort(),
    );
  });

  it("narrows on every term rather than widening", () => {
    const soccer = searchLeagues("soccer");
    const german = searchLeagues("soccer german");
    expect(german.length).toBeGreaterThan(0);
    expect(german.length).toBeLessThan(soccer.length);
    expect(german.every((l) => l.path.startsWith("soccer/"))).toBe(true);
  });

  it("still finds a league by its own name and by its code", () => {
    expect(searchLeagues("premier league").some((l) => l.path === "soccer/eng.1")).toBe(true);
    expect(searchLeagues("eng.1").map((l) => l.path)).toContain("soccer/eng.1");
  });

  it("matches across concatenated fields, which one substring cannot", () => {
    // "soccer eng.1" is a sensible thing to type. As a raw substring it
    // matches nothing, because the sport and the path are different fields.
    expect(searchLeagues("soccer eng.1").map((l) => l.path)).toEqual([
      "soccer/eng.1",
    ]);
  });
});

describe("what we call a sport, where it differs from the source", () => {
  it("says Fútbol, not Soccer", () => {
    // Adam's. The catalog is generated from an American source and takes
    // its wording; this app is not obliged to.
    expect(SPORTS.find((s) => s.key === "soccer")?.name).toBe("Fútbol");
  });

  it("keeps the KEY as soccer, because it is a path and an id", () => {
    // It is the catalog path's first segment, the fetch URL, and half of
    // every stored league id. Renaming it would be a migration for a word.
    const soccer = SPORTS.find((s) => s.name === "Fútbol")!;
    expect(soccer.key).toBe("soccer");
    expect(soccer.leagues.every((l) => l.path.startsWith("soccer/"))).toBe(true);
  });

  it("finds it by BOTH words, accent or not", () => {
    // Renaming the label must not take away the word most people would
    // actually reach for, and nobody types an accent into a search box.
    const paths = (q: string) => searchLeagues(q).map((l) => l.path).sort();
    const soccer = SPORTS.find((s) => s.key === "soccer")!;
    const all = soccer.leagues.map((l) => l.path).sort();
    expect(paths("soccer")).toEqual(all);
    expect(paths("futbol")).toEqual(all);
    expect(paths("fútbol")).toEqual(all);
  });
});
