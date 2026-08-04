import { describe, expect, it } from "vitest";
import { RIGHTS, presumedNetworks } from "./networkMap";
import { indexChannels, matchGame, CARD_CONFIDENCE } from "./matcher";
import catalog from "./leagues.json";

/**
 * The curated network map (plan 010, phase 0's fallback).
 *
 * Two kinds of test here and they are guarding different things. The first
 * set is the TABLE — a hand-maintained file of claims, where the failure
 * mode is a typo nobody notices for a season. The second is the LOOKUP,
 * where the failure mode is a Grand Slam sitting under the wrong network for
 * a fortnight.
 */

const PATHS = new Set(
  (catalog as { sports: { leagues: { path: string }[] }[] }).sports.flatMap(
    (s) => s.leagues.map((l) => l.path),
  ),
);

describe("the table", () => {
  it("only names leagues that exist in the catalog", () => {
    // A typo'd path is invisible: the row simply never fires, and the league
    // it was meant to cover goes on saying nothing for as long as nobody
    // checks. This is the test that makes the file self-policing.
    for (const row of RIGHTS) expect(PATHS.has(row.league)).toBe(true);
  });

  it("names each league once", () => {
    const keys = RIGHTS.map((r) => r.league);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("never carries an empty network list", () => {
    // An empty row reads as coverage and delivers none.
    for (const row of RIGHTS) {
      expect(row.networks.length).toBeGreaterThan(0);
      for (const e of row.except ?? [])
        expect(e.networks.length).toBeGreaterThan(0);
    }
  });
});

describe("presumedNetworks", () => {
  it("answers nothing for a league nobody has checked", () => {
    // The leagues deliberately left out of the table, and MLB, which needs
    // no help: 15 of 15 games carried a real broadcast name.
    expect(presumedNetworks("soccer/swe.1")).toEqual([]);
    expect(presumedNetworks("baseball/mlb")).toEqual([]);
  });

  it("gives both tennis tours their year-round home", () => {
    expect(presumedNetworks("tennis/atp")).toEqual(["Tennis Channel"]);
    expect(presumedNetworks("tennis/wta")).toEqual(["Tennis Channel"]);
  });

  it("sends the Grand Slams where they actually go", () => {
    // The exception the whole `except` mechanism exists for. Tennis Channel
    // is right for 48 weeks and wrong for the four that matter most.
    expect(presumedNetworks("tennis/atp", "Wimbledon")).toEqual([
      "ESPN",
      "ABC",
    ]);
    expect(presumedNetworks("tennis/wta", "Australian Open")).toEqual(["ESPN"]);
    expect(presumedNetworks("tennis/atp", "Roland Garros")).toEqual([
      "TNT",
      "truTV",
      "NBC",
    ]);
    // Both tours, because the slams are the same events on both and a list
    // fixed on one side only would be wrong for half a fortnight.
    expect(presumedNetworks("tennis/wta", "Roland Garros")).toEqual([
      "TNT",
      "truTV",
      "NBC",
    ]);
  });

  it("reads the sponsor name a real tournament arrives with", () => {
    // ESPN's own title for the Toronto/Montreal event, verbatim off the
    // 2026-08-04 board. An ordinary tour stop, so it keeps the tour's home.
    expect(
      presumedNetworks("tennis/atp", "National Bank Open presented by Rogers"),
    ).toEqual(["Tennis Channel"]);
    // And the US Open, whose title is a substring risk in the other
    // direction: "Open" alone must not fire it.
    expect(presumedNetworks("tennis/atp", "US Open")).toEqual(["ESPN"]);
    expect(presumedNetworks("tennis/atp", "Cincinnati Open")).toEqual([
      "Tennis Channel",
    ]);
  });

  it("does not let a title fire an exception on another league", () => {
    // soccer/uefa.champions_qual has no exceptions; a title must not reach
    // into another row's list.
    expect(presumedNetworks("soccer/uefa.champions_qual", "Wimbledon")).toEqual(
      ["CBS Sports Network", "Paramount+", "TUDN"],
    );
  });
});

describe("what the table is worth against a real playlist", () => {
  /**
   * The measurement that justifies the file, kept as a test so it cannot
   * quietly stop being true. These are names off Adam's own 1,875 channel
   * dump; the point is that the map's names go through the SAME matcher the
   * schedule's do and land on real, tunable channels.
   */
  const cat = indexChannels(
    [
      "US: Tennis Channel",
      "US: Tennis Channel  2",
      "US: TyC Sports",
      "US: ESPN",
      "US: MASN",
    ].map((name, i) => ({ id: `ch${i}`, name, quality: null })),
  );

  const found = (league: string, title?: string) =>
    matchGame([...presumedNetworks(league, title)], cat)
      .filter((c) => c.confidence >= CARD_CONFIDENCE)
      .map((c) => c.name);

  it("reaches Tennis Channel for a tour match, and not its second feed", () => {
    // "Tennis Channel 2" is a different channel, not a doubtful match for
    // this one — the numeral is a qualifier and matcher.ts rejects it
    // outright. That rule holds for a presumed name exactly as it does for
    // a stated one, which is the argument for one join.
    expect(found("tennis/atp")).toEqual(["US: Tennis Channel"]);
  });

  it("reaches the domestic broadcaster for the Argentine league", () => {
    expect(found("soccer/arg.1")).toEqual(["US: TyC Sports"]);
  });

  it("finds nothing when the playlist does not carry the network", () => {
    // UEFA qualifying is Paramount+ and TUDN on most days, and neither is a
    // channel. The row still earns its place by changing the WORDS, but it
    // must not invent a channel to do it.
    expect(found("soccer/uefa.champions_qual")).toEqual([]);
  });

  it("does not let ESPN Premium collapse onto plain ESPN", () => {
    // The ESPN/ESPNU class of false positive, arriving from the map's side
    // this time. "ESPN Premium" asks for a word "US: ESPN" does not have.
    expect(found("soccer/arg.1")).not.toContain("US: ESPN");
  });
});
