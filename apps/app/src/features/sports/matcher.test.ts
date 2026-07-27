import { describe, expect, it } from "vitest";
import { matchEvent, matchGame, matchNetwork, normalize, tokens } from "./matcher";
import type { Tunable } from "./matcher";
import channels from "./fixtures/channels.json";
import vocabulary from "./fixtures/broadcast-names.json";

/**
 * The matcher, against both real corpora.
 *
 * Every channel name quoted here is verbatim from a 1,875-channel dump and
 * every network name is verbatim from ESPN. That is the whole point: the
 * difficulty of this problem is entirely in the shapes real providers use,
 * and a test written against invented names would prove nothing.
 *
 * The last block is a floor on the measured hit rate, so that a change which
 * quietly makes the matcher worse fails here rather than on a Sunday.
 */

let next = 0;
const chan = (name: string, quality: string | null = null): Tunable => ({
  id: `c${next++}`,
  name,
  quality,
});

/** The real dump, as the matcher takes it. */
const ALL: Tunable[] = channels.map((c, i) => ({
  id: `dump-${i}`,
  name: c.name,
  quality: c.quality,
}));

describe("normalize", () => {
  it("drops the country prefix a playlist adds and a schedule never has", () => {
    expect(normalize("US: ESPN")).toBe("espn");
    expect(normalize("UK: Sky Sports F1")).toBe("sky sports f1");
    expect(normalize("MY| Astro SuperSports")).toBe("astro supersports");
  });

  it("does not eat a real word that starts with a country code", () => {
    // The prefix only counts when punctuation closes it.
    expect(normalize("USA Network")).toBe("usa network");
    expect(normalize("US: Indiana Sports")).toBe("indiana sports");
  });

  it("drops resolution badges wherever they sit", () => {
    expect(normalize("US: Fox Sports 1 HD")).toBe("fox sports 1");
    expect(normalize("US: FOX Sports 2 FHD")).toBe("fox sports 2");
    expect(normalize("ESPN 4K UHD")).toBe("espn");
    expect(normalize("US: Willow HD")).toBe("willow");
  });

  it("keeps the plus, because ESPN+ is not ESPN", () => {
    expect(tokens("ESPN+").has("espn+")).toBe(true);
    expect(tokens("ESPN+").has("espn")).toBe(false);
  });
});

describe("matchNetwork", () => {
  it("finds the obvious one", () => {
    const list = [chan("US: ESPN"), chan("US: MLB Network"), chan("US: MASN")];
    expect(matchNetwork("MASN", list).map((c) => c.name)).toEqual(["US: MASN"]);
  });

  it("REFUSES to let a network swallow its numbered sibling", () => {
    // The mistake the plan has warned about from the start.
    const list = [chan("US: ESPN 2"), chan("US: ESPN U"), chan("US: ESPN News")];
    expect(matchNetwork("ESPN", list)).toEqual([]);
    expect(matchNetwork("ESPN 2", list).map((c) => c.name)).toEqual(["US: ESPN 2"]);
  });

  it("does not let FOX become Fox Sports 1", () => {
    const list = [chan("US: Fox Sports 1 HD"), chan("US: FOX Sports 2 FHD")];
    expect(matchNetwork("FOX", list)).toEqual([]);
  });

  it("does not let MSG become MSG 2", () => {
    const list = [chan("US: MSG 2"), chan("US: MSGSN2")];
    expect(matchNetwork("MSG", list)).toEqual([]);
  });

  it("allows extra WORDS, because a playlist says more than a schedule", () => {
    const list = [chan("US: Chicago Sports Network CHSN")];
    expect(matchNetwork("CHSN", list)).toHaveLength(1);
  });

  it("expands the shortenings the schedule uses", () => {
    expect(matchNetwork("NFL Net", [chan("US: NFL Network")])).toHaveLength(1);
    expect(matchNetwork("MLBN", [chan("US: MLB Network")])).toHaveLength(1);
    expect(
      matchNetwork("Marquee Sports Net", [chan("US: Marquee Sports Network")]),
    ).toHaveLength(1);
    expect(
      matchNetwork("NBC Sports BA", [chan("US: NBC Sports Bay Area")]),
    ).toHaveLength(1);
    expect(
      matchNetwork("NBC Sports Phil", [chan("US: NBC Sports Philadelphia")]),
    ).toHaveLength(1);
    expect(
      matchNetwork("MNMT", [chan("US: Monumental Sports Network")]),
    ).toHaveLength(1);
  });

  it("meets SportsNet in the middle, one word on one side and two on the other", () => {
    expect(
      matchNetwork("SportsNet PIT", [chan("US: AT&T SportsNet Pittsburgh")]),
    ).toHaveLength(1);
    expect(
      matchNetwork("SNY", [chan("US: SportsNet New York SNY")]),
    ).toHaveLength(1);
  });

  it("ranks a regional variant well below the bare name", () => {
    // A region might be a different feed or might be the same one, so it is
    // shown with its doubt on it rather than dropped. The bare name wins.
    const list = [chan("US: MSG Western New York"), chan("US: MSG")];
    const got = matchNetwork("MSG", list);
    expect(got.map((c) => c.name)).toEqual(["US: MSG", "US: MSG Western New York"]);
    expect(got[0].confidence).toBe(100);
    expect(got[1].confidence).toBe(40);
  });

  it("scores by HOW the match was made", () => {
    expect(matchNetwork("MASN", [chan("US: MASN")])[0].confidence).toBe(100);
    expect(
      matchNetwork("CHSN", [chan("US: Chicago Sports Network CHSN")])[0].confidence,
    ).toBe(90);
    expect(
      matchNetwork("MASN", [chan("US: The MASN Network")])[0].confidence,
    ).toBe(85);
    // MLBN only reaches MLB Network through our own alias table, so it is
    // docked for being our claim rather than either side's.
    expect(matchNetwork("MLBN", [chan("US: MLB Network")])[0].confidence).toBe(85);
  });

  it("puts the exact name before one carrying only shelf words", () => {
    const list = [chan("US: The MASN Network"), chan("US: MASN")];
    expect(matchNetwork("MASN", list).map((c) => c.name)).toEqual([
      "US: MASN",
      "US: The MASN Network",
    ]);
  });

  it("reads a trailing acronym as the brand, but not a trailing attribution", () => {
    expect(matchNetwork("CHSN", [chan("US: Chicago Sports Network CHSN")])).toHaveLength(1);
    // Real name from the dump: an event listing that merely says who is
    // showing it. Matching this would put a Summer League feed on an NBA
    // game card.
    expect(
      matchNetwork("ESPN", [chan("NBA 02: NBA Las Vegas Summer League 2026 - ESPN")]),
    ).toEqual([]);
  });

  it("offers the better picture first within each of those", () => {
    const list = [chan("US: ESPN"), chan("US: ESPN FHD", "FHD"), chan("US: ESPN", "4K")];
    // An unbadged channel sorts LAST, not middle: a known FHD beats an
    // unknown, because the unknown is as likely to be SD as anything.
    expect(matchNetwork("ESPN", list).map((c) => c.quality)).toEqual([
      "4K",
      "FHD",
      null,
    ]);
  });

  it("refuses the WORD-qualified siblings too, not just the numbered ones", () => {
    const list = [
      chan("US: NESN Plus"),
      chan("US: Bein Sports Xtra"),
      chan("US: Big Ten Network Overflow 2"),
      chan("US: Spectrum Sportsnet Alternate"),
    ];
    expect(matchNetwork("NESN", list)).toEqual([]);
    expect(matchNetwork("Bein Sports", list)).toEqual([]);
    expect(matchNetwork("Big Ten Network", list)).toEqual([]);
  });

  it("has nothing to say about a name nobody carries", () => {
    // Peacock is a real answer to "where is this game", just not one that is
    // a channel. No denylist: it simply matches nothing.
    expect(matchNetwork("Peacock", ALL)).toEqual([]);
    expect(matchNetwork("Netflix", ALL)).toEqual([]);
  });

  it("ignores an empty or punctuation-only network name", () => {
    expect(matchNetwork("", ALL)).toEqual([]);
    expect(matchNetwork("  -  ", ALL)).toEqual([]);
  });
});

describe("matchGame", () => {
  it("gathers every network a game is on, national feed first", () => {
    const list = [chan("US: MASN"), chan("US: MLB Network")];
    expect(matchGame(["MLBN", "MASN"], list).map((c) => c.name)).toEqual([
      "US: MLB Network",
      "US: MASN",
    ]);
  });

  it("does not offer the same channel twice", () => {
    const espn = chan("US: ESPN");
    expect(matchGame(["ESPN", "ESPN"], [espn])).toHaveLength(1);
  });

  it("is empty for a game with no networks at all", () => {
    expect(matchGame([], ALL)).toEqual([]);
  });

  describe("hidden folders", () => {
    const buried = (name: string): Tunable => ({ ...chan(name), hidden: true });

    it("never mentions a hidden channel when a visible one carries the game", () => {
      const list = [buried("US: MASN"), chan("US: MLB Network")];
      expect(matchGame(["MLBN", "MASN"], list).map((c) => c.name)).toEqual([
        "US: MLB Network",
      ]);
    });

    it("falls back to hidden when nothing visible carries it", () => {
      // The Sunday case: the only copy of the game is in a folder you hid.
      const list = [buried("US: FOX"), chan("US: MLB Network")];
      expect(matchGame(["FOX"], list).map((c) => c.name)).toEqual(["US: FOX"]);
    });

    it("decides per game, not per network", () => {
      // MASN is visible, so FOX being buried never comes up at all.
      const list = [buried("US: FOX"), chan("US: MASN")];
      expect(matchGame(["FOX", "MASN"], list).map((c) => c.name)).toEqual([
        "US: MASN",
      ]);
    });

    it("still ranks the fallback by quality", () => {
      const list = [buried("US: FOX"), { ...buried("US: FOX"), quality: "4K" }];
      expect(matchGame(["FOX"], list).map((c) => c.quality)).toEqual([
        "4K",
        null,
      ]);
    });

    it("is empty when neither visible nor hidden carries it", () => {
      expect(matchGame(["Peacock"], [buried("US: MASN"), chan("US: ESPN")])).toEqual(
        [],
      );
    });
  });
});

describe("against the real corpora", () => {
  const names: string[] = vocabulary.names.map((n) => n.name);

  it("matches the broadcasters this catalog genuinely carries", () => {
    const hit = names.filter((n) => matchNetwork(n, ALL).length > 0);
    // Measured 2026-07-27: 24 of the 92 names. Every one was checked by
    // hand and is correct; the earlier looser rule reached 27 by counting
    // three false positives. The rest are absent from the catalog rather
    // than missed, see plan 010. A FLOOR, so a regression fails here.
    expect(hit.length).toBeGreaterThanOrEqual(24);
  });

  it("never matches a network to a numbered sibling anywhere in the dump", () => {
    // The whole corpus, not a hand-picked pair: for every match, the digits
    // in the channel's name must be the digits the schedule asked for.
    const digits = (s: string) => [...tokens(s)].filter((w) => /^\d+$/.test(w)).sort();
    for (const n of names) {
      for (const c of matchNetwork(n, ALL)) {
        expect(digits(c.name), `${n} -> ${c.name}`).toEqual(digits(n));
      }
    }
  });

  it("keeps ESPN off ESPN+ and ESPN U in the real dump", () => {
    const got = matchNetwork("ESPN", ALL).map((c) => c.name);
    expect(got.length).toBeGreaterThan(0);
    for (const name of got) {
      expect(name).not.toMatch(/ESPN\s*(\+|U|News|2)\b/i);
    }
  });
});

describe("the brand-stem fallback", () => {
  it("reaches a league's own channel when the schedule only names a service", () => {
    // ESPN says this game is on MLB.TV and nothing else. Nothing carries
    // MLB.TV, but the league's channels are the best remaining guess.
    const list = [chan("US: MLB Network"), chan("US: The MLB Channel")];
    const got = matchNetwork("MLB.TV", list);
    expect(got).toHaveLength(2);
    expect(got.every((c) => c.confidence === 30)).toBe(true);
  });

  it("keeps the guess a guess, however cleanly the short name fits", () => {
    // "MLB" against "MLB Network" is a tidy fit, but the doubt is in having
    // dropped ".TV", not in what is left, so it must not score as a match.
    expect(matchNetwork("MLB.TV", [chan("US: MLB Network")])[0].confidence).toBe(30);
    expect(matchNetwork("MLB Network", [chan("US: MLB Network")])[0].confidence).toBe(100);
  });

  it("only shortens names shaped like a service", () => {
    // Not every multi-word broadcaster gets to drop its last word.
    expect(matchNetwork("NBC Sports", [chan("US: NBC")])).toEqual([]);
    expect(matchNetwork("Fox Sports", [chan("US: Fox")])).toEqual([]);
  });

  it("does not offer a stem match twice", () => {
    const list = [chan("US: MLB Network")];
    expect(matchNetwork("MLB.TV", list)).toHaveLength(1);
  });

  it("puts the best guess first once everything is a guess", () => {
    const list = [chan("US: MLB Network"), chan("US: Texas Rangers Sports Network")];
    const got = matchGame(["MLB.TV", "Rangers Sports Network"], list);
    expect(got.map((c) => c.confidence)).toEqual([40, 30]);
  });
});

describe("matchEvent", () => {
  // The real thing, verbatim from the dump.
  const REAL = "MLB 05 | Arizona Diamondbacks at Pittsburgh Pirates HOME 27 Jul 06:40 PM ET";
  const AWAY = "MLB 06 | Arizona Diamondbacks at Pittsburgh Pirates AWAY 27 Jul 06:40 PM ET";
  // 27 Jul 2026, 18:40 US Eastern, as an absolute instant.
  const start = new Date("2026-07-27T22:40:00Z");
  const teams = ["Pittsburgh Pirates", "Arizona Diamondbacks"];

  it("finds the channel that names this exact fixture", () => {
    const got = matchEvent(teams, start, [chan(REAL), chan(AWAY), chan("US: ESPN")]);
    expect(got.map((c) => c.name)).toEqual([REAL, AWAY]);
    expect(got[0].confidence).toBe(100);
  });

  it("ignores the date, feed number and booth, which are not the fixture", () => {
    // The network matcher would reject all of these as extra words. Here
    // they are exactly what a per-game channel is made of.
    expect(matchEvent(teams, start, [chan(REAL)])).toHaveLength(1);
  });

  it("will not offer yesterday's feed of the same fixture", () => {
    // Two clubs play three nights running and these channels rotate daily,
    // so the date is the only thing separating them.
    const yesterday = new Date("2026-07-26T22:40:00Z");
    expect(matchEvent(teams, yesterday, [chan(REAL), chan(AWAY)])).toEqual([]);
  });

  it("reads the date in US Eastern, which is what the provider stamps", () => {
    // 00:40 UTC on the 28th is still the 27th at 20:40 in New York.
    const lateNight = new Date("2026-07-28T00:40:00Z");
    expect(matchEvent(teams, lateNight, [chan(REAL)])).toHaveLength(1);
  });

  it("accepts a channel that carries no date at all", () => {
    const undated = chan("MLB | Arizona Diamondbacks at Pittsburgh Pirates");
    expect(matchEvent(teams, start, [undated])).toHaveLength(1);
  });

  it("needs BOTH clubs, because one is every game they play", () => {
    const onlyOne = chan("MLB 09 | Pittsburgh Pirates at Chicago Cubs 27 Jul");
    expect(matchEvent(teams, start, [onlyOne])).toEqual([]);
  });

  it("has nothing to say when the provider carries no per-game channels", () => {
    expect(matchEvent(teams, start, [chan("US: ESPN"), chan("US: MLB Network")])).toEqual([]);
  });

  it("finds every game on a real slate", () => {
    // The measurement that justified building this: against the real dump,
    // every MLB game that day had a dedicated feed.
    const slate: [string, string][] = [
      ["Pittsburgh Pirates", "Arizona Diamondbacks"],
      ["Detroit Tigers", "Baltimore Orioles"],
      ["Texas Rangers", "Seattle Mariners"],
    ];
    for (const pair of slate) {
      expect(matchEvent(pair, start, ALL).length, pair.join(" v ")).toBeGreaterThan(0);
    }
  });
});
