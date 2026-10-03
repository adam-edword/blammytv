import { describe, expect, it } from "vitest";
import {
  CARD_CONFIDENCE,
  clubsOf,
  matchEvent,
  matchGame,
  matchNetwork,
  normalize,
  railFor,
  tokens,
} from "./matcher";
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
    expect(normalize("UK: Sky Sports F1")).toBe("sky sports f 1");
    expect(normalize("MY| Astro SuperSports")).toBe("astro supersports");
  });

  it("does not eat a real word that starts with a country code", () => {
    // The prefix only counts when punctuation closes it.
    expect(normalize("USA Network")).toBe("usa network");
    expect(normalize("US: Indiana Sports")).toBe("indiana sports");
  });

  it("takes accents off rather than cutting the word in two", () => {
    // Spanish-language networks are the common case: a broadcast name and
    // a playlist's spelling of the same channel often disagree on accents.
    expect(normalize("TUDN México")).toBe(normalize("TUDN Mexico"));
    expect(normalize("ESPN Fútbol")).toBe("espn futbol");
    expect(normalize("MX: Televisión Pública HD")).toBe("television publica");
    expect(normalize("Univisión Deportes")).toBe("univision deportes");
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

  it("splits a numeral off its brand, because both spellings are real", () => {
    // ESPN says "MSG2" and the dump says "US: MSG 2". Measured against the
    // dump, that pair reached nothing, and neither did MSGSN2.
    expect(normalize("MSG2")).toBe("msg 2");
    expect(normalize("US: MSG 2")).toBe("msg 2");
    // Quality badges go first, so nothing here leaves a stray numeral.
    expect(normalize("ESPN 4K UHD")).toBe("espn");
    expect(normalize("US: NESN 1080p")).toBe("nesn");
  });
});

describe("matchNetwork", () => {
  it("reaches the Golf Channel, which ESPN writes as Golf Chnl", () => {
    // Golf's main carrier, and the whole reason it was missing: "chnl"
    // appears in no channel name anywhere. Both sides are real — the name
    // is what a finished PGA event carries, the channel is in the dump.
    const list = [chan("US: Golf Channel"), chan("US: NBC Golf Pass")];
    expect(matchNetwork("Golf Chnl", list).map((c) => c.name)).toEqual([
      "US: Golf Channel",
    ]);
  });

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

  it("DOES let MSG2 find MSG 2, which is the same channel spelled twice", () => {
    // Both strings are verbatim: ESPN names the network "MSG2" and the dump
    // carries "US: MSG 2". Before the numeral split this reached nothing,
    // and the sibling rule above is what makes it safe to close: the
    // numeral is still a word on both sides, so MSG still gets neither.
    const list = [chan("US: MSG"), chan("US: MSG 2"), chan("US: MSGSN2")];
    expect(matchNetwork("MSG2", list).map((c) => c.name)).toEqual(["US: MSG 2"]);
    expect(matchNetwork("MSGSN2", list).map((c) => c.name)).toEqual(["US: MSGSN2"]);
    expect(matchNetwork("MSG", list).map((c) => c.name)).toEqual(["US: MSG"]);
  });

  it("reads Alt. and Alternate as the one word they are", () => {
    // ESPN writes "Space City Home (Alt.)"; the dump carries the feed as
    // "Alternate". Both are qualifiers, so the short spelling asked for a
    // word the channel did not have and the pair missed each other.
    const list = [
      chan("US: Space City Home Network"),
      chan("US: Space City Home Network Alternate"),
    ];
    expect(matchNetwork("Space City Home (Alt.)", list).map((c) => c.name)).toEqual([
      "US: Space City Home Network Alternate",
    ]);
    // And the plain name still refuses the alternate feed.
    expect(matchNetwork("Space City Home Network", list).map((c) => c.name)).toEqual([
      "US: Space City Home Network",
    ]);
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
    expect(got.map((c) => [c.kind, c.confidence])).toEqual([
      ["network", 90],
      ["loose", 15],
    ]);
  });

  it("is the network's channel however the name agrees", () => {
    // The same name, its acronym, shelf words, or one of our own checked
    // spellings: all of them the network's channel, at the network's odds.
    for (const [network, name] of [
      ["MASN", "US: MASN"],
      ["CHSN", "US: Chicago Sports Network CHSN"],
      ["MASN", "US: The MASN Network"],
      ["MLBN", "US: MLB Network"],
    ])
      expect(matchNetwork(network, [chan(name)]).map((c) => [c.kind, c.confidence])).toEqual([
        ["network", 90],
      ]);
  });

  it("puts the better picture first among the network's channels", () => {
    const list = [chan("US: The MASN Network"), chan("US: MASN", "FHD")];
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

describe("against Adam's real catalog (btvSports, 2026-09-13)", () => {
  // 26,621 channels, a 45-game board. Every string below is verbatim from
  // that run. The checked-in dump cannot cover these: it is the sports
  // folders alone and holds no ABC, no general entertainment and none of
  // the service placeholder channels.

  it("gives a game on ABC the national feed, not a couldn't-link", () => {
    // The measured failure: four games on ABC, `US: ABC East` found at 40,
    // under the card's bar, so four cards said "Couldn't link" while the
    // viewer owned the feed.
    const list = [
      chan("US: ABC East"),
      chan("AL | Dothan | ABC WDHN"),
      chan("AL | Fairbanks | ABC KATN"),
    ];
    const got = matchNetwork("ABC", list);
    expect(got[0].name).toBe("US: ABC East");
    expect(got[0].confidence).toBeGreaterThanOrEqual(CARD_CONFIDENCE);
    // The local affiliates are still only rail-worthy guesses.
    for (const c of got.slice(1))
      expect(c.confidence).toBeLessThan(CARD_CONFIDENCE);
  });

  it("still refuses a regional brand that merely starts with the name", () => {
    // The safety case for the feed rule, and the reason it takes a LONE
    // extra only: `Fox Sports West` is a different network, not a later
    // feed of FOX, and it leaves two extras rather than one.
    const got = matchNetwork("FOX", [
      chan("US: Fox Sports West"),
      chan("US: FOX East"),
    ]);
    const west = got.find((c) => c.name === "US: Fox Sports West");
    expect(west!.confidence).toBeLessThan(CARD_CONFIDENCE);
    expect(got[0].name).toBe("US: FOX East");
  });

  it("does not promote a regional sports net off the national name", () => {
    // NBC on the same board. The national 4K feed is card-worthy; every
    // NBC Sports regional stays a guess, which is the rule this file has
    // had since the beginning and the feed rule must not erode.
    const got = matchNetwork("NBC", [
      chan("US: NBC 4K (EVENT ONLY)"),
      chan("NBC Sports 4K UHD (Event Only)"),
      chan("NBC Sports Chicago 4K UHD (Event Only)"),
      chan("US: NBC Sports Bay Area"),
    ]);
    expect(got[0].name).toBe("US: NBC 4K (EVENT ONLY)");
    for (const c of got.slice(1))
      expect(c.confidence).toBeLessThan(CARD_CONFIDENCE);
  });

  it("drops listing placeholders and radio, which are not the game", () => {
    // These were reaching the rail as 30-40% guesses against games that
    // really were on those services, which makes them the most convincing
    // wrong answers in the catalog. None of them is a stream of anything.
    expect(matchNetwork("Apple TV", [chan("Apple TV+ Series info ᴴᴰ")])).toEqual([]);
    expect(
      matchNetwork("Netflix", [
        chan("Radio: Netflix Is A Joke Radio"),
        chan("Netflix Premiere info ᴴᴰ"),
        chan("Netflix Series info ᴴᴰ"),
      ]),
    ).toEqual([]);
    expect(
      matchNetwork("Disney+", [chan("Disney+ Series info ᴴᴰ")]),
    ).toEqual([]);
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
    //
    // Re-measured 2026-09-08 at 31, after the numeral split and the
    // alt/alternate pair. Two of the seven are new here (MSG2 and Space
    // City Home (Alt.)); the other five were already reachable and had
    // been added to the corpus since. Of the 61 that still miss, 33 name a
    // channel this dump does not contain at all, and the dump is the
    // sports folders alone rather than a whole catalog.
    expect(hit.length).toBeGreaterThanOrEqual(31);
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

describe("a club's own channel (2026-09-25)", () => {
  // Both pairs verbatim from the dump, where they were the right channel at
  // 40 and 25: under the card's bar, so the card said "couldn't link".
  const dodgers = clubsOf([
    { name: "Los Angeles Dodgers", shortName: "Dodgers" },
    { name: "San Francisco Giants", shortName: "Giants" },
  ]);
  const rangers = clubsOf([
    { name: "Texas Rangers", shortName: "Rangers" },
    { name: "Houston Astros", shortName: "Astros" },
  ]);

  it("is sure of a club's channel for a game of that club", () => {
    const la = matchNetwork("Sportsnet LA", ALL, dodgers);
    expect(la[0].name).toBe("US: Spectrum SportsNet LA Dodgers");
    expect(la[0].confidence).toBeGreaterThanOrEqual(CARD_CONFIDENCE);
    const tex = matchNetwork("Rangers Sports Network", ALL, rangers);
    expect(tex[0].name).toBe("US: Texas Rangers Sports Network");
    expect(tex[0].confidence).toBeGreaterThanOrEqual(CARD_CONFIDENCE);
  });

  it("stays a guess without the game, and for another club's game", () => {
    expect(matchNetwork("Sportsnet LA", ALL)[0].confidence).toBeLessThan(CARD_CONFIDENCE);
    // The Lakers' channel, for a Dodgers game on the same owner's network.
    const lakers = matchNetwork("Spectrum Sports Net", ALL, dodgers).find(
      (c) => c.name === "US: Spectrum SportsNet Lakers",
    );
    expect(lakers!.confidence).toBeLessThan(CARD_CONFIDENCE);
  });

  it("does not make a regional sports net the national network's, city or not", () => {
    // NBC Sports Boston for a Celtics game on NBC: Boston is the club's
    // city, but "Sports" says it is a different network.
    const celtics = clubsOf([
      { name: "Boston Celtics", shortName: "Celtics" },
      { name: "New York Knicks", shortName: "Knicks" },
    ]);
    const boston = matchNetwork("NBC", ALL, celtics).find((c) => c.name === "US: NBC Sports Boston");
    expect(boston!.confidence).toBeLessThan(CARD_CONFIDENCE);
  });
});

describe("a network named only by what kind it is (2026-09-25)", () => {
  it("does not let bare Sportsnet reach every sports network in the dump", () => {
    const got = matchNetwork("Sportsnet", ALL).map((c) => c.name);
    // Measured before: 18 matches, 17 of them guesses, among them these.
    for (const junk of ["US: CBS Sports Network", "US: CBS Sports Golazo Network", "US: Chicago Sports Network CHSN"])
      expect(got).not.toContain(junk);
    // Still the network itself, and its own siblings as guesses.
    expect(got[0]).toBe("CA: Sportsnet 4K");
    expect(got).toContain("CA: Sportsnet One 4K");
  });

  it("still meets SportsNet by its expansion when the name says more", () => {
    // The reason `sportsnet` expands at all: one side writes the network
    // as a word, the other as two.
    expect(matchNetwork("Spectrum Sports Net", ALL).length).toBeGreaterThan(0);
  });
});

describe("the brand-stem fallback", () => {
  it("reaches a league's own channel when the schedule only names a service", () => {
    // ESPN says this game is on MLB.TV and nothing else. Nothing carries
    // MLB.TV, but the league's channels are the best remaining guess.
    const list = [chan("US: MLB Network"), chan("US: The MLB Channel")];
    const got = matchNetwork("MLB.TV", list);
    expect(got).toHaveLength(2);
    expect(got.every((c) => c.kind === "stem" && c.confidence === 5)).toBe(true);
  });

  it("keeps the guess a guess, however cleanly the short name fits", () => {
    // "MLB" against "MLB Network" is a tidy fit, but the doubt is in having
    // dropped ".TV", not in what is left, so it must not score as a match.
    expect(matchNetwork("MLB.TV", [chan("US: MLB Network")])[0].confidence).toBe(5);
    expect(matchNetwork("MLB Network", [chan("US: MLB Network")])[0].confidence).toBe(90);
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
    expect(got.map((c) => c.confidence)).toEqual([15, 5]);
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
    expect(got[0]).toMatchObject({ kind: "own", confidence: 97 });
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
    // 00:40 UTC on the 28th is still the 27th at 20:40 in New York, and the
    // channel is stamped for that same evening slot.
    const late = chan(
      "MLB 07 | Arizona Diamondbacks at Pittsburgh Pirates HOME 27 Jul 08:40 PM ET",
    );
    const lateNight = new Date("2026-07-28T00:40:00Z");
    expect(matchEvent(teams, lateNight, [late])).toHaveLength(1);
  });

  it("tells the two legs of a doubleheader apart", () => {
    // The day check alone cannot: same two clubs, same date. Without the
    // time, both legs claimed both feeds at SCORE.exact — a wrong channel
    // presented as a right one.
    const noon = chan(
      "MLB 05 | Arizona Diamondbacks at Pittsburgh Pirates HOME 27 Jul 01:05 PM ET",
    );
    const night = chan(
      "MLB 06 | Arizona Diamondbacks at Pittsburgh Pirates HOME 27 Jul 06:40 PM ET",
    );
    const leg1 = new Date("2026-07-27T17:05:00Z");
    const leg2 = new Date("2026-07-27T22:40:00Z");
    expect(matchEvent(teams, leg1, [noon, night]).map((c) => c.name)).toEqual([
      noon.name,
    ]);
    expect(matchEvent(teams, leg2, [noon, night]).map((c) => c.name)).toEqual([
      night.name,
    ]);
  });

  it("tolerates the two clocks drifting, because they are different clocks", () => {
    // The provider stamps its listing time and the schedule carries the
    // fixture's. A few minutes apart must still be the same game.
    const drifted = new Date("2026-07-27T22:52:00Z"); // 18:52 ET vs 18:40
    expect(matchEvent(teams, drifted, [chan(REAL)])).toHaveLength(1);
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
    // Each at its OWN start, which is what the dump actually carries: the
    // Rangers game is stamped 02:35 PM ET and the other two 06:40 PM ET.
    // Sharing one `start` across all three only passed while the time was
    // ignored, and that was the doubleheader bug wearing a green test.
    const slate: [string, string, string][] = [
      ["Pittsburgh Pirates", "Arizona Diamondbacks", "2026-07-27T22:40:00Z"],
      ["Detroit Tigers", "Baltimore Orioles", "2026-07-27T22:40:00Z"],
      ["Texas Rangers", "Seattle Mariners", "2026-07-27T18:35:00Z"],
    ];
    for (const [home, away, when] of slate) {
      const pair = [home, away];
      expect(
        matchEvent(pair, new Date(when), ALL).length,
        pair.join(" v "),
      ).toBeGreaterThan(0);
    }
  });
});

/**
 * Adam's board, 2026-10-02: btvPairing over his 26,567 channels and 37
 * games, plus the theater's log of 92 tunes and marks. Every channel name
 * here is verbatim from that report.
 */
describe("Adam's board (2026-10-02)", () => {
  const sure = (list: { name: string; confidence: number }[], name: string) =>
    (list.find((c) => c.name === name)?.confidence ?? 0) >= CARD_CONFIDENCE;

  it("does not take a college's place for its nickname", () => {
    // ESPN's short name is the place for a college: "Washington", "Mississippi
    // St". Taken as a nickname, both of these scored 85, sure enough for a card.
    const uw = clubsOf([
      { name: "USC Trojans", shortName: "USC" },
      { name: "Washington Huskies", shortName: "Washington" },
    ]);
    const nbc = [chan("US: NBC 4K (EVENT ONLY)", "4K"), chan("US: NBC Sports Washington")];
    const got = matchNetwork("NBC", nbc, uw);
    expect(sure(got, "US: NBC 4K (EVENT ONLY)")).toBe(true);
    expect(sure(got, "US: NBC Sports Washington")).toBe(false);

    const msst = clubsOf([
      { name: "Mississippi State Bulldogs", shortName: "Mississippi St" },
      { name: "Alabama Crimson Tide", shortName: "Alabama" },
    ]);
    const abc = [chan("US: ABC East"), chan("MO | St. Joseph | ABC KQTV")];
    const on = matchNetwork("ABC", abc, msst);
    expect(sure(on, "US: ABC East")).toBe(true);
    expect(sure(on, "MO | St. Joseph | ABC KQTV")).toBe(false);
  });

  it("still knows a club by its own name, pro or college", () => {
    const dodgers = clubsOf([
      { name: "Los Angeles Dodgers", shortName: "Dodgers" },
      { name: "Atlanta Braves", shortName: "Braves" },
    ]);
    expect(sure(matchNetwork("Sportsnet LA", [chan("US: Spectrum SportsNet LA Dodgers")], dodgers),
      "US: Spectrum SportsNet LA Dodgers")).toBe(true);
    // A college's nickname is the rest of its name ("Crimson Tide" after
    // "Alabama"), among other words too; "St" is "State" for the matching.
    const bama = clubsOf([
      { name: "Alabama Crimson Tide", shortName: "Alabama" },
      { name: "Mississippi State Bulldogs", shortName: "Mississippi St" },
    ]);
    expect(sure(matchNetwork("ABC", [chan("ABC Crimson Tide Birmingham")], bama),
      "ABC Crimson Tide Birmingham")).toBe(true);
    expect(sure(matchNetwork("ABC", [chan("ABC Bulldogs Starkville")], bama), "ABC Bulldogs Starkville")).toBe(true);
    // Only whole: "Crimson" among other words is not the club.
    expect(sure(matchNetwork("ABC", [chan("ABC Crimson Birmingham")], bama), "ABC Crimson Birmingham")).toBe(false);
  });

  it("finds CBSSN, the one game that day with no channel", () => {
    const got = matchNetwork("CBSSN", [chan("US: CBS Sports Network"), chan("US: CBS Sports Golazo Network")]);
    expect(sure(got, "US: CBS Sports Network")).toBe(true);
    // Its sibling is a guess at most, never on the card.
    expect(sure(got, "US: CBS Sports Golazo Network")).toBe(false);
    expect(got[0].name).toBe("US: CBS Sports Network");
  });

  it("finds FS1 under both of the names it is sold as", () => {
    const list = [chan("FS1 4K (Event Only)", "4K"), chan("US: FOX Sports 1 FHD", "FHD"), chan("US: FOX Sports 2 FHD", "FHD")];
    const got = matchNetwork("FS1", list);
    expect(got.map((c) => c.name)).toEqual(["FS1 4K (Event Only)", "US: FOX Sports 1 FHD"]);
    expect(got.every((c) => c.confidence >= CARD_CONFIDENCE)).toBe(true);
    // Equally sure (our spelling costs what an alias costs), so the
    // better picture leads.
    expect(got[0].quality).toBe("4K");
  });

  it("offers a league's channel for a game on its service only when nothing else carries it", () => {
    // Marked wrong three times in two games, each beside the game's own feeds.
    const game = {
      home: { name: "Detroit Tigers", shortName: "Tigers" },
      away: { name: "Pittsburgh Pirates", shortName: "Pirates" },
      start: new Date("2026-09-25T22:40:00Z"),
    };
    const own = "MLB 09 | Pittsburgh Pirates at Detroit Tigers AWAY @ 25 Sep 06:40 PM ET";
    const league = [chan("US: MLB Network"), chan("US: MLB Strike Zone"), chan("US: The MLB Channel")];
    const withFeed = railFor(["MLB.TV"], [chan(own), ...league], game);
    expect(withFeed.map((c) => c.name)).toEqual([own]);
    // With nothing else, the guess is still offered: something to try.
    const alone = railFor(["MLB.TV"], league, game);
    expect(alone.map((c) => c.name).sort()).toEqual(league.map((c) => c.name).sort());
  });
});

/**
 * A hidden channel that names the game's team (Adam, 2026-10-02). His "NFL
 * Teams" folder is 39 market stations, all hidden; "CBS 4K UHD (Event
 * Only)" is visible and matched every CBS game, so none of them ever
 * reached a Sunday rail. Names verbatim from btvChannels("nfl teams").
 */
describe("a hidden channel that names the game's team", () => {
  const hide = (t: Tunable): Tunable => ({ ...t, hidden: true });
  const bills = {
    home: { name: "New England Patriots", shortName: "Patriots" },
    away: { name: "Buffalo Bills", shortName: "Bills" },
    start: new Date("2026-10-04T17:00:00Z"),
  };
  const fourK = chan("CBS 4K UHD (Event Only)", "4K");
  const wbz = hide(chan("NFL Teams: CBS Patriots (WBZ) Boston MA"));
  const wcbs = hide(chan("NFL Teams: CBS Bills Giants Jets (WCBS) New York NY"));
  const wbbm = hide(chan("NFL Teams: CBS Bears (WBBM) Chicago IL"));
  const plainCbs = hide(chan("US: CBS"));
  // Four CBS games at noon (sharing.ts), as on Adam's board.
  const sunday = { cbs: 4 };

  it("comes through from a hidden folder, ahead of the bare network", () => {
    const rail = railFor(["CBS"], [fourK, wbz, wcbs, wbbm, plainCbs], bills, sunday).map((c) => c.name);
    expect(rail.slice(0, 2).sort()).toEqual([wbz.name, wcbs.name].sort());
    expect(rail[2]).toBe(fourK.name);
  });

  it("and only those: the rest of the hidden folder stays hidden", () => {
    const rail = railFor(["CBS"], [fourK, wbz, wcbs, wbbm, plainCbs], bills, sunday).map((c) => c.name);
    // Another club's station, and the bare network, exactly named.
    expect(rail).not.toContain(wbbm.name);
    expect(rail).not.toContain(plainCbs.name);
  });

  it("comes through when CBS has one game too, behind nothing", () => {
    // The exception doesn't wait on the split: a club's station is no
    // clutter. At the same odds as the network, it goes first.
    const rail = railFor(["CBS"], [fourK, wbz], bills).map((c) => [c.name, c.confidence]);
    expect(rail).toEqual([
      [wbz.name, 90],
      [fourK.name, 90],
    ]);
  });

  it("puts a visible club channel ahead of the bare network too", () => {
    const rail = railFor(["CBS"], [fourK, { ...wbz, hidden: false }], bills);
    expect(rail.map((c) => [c.name, c.kind])).toEqual([
      [wbz.name, "team"],
      [fourK.name, "network"],
    ]);
  });

  it("lets a game's own feed lead all of it, and keeps the stations behind it", () => {
    const own = chan("NFL Game Pass 04: Buffalo Bills vs New England Patriots @ Oct 04 01:00 PM ET");
    const rail = railFor(["CBS"], [fourK, wbz, own], bills, sunday).map((c) => c.name);
    expect(rail).toEqual([own.name, wbz.name, fourK.name]);
  });
});

/**
 * The odds model's Sunday (Adam, 2026-10-02): Bills at Patriots on CBS,
 * four CBS games at noon, and the rail the plan promised for it.
 */
describe("the odds a channel is showing the game", () => {
  const bills = {
    home: { name: "New England Patriots", shortName: "Patriots" },
    away: { name: "Buffalo Bills", shortName: "Bills" },
    start: new Date("2026-10-04T17:00:00Z"),
  };
  const own = chan("NFL Game Pass 04: Buffalo Bills vs New England Patriots @ Oct 04 01:00 PM ET");
  const wbz = { ...chan("NFL Teams: CBS Patriots (WBZ) Boston MA"), hidden: true };
  const wcbs = { ...chan("NFL Teams: CBS Bills Giants Jets (WCBS) New York NY"), hidden: true };
  const fourK = chan("CBS 4K UHD (Event Only)", "4K");
  const cbssn = chan("US: CBS Sports Network");

  it("reads like the plan: own feed, the two stations, then the split network and a loose fit", () => {
    const rail = railFor(["CBS"], [cbssn, fourK, wcbs, wbz, own], bills, { cbs: 4 });
    expect(rail.map((c) => [c.name, c.confidence, c.kind])).toEqual([
      [own.name, 97, "own"],
      [wcbs.name, 90, "team"],
      [wbz.name, 90, "team"],
      [fourK.name, 23, "network"],
      [cbssn.name, 15, "loose"],
    ]);
  });

  it("splits only the network's own channel", () => {
    const one = railFor(["CBS"], [fourK], bills);
    const two = railFor(["CBS"], [fourK], bills, { cbs: 2 });
    expect([one[0].confidence, two[0].confidence]).toEqual([90, 45]);
    // A club's station and the game's own feed point at one game.
    const rail = railFor(["CBS"], [{ ...wbz, hidden: false }, own], bills, { cbs: 9 });
    expect(rail.map((c) => c.confidence)).toEqual([97, 90]);
  });

  it("drops a network split so many ways it is somebody else's game", () => {
    // 90 over 21 is 4, under the rail's floor of 5.
    expect(railFor(["CBS"], [fourK], bills, { cbs: 21 })).toEqual([]);
    expect(railFor(["CBS"], [fourK], bills, { cbs: 18 }).map((c) => c.confidence)).toEqual([5]);
  });

  it("takes a split from the network's normalized name", () => {
    expect(railFor(["FS1"], [chan("US: FOX Sports 1")], undefined, { "fs 1": 3 })[0].confidence).toBe(30);
  });
});

/**
 * The order the theater folds (v0.10.75). SportsTheater cuts the rail at
 * the card's bar and folds the guesses under a line, while autoplay takes
 * the top row and failover steps down. That is the list the eye reads only
 * if no sure row ever comes after a guess.
 */
describe("the rail the theater folds", () => {
  const banded = (rail: { confidence: number }[]) => {
    const cut = rail.findIndex((c) => c.confidence < CARD_CONFIDENCE);
    return cut < 0 || rail.slice(cut).every((c) => c.confidence < CARD_CONFIDENCE);
  };
  const names: string[] = vocabulary.names.map((n) => n.name);

  it("puts every sure row ahead of every guess, for each network on the real dump", () => {
    const mixed = names.filter((n) => {
      const rail = railFor([n], ALL);
      expect(banded(rail), n).toBe(true);
      return rail.some((c) => c.confidence >= CARD_CONFIDENCE) && rail.some((c) => c.confidence < CARD_CONFIDENCE);
    });
    // Not vacuous: some of them have both halves.
    expect(mixed.length).toBeGreaterThan(0);
  });

  it("and for a game listed on two networks at once", () => {
    for (let i = 0; i + 1 < names.length; i += 2)
      expect(banded(railFor([names[i], names[i + 1]], ALL)), `${names[i]} + ${names[i + 1]}`).toBe(true);
  });

  it("and when only a hidden folder carries the game", () => {
    const hidden = { ...chan("US: ESPN"), hidden: true };
    const loose = chan("ESPN Classic");
    const rail = railFor(["ESPN"], [loose, hidden]);
    // The visible guess comes along behind it (preferVisible), and behind
    // is the point.
    expect(rail.map((c) => [c.name, c.confidence >= CARD_CONFIDENCE])).toEqual([
      [hidden.name, true],
      [loose.name, false],
    ]);
    expect(banded(rail)).toBe(true);
  });
});

/**
 * A channel that names another league is not this game's club station (the
 * 0.11.0 audit, SP1). "NFL Teams: FOX Cardinals (KSAZ)" carries the
 * Cardinals' nickname, and was the St. Louis Cardinals' sure station on FOX:
 * hidden, at 90, past the folder, leading the card and autoplaying Phoenix's
 * game. Names verbatim from Adam's "NFL Teams" folder.
 */
describe("a channel of another league", () => {
  const hide = (t: Tunable): Tunable => ({ ...t, hidden: true });
  const fox = chan("US: FOX", "HD");
  const ksaz = hide(chan("NFL Teams: FOX Cardinals (KSAZ) Phoenix AZ"));
  const wfld = hide(chan("NFL Teams: FOX Bears (WFLD) Chicago IL"));
  const kdfw = hide(chan("NFL Teams: FOX Cowboys (KDFW) Dallas TX"));
  const wnyw = hide(chan("NFL Teams: FOX Giants (WNYW) New York NY"));
  const cubs = {
    home: { name: "Chicago Cubs", shortName: "Cubs" },
    away: { name: "St. Louis Cardinals", shortName: "Cardinals" },
    start: new Date("2026-06-13T23:15:00Z"),
    leagueKey: "baseball/mlb",
  };

  it("is not the MLB club's station: dropped, hidden, loose", () => {
    const got = matchNetwork("FOX", [ksaz], clubsOf([cubs.home, cubs.away], cubs.leagueKey));
    expect(got.map((c) => [c.name, c.confidence, c.kind])).toEqual([[ksaz.name, 15, "loose"]]);
    // Three FOX games in the slot: the network is at 30, the loose guess
    // behind a hidden folder stays there, and the card has no Phoenix on it.
    const rail = railFor(["FOX"], [fox, ksaz, wfld], cubs, { fox: 3 });
    expect(rail.map((c) => [c.name, c.confidence, c.kind])).toEqual([[fox.name, 30, "network"]]);
  });

  it("is still the NFL club's, for an NFL game on FOX", () => {
    const rams = {
      home: { name: "Los Angeles Rams", shortName: "Rams" },
      away: { name: "Arizona Cardinals", shortName: "Cardinals" },
      start: new Date("2026-10-04T20:05:00Z"),
      leagueKey: "football/nfl",
    };
    const rail = railFor(["FOX"], [fox, ksaz, wfld], rams, { fox: 3 });
    expect(rail.map((c) => [c.name, c.confidence, c.kind])).toEqual([
      [ksaz.name, 90, "team"],
      [fox.name, 30, "network"],
    ]);
    expect(rail[0].confidence).toBeGreaterThanOrEqual(CARD_CONFIDENCE);
  });

  it("is not a college game's, whatever the nickname: Bears and Cowboys", () => {
    const baylor = {
      home: { name: "Baylor Bears", shortName: "Baylor" },
      away: { name: "Oklahoma State Cowboys", shortName: "Oklahoma St" },
      start: new Date("2026-10-03T16:00:00Z"),
      leagueKey: "football/college-football",
    };
    const rail = railFor(["FOX"], [fox, wfld, kdfw], baylor, { fox: 2 });
    expect(rail.map((c) => [c.name, c.confidence, c.kind])).toEqual([[fox.name, 45, "network"]]);
    // Both are loose guesses for it, not sure ones.
    const got = matchNetwork("FOX", [wfld, kdfw], clubsOf([baylor.home, baylor.away], baylor.leagueKey));
    expect(got.map((c) => c.kind)).toEqual(["loose", "loose"]);
  });

  it("is not the other league's Giants either", () => {
    const sf = {
      home: { name: "Los Angeles Dodgers", shortName: "Dodgers" },
      away: { name: "San Francisco Giants", shortName: "Giants" },
      start: new Date("2026-06-13T23:15:00Z"),
      leagueKey: "baseball/mlb",
    };
    expect(railFor(["FOX"], [fox, wnyw], sf, { fox: 3 }).map((c) => c.name)).toEqual([fox.name]);
    // A city's own channel for its club's game is unchanged: no league word.
    const clubs = clubsOf([sf.home, sf.away], sf.leagueKey);
    const la = matchNetwork("FOX", [chan("US: FOX Los Angeles")], clubs);
    expect(la.map((c) => [c.confidence, c.kind])).toEqual([[90, "team"]]);
  });

  it("is checked on the first team branch too: every extra is the club's words", () => {
    // "NBA TV Texas" carries the network's own league word, so the extra is
    // only "texas": the branch that reads "everything extra is the club".
    const rangers = [{ name: "Texas Rangers", shortName: "Rangers" }, { name: "Houston Astros", shortName: "Astros" }];
    const channel = [chan("US: NBA TV Texas")];
    expect(matchNetwork("NBA TV", channel, clubsOf(rangers))[0].kind).toBe("team");
    expect(matchNetwork("NBA TV", channel, clubsOf(rangers, "baseball/mlb"))[0].kind).toBe("loose");
    expect(matchNetwork("NBA TV", channel, clubsOf(rangers, "basketball/nba"))[0].kind).toBe("team");
  });

  it("is only asked when the game's league is known", () => {
    // clubsOf without a league says nothing about it: as before, the NFL
    // station is the club's whatever the game.
    const unknown = clubsOf([cubs.home, cubs.away]);
    expect(unknown.leagues).toBeUndefined();
    expect(matchNetwork("FOX", [ksaz], unknown).map((c) => [c.confidence, c.kind])).toEqual([[90, "team"]]);
    // And a game carrying no leagueKey through railFor is the same.
    const bare = { home: cubs.home, away: cubs.away, start: cubs.start };
    expect(railFor(["FOX"], [fox, ksaz], bare)[0].kind).toBe("team");
  });

  it("works out a game's own league words from its catalog path", () => {
    const words = (key: string) => [...(clubsOf([], key).leagues ?? [])].sort();
    expect(words("football/nfl")).toEqual(["nfl"]);
    expect(words("baseball/mlb")).toEqual(["mlb"]);
    expect(words("hockey/nhl")).toEqual(["nhl"]);
    expect(words("basketball/nba")).toEqual(["nba"]);
    // WNBA is its own word, not NBA.
    expect(words("basketball/wnba")).toEqual(["wnba"]);
    // MLS is ESPN's soccer/usa.1.
    expect(words("soccer/usa.1")).toEqual(["mls"]);
    // A college has none, which is different from not knowing.
    expect(words("football/college-football")).toEqual([]);
    expect(words("basketball/mens-college-basketball")).toEqual([]);
    expect(words("soccer/eng.1")).toEqual([]);
  });
});
