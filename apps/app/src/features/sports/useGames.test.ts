import { describe, expect, it } from "vitest";
import { keepStable, pollDelay, presumedMatches, reachTargets, withChannels } from "./useGames";
import { indexChannels } from "./matcher";
import type { Fixture } from "./model";

/**
 * The refresh's identity-preserving merge.
 *
 * This one is load-bearing in a way that does not show up on screen until
 * it is wrong: the cards are memoised on reference equality, so a game this
 * wrongly calls unchanged is a score that stops updating. Every test below
 * is really asking "does the card re-render when it must".
 */

const game = (id: string, over: Partial<Fixture> = {}): Fixture => ({
  kind: "fixture",
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

  it("marks games as PENDING before the catalog loads, rather than as uncarried", () => {
    // A cold start reaches the board before a 20k channel guide is parsed.
    // Saying "Not on your channels" in that window is a claim with nothing
    // behind it, so the cards get a third state instead.
    const games = [game("a", { broadcasts: ["MASN"] })];
    const out = withChannels(games, null);
    expect(out[0].channelsPending).toBe(true);
    expect(out[0].channels).toEqual([]);
  });

  it("keeps array identity once everything is marked", () => {
    // The cards are memoised on it. Marking is a one-time transition, so a
    // refresh while the guide is still loading must re-render nothing.
    const games = withChannels([game("a", { broadcasts: ["MASN"] })], null);
    expect(withChannels(games, null)).toBe(games);
  });

  it("clears the flag once the catalog answers", () => {
    const pending = withChannels([game("a", { broadcasts: ["MASN"] })], null);
    const resolved = withChannels(pending, indexChannels([]));
    expect(resolved[0].channelsPending).toBe(false);
  });

  describe("identity across a tick, in the PIPELINE'S order", () => {
    /**
     * The audit's deepest finding. Every existing test here fed
     * `withChannels` its own output, which the app never does —
     * `SportsScreen` calls it on the hook's RAW list every time that array
     * changes identity. Raw games carry `channels: []`, so the `unchanged`
     * check could not match for any card that found a channel, and a new
     * object was minted every 90 seconds for exactly the cards that matter.
     */
    it("hands back the same resolved object when nothing moved", () => {
      const c = cat({ name: "US: MASN" });
      const tick1 = [game("a", { broadcasts: ["MASN"] })];
      const first = withChannels(tick1, c);
      expect(first[0].channels).toHaveLength(1);
      // A refresh where nothing changed: keepStable returns the SAME raw
      // objects, and this is then called on those again.
      const tick2 = keepStable(tick1, [game("a", { broadcasts: ["MASN"] })]);
      expect(tick2[0]).toBe(tick1[0]);
      expect(withChannels(tick2, c)[0]).toBe(first[0]);
    });

    it("holds for a presumed match too", () => {
      const c = cat({ name: "US: Tennis Channel" });
      const raw = [game("t", { leagueKey: "tennis/atp", broadcasts: [] })];
      const first = withChannels(raw, c);
      expect(first[0].presumedOnly).toBe(true);
      expect(withChannels(keepStable(raw, raw), c)[0]).toBe(first[0]);
    });

    it("resolves again when the GAME changed", () => {
      // The other half: a cache that never invalidates is a score that
      // stops updating. A new raw object is a new answer.
      const c = cat({ name: "US: MASN" });
      const before = withChannels([game("a", { broadcasts: ["MASN"] })], c);
      const moved = withChannels(
        [game("a", { broadcasts: ["MASN"], status: "Top 9th" })],
        c,
      );
      expect(moved[0]).not.toBe(before[0]);
      expect(moved[0].status).toBe("Top 9th");
    });

    it("resolves again when the CATALOG changed", () => {
      const raw = [game("a", { broadcasts: ["MASN"] })];
      const before = withChannels(raw, cat({ name: "US: MASN" }));
      const after = withChannels(raw, cat({ name: "US: MASN HD" }));
      expect(after[0]).not.toBe(before[0]);
      expect(after[0].channels.map((x) => x.name)).toEqual(["US: MASN HD"]);
    });
  });

  describe("a network's games at one kick-off (the odds split)", () => {
    // Four CBS games at noon and one at 4:25, as on Adam's board.
    const at = (h: number, m = 0) => new Date(2026, 9, 4, h, m);
    const cbs = (id: string, start: Date) => game(id, { broadcasts: ["CBS"], start });
    const c = cat({ name: "CBS 4K UHD (Event Only)" });

    it("keeps a network's channel off the card when it has four games at once", () => {
      const out = withChannels(
        [cbs("a", at(12)), cbs("b", at(12)), cbs("c", at(12)), cbs("d", at(12)), cbs("late", at(15, 25))],
        c,
      );
      expect(out.map((g) => [g.id, g.channels.length, g.shared ?? null])).toEqual([
        ["a", 0, { cbs: 4 }],
        ["b", 0, { cbs: 4 }],
        ["c", 0, { cbs: 4 }],
        ["d", 0, { cbs: 4 }],
        // Three hours and twenty-five minutes on: its own slot.
        ["late", 1, null],
      ]);
    });

    it("counts the board it is given, not just the games it resolves", () => {
      // multi-view resolves one game at a time (mvGames.liveChannels).
      const board = [cbs("a", at(12)), cbs("b", at(13))];
      const [alone] = withChannels([board[0]], c);
      const [shared] = withChannels([board[0]], c, board);
      expect([alone.channels.length, shared.channels.length, shared.shared]).toEqual([1, 0, { cbs: 2 }]);
    });

    it("resolves again when another game joins its slot, and not otherwise", () => {
      const a = cbs("a", at(12));
      const first = withChannels([a], c);
      expect(withChannels([a], c)[0]).toBe(first[0]);
      const joined = withChannels([a, cbs("b", at(12, 30))], c);
      expect(joined[0]).not.toBe(first[0]);
      expect(joined[0].channels).toEqual([]);
    });
  });

  describe("a game going final", () => {
    // Two CBS games half an hour apart split one channel; once one is over
    // it isn't on the channel any more (0.11.0 audit, SP2).
    const at = (h: number, m = 0) => new Date(2026, 9, 4, h, m);
    const cbs = (id: string, start: Date, over: Partial<Fixture> = {}) =>
      game(id, { broadcasts: ["CBS"], start, ...over });
    const c = cat({ name: "CBS 4K UHD (Event Only)" });

    it("gives its neighbour the unsplit odds, and the memo notices", () => {
      const a = cbs("a", at(12));
      const b = cbs("b", at(12, 30));
      const before = withChannels([a, b], c);
      expect(before.map((g) => [g.channels.length, g.shared ?? null])).toEqual([
        [0, { cbs: 2 }],
        [0, { cbs: 2 }],
      ]);
      // b finishes: a is a new answer though its own object didn't move.
      const done = cbs("b", at(12, 30), { state: "final", status: "Final" });
      const after = withChannels([a, done], c);
      expect(after[0]).not.toBe(before[0]);
      expect(after[0].channels.map((x) => x.name)).toEqual(["CBS 4K UHD (Event Only)"]);
      expect(after[0].shared ?? null).toBeNull();
      // The finished game's own answer is as it was.
      expect(after[1].shared).toEqual({ cbs: 2 });
    });

    it("does not split games two hours apart, and does at 119 minutes", () => {
      const twoHours = withChannels([cbs("a", at(12)), cbs("b", at(14))], c);
      expect(twoHours.map((g) => g.channels.length)).toEqual([1, 1]);
      const under = withChannels([cbs("a", at(12)), cbs("b", at(13, 59))], c);
      expect(under.map((g) => g.channels.length)).toEqual([0, 0]);
    });
  });

  /**
   * A channel of another league is not this game's club station (0.11.0
   * audit, SP1), through the whole join: the card.
   */
  describe("another league's station on the card", () => {
    const at = new Date("2026-06-13T23:15:00Z");
    const fox = (id: string, home: [string, string], away: [string, string], leagueKey: string) =>
      game(id, {
        leagueKey,
        state: "pre",
        start: at,
        broadcasts: ["FOX"],
        home: { name: home[0], shortName: home[1], abbr: "H" },
        away: { name: away[0], shortName: away[1], abbr: "A" },
      });
    const names = (g: { channels: { name: string }[] }) => g.channels.map((x) => x.name);
    const ksaz = "NFL Teams: FOX Cardinals (KSAZ) Phoenix AZ";
    const stations = cat({ name: "US: FOX" }, { name: ksaz, hidden: true });

    it("leaves the MLB Cardinals' card without the Phoenix NFL station", () => {
      const board = [
        fox("g1", ["Chicago Cubs", "Cubs"], ["St. Louis Cardinals", "Cardinals"], "baseball/mlb"),
        fox("g2", ["Arizona Diamondbacks", "Diamondbacks"], ["Colorado Rockies", "Rockies"], "baseball/mlb"),
        fox("g3", ["New York Mets", "Mets"], ["Atlanta Braves", "Braves"], "baseball/mlb"),
      ];
      const out = withChannels(board, stations);
      expect(names(out[0])).toEqual([]);
      expect(out[0].hiddenOnly).toBe(false);
    });

    it("keeps it on the card of an NFL Cardinals game", () => {
      const board = [
        fox("g1", ["Los Angeles Rams", "Rams"], ["Arizona Cardinals", "Cardinals"], "football/nfl"),
        fox("g2", ["Dallas Cowboys", "Cowboys"], ["Washington Commanders", "Commanders"], "football/nfl"),
        fox("g3", ["New York Giants", "Giants"], ["Seattle Seahawks", "Seahawks"], "football/nfl"),
      ];
      const out = withChannels(board, stations);
      expect(names(out[0])).toEqual([ksaz]);
      expect(out[0].hiddenOnly).toBe(true);
    });
  });

  describe("the hidden-folder rule, over the whole join", () => {
    it("does not let a doubtful visible match bury an exact hidden one", () => {
      // The bar mismatch: the visible/hidden fallback was decided at
      // MIN_CONFIDENCE (25) and the card counts CARD_CONFIDENCE (70). A
      // visible 40% guess counted as "carrying the game", so the hidden
      // list was dropped — and then the guess was dropped too, leaving the
      // viewer with nothing while they owned an exact NBC feed.
      const [g] = withChannels(
        [game("a", { broadcasts: ["NBC"] })],
        cat({ name: "NBC Sports Bay Area" }, { name: "US: NBC", hidden: true }),
      );
      expect(g.channels.map((c) => c.name)).toEqual(["US: NBC"]);
      expect(g.hiddenOnly).toBe(true);
    });

    it("still says nothing about hidden folders when something visible carries it", () => {
      // The rule itself, unchanged: a visible CARD-WORTHY match is the
      // whole answer.
      const [g] = withChannels(
        [game("a", { broadcasts: ["MASN"] })],
        cat({ name: "US: MASN" }, { name: "US: MASN HD", hidden: true }),
      );
      expect(g.channels.map((c) => c.name)).toEqual(["US: MASN"]);
      expect(g.hiddenOnly).toBe(false);
    });

    it("applies the rule to fixture-named channels too", () => {
      // matchEvent never reads `hidden`, so its results used to walk past
      // the rule and LEAD the card: the hidden channel was tuned first and
      // the card said "Live on 2 channels" with no mention of the folder.
      const [g] = withChannels(
        [
          game("a", {
            broadcasts: ["MASN"],
            home: { name: "Orioles", abbr: "BAL" },
            away: { name: "Braves", abbr: "ATL" },
          }),
        ],
        cat(
          { name: "MLB 01 | Braves at Orioles", hidden: true },
          { name: "US: MASN" },
        ),
      );
      expect(g.channels.map((c) => c.name)).toEqual(["US: MASN"]);
      expect(g.hiddenOnly).toBe(false);
    });
  });

  /**
   * THE CURATED NETWORK MAP as a last resort (plan 010, phase 0's fallback).
   *
   * The behaviour worth pinning is the ORDER of the two sources, not just
   * that the map works: a league-wide guess must never get in front of
   * something the schedule actually said about this fixture.
   */
  describe("the network map", () => {
    const tennis = (over: Partial<Fixture> = {}) =>
      game("t", {
        sport: "tennis",
        league: "ATP",
        leagueKey: "tennis/atp",
        broadcasts: [],
        ...over,
      });

    it("fills a game the source said nothing about", () => {
      const [g] = withChannels([tennis()], cat({ name: "US: Tennis Channel" }));
      expect(g.channels.map((c) => c.name)).toEqual(["US: Tennis Channel"]);
      expect(g.presumedOnly).toBe(true);
    });

    it("never displaces a stated broadcast that RESOLVED", () => {
      // The rule the fall-through did not change. A source name that finds
      // a channel is the whole answer and the map never runs, so the
      // result is not flagged as a guess: this is a fact about the
      // fixture, not about the league.
      const [g] = withChannels(
        [tennis({ broadcasts: ["MASN"] })],
        cat({ name: "US: MASN" }, { name: "US: Tennis Channel" }),
      );
      expect(g.channels.map((c) => c.name)).toEqual(["US: MASN"]);
      expect(g.presumedOnly).toBe(false);
    });

    it("falls through to the map when the source's own name found nothing", () => {
      // The reversal in v0.8.156. ESPN named Paramount+, the playlist has
      // no Paramount+, and the map knows the league also lives on CBS
      // Sports Network — which IS there. A pressable channel beats an
      // unpressable fact, and the card keeps both.
      const [g] = withChannels(
        [tennis({ leagueKey: "soccer/uefa.champions_qual", broadcasts: ["Paramount+"] })],
        cat({ name: "US: CBS Sports Network" }),
      );
      expect(g.channels.map((c) => c.name)).toEqual(["US: CBS Sports Network"]);
      expect(g.presumedOnly).toBe(true);
    });

    it("does not consult the map when the source's own name worked", () => {
      // Unchanged, and the important half: a stated broadcast that RESOLVES
      // is the whole answer, and the map never runs.
      const [g] = withChannels(
        [tennis({ leagueKey: "soccer/uefa.champions_qual", broadcasts: ["TUDN"] })],
        cat({ name: "US: TUDN" }, { name: "US: CBS Sports Network" }),
      );
      expect(g.channels.map((c) => c.name)).toEqual(["US: TUDN"]);
      expect(g.presumedOnly).toBe(false);
    });

    it("keeps the stated network when the map cannot help either", () => {
      // The schedule said Peacock, the playlist has neither Peacock nor
      // Tennis Channel, so the fall-through runs and finds nothing. The
      // card goes back to "On Peacock", which is true and is the most
      // specific thing anyone knows about this game.
      const [g] = withChannels(
        [tennis({ broadcasts: ["Peacock"] })],
        cat({ name: "US: MASN" }),
      );
      expect(g.channels).toEqual([]);
      expect(g.presumedOnly).toBe(false);
    });

    it("records the network even when the playlist does not carry it", () => {
      // Colombia's Primera A against a playlist with no Win Sports. No
      // channel, but the card can still say where the league lives.
      const [g] = withChannels(
        [tennis({ leagueKey: "soccer/col.1" })],
        cat({ name: "US: MASN" }),
      );
      expect(g.channels).toEqual([]);
      expect(g.presumedOnly).toBe(false);
      expect(g.presumed).toEqual(["Win Sports", "Win Sports+"]);
    });

    it("leaves a league nobody has checked alone", () => {
      const before = tennis({ leagueKey: "soccer/swe.1" });
      const [g] = withChannels([before], cat({ name: "US: Tennis Channel" }));
      expect(g.channels).toEqual([]);
      // Untouched object: no card re-renders over a lookup that found
      // nothing.
      expect(g).toBe(before);
    });

    it("holds identity across a refresh, guess and all", () => {
      // presumedOnly joins the unchanged check, or every 90 second tick
      // would hand every mapped card a new object.
      const c = cat({ name: "US: Tennis Channel" });
      const once = withChannels([tennis()], c);
      expect(withChannels(once, c)[0]).toBe(once[0]);
    });

    it("hands the theater the card's own channels (presumedMatches)", () => {
      // SP3: the theater's rail falls back to this where the schedule's
      // names reach nothing, so it has to be what the card resolved.
      const c = cat({ name: "US: CBS Sports Network" }, { name: "US: Tennis Channel" });
      const q = (id: string) =>
        tennis({ id, leagueKey: "soccer/uefa.champions_qual", broadcasts: [] });
      const board = [q("q1"), q("q2"), q("q3")];
      const [card] = withChannels(board, c);
      expect(card.presumedOnly).toBe(true);
      const rail = presumedMatches(card, c, card.shared);
      expect(rail.map((m) => m.name)).toEqual(["US: CBS Sports Network"]);
      expect(rail.map((m) => m.id)).toEqual(card.channels.map((x) => x.id));
    });

    it("has nothing for a league the map doesn't know", () => {
      const c = cat({ name: "US: Tennis Channel" });
      expect(presumedMatches(tennis({ leagueKey: "soccer/swe.1" }), c, undefined)).toEqual([]);
    });
  });
});


/**
 * #40's club half: which things still need asking for after the window is
 * drawn. The bug this guards is that a club follow puts its LEAGUE on the
 * wire, so a mid-season league looked "covered" while the club itself was
 * absent for the whole window, and the board then told the user their club
 * had no fixtures published at all.
 */
describe("reachTargets", () => {
  const epl = (id: string, home: string, away: string): Fixture => ({
    ...game(id),
    sport: "soccer",
    league: "Premier League",
    leagueKey: "soccer/eng.1",
    home: { name: "H", abbr: "H", id: home },
    away: { name: "A", abbr: "A", id: away },
  });
  const covers = (games: Fixture[]) => new Set(games.map((g) => g.leagueKey));

  it("asks for a followed league with nothing on the board", () => {
    const { missing, clubsByLeague } = reachTargets(["mlb"], [], [], new Set());
    expect(missing).toEqual(["mlb"]);
    expect(clubsByLeague.size).toBe(0);
  });

  it("asks for nothing when the league is already on the board", () => {
    const on = [game("a")];
    const { missing } = reachTargets(["mlb"], [], on, covers(on));
    expect(missing).toEqual([]);
  });

  it("REGRESSION: a mid-season league no longer masks an idle club", () => {
    // The league is playing, so it is covered and `missing` is empty. The
    // followed club is not in any of those games. Before #40 nothing was
    // asked and the board claimed the club had no fixtures at all.
    const on = [epl("g1", "1", "2"), epl("g2", "3", "4")];
    const { missing, clubsByLeague } = reachTargets(
      ["soccer/eng.1"],
      ["soccer/eng.1:359"],
      on,
      covers(on),
    );
    expect(missing).toEqual([]);
    expect(clubsByLeague.get("soccer/eng.1")).toEqual(
      new Set(["soccer/eng.1:359"]),
    );
  });

  it("does not ask for a club that IS playing in the window", () => {
    const on = [epl("g1", "359", "2")];
    const { clubsByLeague } = reachTargets(
      ["soccer/eng.1"],
      ["soccer/eng.1:359"],
      on,
      covers(on),
    );
    expect(clubsByLeague.size).toBe(0);
  });

  it("groups several idle clubs into ONE request per league", () => {
    const on = [epl("g1", "1", "2")];
    const { clubsByLeague } = reachTargets(
      ["soccer/eng.1"],
      ["soccer/eng.1:359", "soccer/eng.1:360", "soccer/eng.1:362"],
      on,
      covers(on),
    );
    expect(clubsByLeague.size).toBe(1);
    expect(clubsByLeague.get("soccer/eng.1")?.size).toBe(3);
  });

  it("REGRESSION: still asks for the club when its league is also missing", () => {
    // This test previously asserted the OPPOSITE and was wrong. The reasoning
    // was "the league is about to be asked what is next, so asking again for
    // the club would be two requests for one league". But the two are not the
    // same question, as this codebase says in three places: a bare call hands
    // back the LEAGUE's next fixture, which for a club follow is somebody
    // else's game and gets filtered straight off the board by isFollowed.
    //
    // Follow only Arsenal over an international break and the old behaviour
    // skipped the only ask that could have found their next match, in exactly
    // the case the club reach was built for. One extra request beats that.
    const { missing, clubsByLeague } = reachTargets(
      ["soccer/eng.1"],
      ["soccer/eng.1:359"],
      [],
      new Set(),
    );
    expect(missing).toEqual(["soccer/eng.1"]);
    expect(clubsByLeague.get("soccer/eng.1")).toEqual(
      new Set(["soccer/eng.1:359"]),
    );
  });

  it("ignores a malformed club key rather than asking for a league named ''", () => {
    const { clubsByLeague } = reachTargets([], ["nocolon", ":5"], [], new Set());
    expect(clubsByLeague.size).toBe(0);
  });
});

/**
 * #23: the board slows down while a game is being watched rather than
 * stopping, because the theater re-reads the board to move its own header
 * and a frozen poll would freeze that with it.
 */
describe("pollDelay", () => {
  it("slows down while watching", () => {
    expect(pollDelay(true)).toBeGreaterThan(pollDelay(false));
  });

  it("keeps the watching cadence useful rather than nominal", () => {
    // A meaningful cut: at least half the requests over a long game. If a
    // future edit makes these nearly equal, the item was undone silently.
    expect(pollDelay(true)).toBeGreaterThanOrEqual(pollDelay(false) * 2);
    // ...but still often enough that a finished game stops saying "live"
    // within a few minutes. Ten minutes was rejected for exactly this.
    expect(pollDelay(true)).toBeLessThanOrEqual(6 * 60_000);
  });

  it("never stops polling entirely", () => {
    // Stopping is the option this item deliberately did NOT take.
    expect(pollDelay(true)).toBeGreaterThan(0);
    expect(Number.isFinite(pollDelay(true))).toBe(true);
  });
});
