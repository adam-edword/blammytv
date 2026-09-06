import { describe, expect, it } from "vitest";
import {
  byKey,
  conferencesIn,
  conferencesOf,
  hasConferences,
  POWER_FOUR,
} from "./conferences";
import { toGames } from "./espn";
import cfb from "./fixtures/cfb-scoreboard.json";
import nfl from "./fixtures/nfl-scoreboard.json";
import table from "./conferences.json";

const CFB = "football/college-football";
const CBB = "basketball/mens-college-basketball";
const NFL = "football/nfl";

const games = toGames(cfb, CFB);

describe("the shipped table", () => {
  it("names every FBS conference plus the independents", () => {
    // Eleven conferences and one bucket. The generator sweeps a season for
    // twelve of the thirteen; independents can never be learned, because an
    // independent has no conference games for ESPN to name a group on.
    expect(Object.keys(table[CFB])).toHaveLength(13);
    expect(byKey(`${CFB}:18`)?.label).toBe("Independents");
  });

  it("keys ids per league, which is the collision it exists to avoid", () => {
    // The ACC is 1 in football and 2 in basketball. Read a bare id and half
    // the board follows the wrong sport.
    expect(byKey(`${CFB}:1`)?.label).toBe("ACC");
    expect(byKey(`${CBB}:1`)?.label).not.toBe("ACC");
    expect(byKey(`${CBB}:2`)?.label).toBe("ACC");
  });

  it("knows which leagues have conferences at all", () => {
    expect(hasConferences(CFB)).toBe(true);
    expect(hasConferences(CBB)).toBe(true);
    // No professional league carries one, so none is in the table.
    expect(hasConferences(NFL)).toBe(false);
    expect(hasConferences("baseball/mlb")).toBe(false);
  });

  it("returns nothing for a key it cannot name, rather than a placeholder", () => {
    // 179 is a real FCS conference that turns up on the college football
    // board as somebody's opponent. A chip reading "179" would filter to
    // something nobody recognises, so there is no chip.
    expect(byKey(`${CFB}:179`)).toBeUndefined();
    expect(byKey("nonsense")).toBeUndefined();
    expect(byKey(`${CFB}:`)).toBeUndefined();
  });
});

describe("conferencesIn, which is what the picker offers", () => {
  it("lists only what the loaded games actually carry", () => {
    // The four fixture games are SEC, Big 12, ACC + Independents, and SEC
    // again against an FCS side. So four names, not the table's thirteen.
    expect(conferencesIn(games).map((c) => c.label)).toEqual([
      "ACC",
      "Big 12",
      "Independents",
      "SEC",
    ]);
  });

  it("drops the ids it cannot name", () => {
    // The FCS opponent's conference (179) is on the board and is not here.
    expect(conferencesIn(games).some((c) => c.key.endsWith(":179"))).toBe(
      false,
    );
  });

  it("is empty for a professional board", () => {
    expect(conferencesIn(toGames(nfl, NFL))).toEqual([]);
  });

  it("is empty rather than throwing on no games at all", () => {
    expect(conferencesIn([])).toEqual([]);
  });
});

describe("conferencesOf, for one game", () => {
  it("gives two on a cross-conference game", () => {
    expect(conferencesOf(games[2]).map((c) => c.label).sort()).toEqual([
      "ACC",
      "Independents",
    ]);
  });

  it("gives one, twice over, on a conference game", () => {
    // Both sides are SEC, so both resolve to the same row. Unlike
    // gameConferenceKeys this does not dedupe: it answers "what does each
    // side belong to", which for a conference game is the same answer twice.
    expect(conferencesOf(games[0]).map((c) => c.label)).toEqual([
      "SEC",
      "SEC",
    ]);
  });

  it("gives only the side it can name", () => {
    expect(conferencesOf(games[3]).map((c) => c.label)).toEqual(["SEC"]);
  });
});

describe("the Power 4 preset", () => {
  it("is five keys for a thing called four, and the fifth is Notre Dame", () => {
    // An FBS independent is nobody's conference and everybody's argument.
    // Without id 18 the preset drops the one independent anyone wants.
    expect(POWER_FOUR).toHaveLength(5);
    expect(POWER_FOUR).toContain(`${CFB}:18`);
  });

  it("names conferences the table can actually resolve", () => {
    // The preset is hand-written, so this is the check that keeps it honest
    // against a regenerated table: a realignment that renumbered one of
    // these would otherwise fail silently as a chip that selects nothing.
    for (const key of POWER_FOUR) expect(byKey(key)).toBeDefined();
    expect(POWER_FOUR.map((k) => byKey(k)?.label)).toEqual([
      "ACC",
      "Big 12",
      "Big Ten",
      "SEC",
      "Independents",
    ]);
  });

  it("is college football's alone", () => {
    // Basketball's power conferences are a different argument with a
    // different answer: the Big East plays no football at all.
    for (const key of POWER_FOUR) expect(key.startsWith(`${CFB}:`)).toBe(true);
  });
});
