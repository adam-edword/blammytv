import { describe, expect, it } from "vitest";
import { keepStable, withChannels } from "./useGames";
import { indexChannels } from "./matcher";
import type { Game } from "./model";

/**
 * The refresh's identity-preserving merge.
 *
 * This one is load-bearing in a way that does not show up on screen until
 * it is wrong: the cards are memoised on reference equality, so a game this
 * wrongly calls unchanged is a score that stops updating. Every test below
 * is really asking "does the card re-render when it must".
 */

const game = (id: string, over: Partial<Game> = {}): Game => ({
  id,
  sport: "baseball",
  league: "MLB",
  leagueKey: "mlb",
  state: "live",
  start: new Date(2026, 6, 26, 19),
  status: "Bot 7th",
  home: { name: "Orioles", abbr: "BAL", score: 2 },
  away: { name: "Braves", abbr: "ATL", score: 3 },
  broadcasts: ["MASN"],
  channels: [],
  ...over,
});

describe("keepStable", () => {
  it("hands back the very same object when nothing moved", () => {
    const before = [game("a"), game("b")];
    const after = keepStable(before, [game("a"), game("b")]);
    expect(after[0]).toBe(before[0]);
    expect(after[1]).toBe(before[1]);
  });

  it("hands back the NEW object the moment a score moves", () => {
    const before = [game("a")];
    const scored = game("a", { home: { name: "Orioles", abbr: "BAL", score: 3 } });
    const after = keepStable(before, [scored]);
    expect(after[0]).toBe(scored);
    expect(after[0]).not.toBe(before[0]);
  });

  it("notices the clock, which is the field that moves most", () => {
    const before = [game("a")];
    const ticked = game("a", { status: "Top 8th" });
    expect(keepStable(before, [ticked])[0]).toBe(ticked);
  });

  it("notices a game going final", () => {
    const before = [game("a")];
    const done = game("a", { state: "final", status: "Final" });
    expect(keepStable(before, [done])[0]).toBe(done);
  });

  it("notices channels arriving, which is what the matcher will do", () => {
    const before = [game("a")];
    const matched = game("a", { channels: [{ id: "1", name: "MASN HD" }] });
    expect(keepStable(before, [matched])[0]).toBe(matched);
  });

  it("notices a field as small as the venue", () => {
    const before = [game("a")];
    const moved = game("a", { venue: "Camden Yards" });
    expect(keepStable(before, [moved])[0]).toBe(moved);
  });

  it("passes new games straight through", () => {
    const fresh = game("b");
    const after = keepStable([game("a")], [game("a"), fresh]);
    expect(after).toHaveLength(2);
    expect(after[1]).toBe(fresh);
  });

  it("drops games that are no longer on the day", () => {
    const after = keepStable([game("a"), game("b")], [game("b")]);
    expect(after.map((g) => g.id)).toEqual(["b"]);
  });

  it("matches by id, not by position", () => {
    const before = [game("a"), game("b")];
    // Same two games, reordered by an earlier kick-off arriving late.
    const after = keepStable(before, [game("b"), game("a")]);
    expect(after[0]).toBe(before[1]);
    expect(after[1]).toBe(before[0]);
  });

  it("takes the whole list on the first load", () => {
    const next = [game("a")];
    expect(keepStable([], next)).toBe(next);
  });
});

describe("withChannels", () => {
  const cat = (...names: { name: string; hidden?: boolean }[]) =>
    indexChannels(
      names.map((n, i) => ({
        id: `ch${i}`,
        name: n.name,
        quality: null,
        hidden: n.hidden,
      })),
    );

  it("fills in the channels carrying a game", () => {
    const [g] = withChannels(
      [game("a", { broadcasts: ["MASN"] })],
      cat({ name: "US: MASN" }),
    );
    expect(g.channels.map((c) => c.name)).toEqual(["US: MASN"]);
    expect(g.hiddenOnly).toBe(false);
  });

  it("leaves a game alone when nothing carries it", () => {
    const before = game("a", { broadcasts: ["Peacock"] });
    const [g] = withChannels([before], cat({ name: "US: MASN" }));
    expect(g.channels).toEqual([]);
    // Untouched object: nothing about it changed, so no card re-renders.
    expect(g).toBe(before);
  });

  it("flags a game whose only copy is in a hidden folder", () => {
    const [g] = withChannels(
      [game("a", { broadcasts: ["MASN"] })],
      cat({ name: "US: MASN", hidden: true }),
    );
    expect(g.channels).toHaveLength(1);
    expect(g.hiddenOnly).toBe(true);
  });

  it("does not flag it when something visible also carries it", () => {
    const [g] = withChannels(
      [game("a", { broadcasts: ["MASN", "MLBN"] })],
      cat({ name: "US: MASN", hidden: true }, { name: "US: MLB Network" }),
    );
    expect(g.channels.map((c) => c.name)).toEqual(["US: MLB Network"]);
    expect(g.hiddenOnly).toBe(false);
  });

  it("hands back the SAME object when the answer has not changed", () => {
    // The cards are memoised on identity, so re-resolving an unchanged
    // board must not produce new props. Same reason keepStable exists.
    const c = cat({ name: "US: MASN" });
    const once = withChannels([game("a", { broadcasts: ["MASN"] })], c);
    const twice = withChannels(once, c);
    expect(twice[0]).toBe(once[0]);
  });

  it("passes everything through untouched before the catalog loads", () => {
    const games = [game("a", { broadcasts: ["MASN"] })];
    expect(withChannels(games, null)).toBe(games);
  });
});
