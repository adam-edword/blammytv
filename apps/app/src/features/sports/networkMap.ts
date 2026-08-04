/**
 * Which network normally carries a league, for the leagues the schedule says
 * nothing about (plan 010, phase 0's own fallback).
 *
 * WHY THIS EXISTS, and it is a measurement rather than a hunch. #27 counted
 * broadcast coverage across the whole 151 league catalog: 1,539 games, 32
 * carrying a broadcast name at all, 2.1%. Tennis was 0 of 1,462. Eight
 * non-US soccer leagues were 0 of everything they played. The matcher was
 * never the bottleneck for those — the source hands us nothing to match on,
 * so no amount of matcher tuning moves the number. Re-measured live on
 * 2026-08-04 against today's boards: tennis 0/610, the eight soccer leagues
 * 0/19, while MLB was 15/15. The pattern is US national rights.
 *
 * WHAT IT IS NOT. It is not a claim about a specific game. It is a claim
 * about a LEAGUE, and the difference is the whole reason carriage words a
 * presumed match differently: "usually on Tennis Channel" is true of the
 * ATP tour and can still be wrong about Tuesday's qualifier. A stated
 * broadcast always wins; this is only ever consulted after the real join has
 * come back empty. See withChannels.
 *
 * A MAINTENANCE COMMITMENT WITH A DATE ON IT, which plan 010's own risk list
 * asked to be written down in the file itself:
 *
 *   REVIEWED 2026-08-04. Rights change between seasons. Every row below was
 *   checked against published rights on that date, and a row nobody has
 *   re-checked since is a row that can quietly go wrong. Re-read this at the
 *   start of each season; that is one PR a year, which was the deal.
 *
 * ADDING A ROW IS A CLAIM, so the bar is the bar this codebase already uses
 * for the alias table in matcher.ts: only where both sides were checked. A
 * league nobody could verify is better left out — it falls through to "No
 * channel listed for this game", which is true, than filled in with a guess,
 * which is a wrong channel wearing a confident face.
 */

/** One league's normal carriage. */
export interface Rights {
  /** The catalog path, which is what a Game carries as `leagueKey`. */
  league: string;
  /**
   * Networks that normally carry it, best first.
   *
   * As a BROADCASTER would be named, not as a playlist names it: these go
   * through the same normalizer and alias table the schedule's own names do,
   * so "Tennis Channel" finds "US: Tennis Channel HD" for free.
   */
  networks: string[];
  /**
   * Events inside the league that go somewhere else.
   *
   * Tennis is the case that forces this: Tennis Channel is the year-round
   * home of both tours, and all four Grand Slams are somewhere else
   * entirely. Without the exception a fortnight of Wimbledon would sit under
   * "usually on Tennis Channel", which is the specific kind of confident
   * wrongness this whole feature is supposed to avoid.
   *
   * Matched against the event's own title, which for tennis is the
   * tournament name ESPN gives ("National Bank Open presented by Rogers").
   */
  except?: { title: RegExp; networks: string[] }[];
}

/**
 * The four Grand Slams, which leave the tour's home channel.
 *
 * A function so the two tour rows share one list rather than two copies that
 * can drift: the slams are the same events on both tours, and a fix applied
 * to one and not the other would be wrong for exactly half a fortnight.
 *
 * ESPN has the Australian Open, Wimbledon and the US Open. Roland Garros is
 * the odd one: TNT carries the bulk of it with NBC on the finals weekend, so
 * both are listed and the rail can offer either.
 */
function slams(): { title: RegExp; networks: string[] }[] {
  return [
    { title: /australian open/i, networks: ["ESPN"] },
    { title: /wimbledon/i, networks: ["ESPN", "ABC"] },
    { title: /u\.?s\.? open/i, networks: ["ESPN"] },
    { title: /roland garros|french open/i, networks: ["TNT", "truTV", "NBC"] },
  ];
}

/**
 * The table. Small on purpose: only leagues measured at 0%, only rows that
 * could be verified.
 */
export const RIGHTS: readonly Rights[] = [
  /*
   * TENNIS, which is the whole reason this file exists: 0 of 1,462 matches
   * carried a broadcast name, and it is 610 matches on an ordinary Tuesday.
   *
   * Tennis Channel is the year-round US home of both tours — the WTA deal
   * runs to 2032 and was signed as an exclusive, and Tennis Channel carries
   * the bulk of the ATP calendar outside the slams. The slams are the
   * exception list, and they are not all in one place: ESPN has three of the
   * four, and Roland Garros sits with TNT and NBC.
   */
  {
    league: "tennis/atp",
    networks: ["Tennis Channel"],
    except: slams(),
  },
  {
    league: "tennis/wta",
    networks: ["Tennis Channel"],
    except: slams(),
  },
  /*
   * UEFA's qualifying rounds. CBS holds the English-language rights to UEFA
   * club competition in the US through 2029-30: every match streams on
   * Paramount+, a few of the bigger ones reach CBS Sports Network, and the
   * Spanish-language feed is TUDN.
   *
   * Worth being clear-eyed about the yield here. Paramount+ is a streaming
   * product and matcher.ts says plainly that a name nobody carries matches
   * nothing — so on most playlists these rows change the WORDS on the card
   * and not the channel count. That is still the point: "usually on
   * Paramount+" is a useful, true thing to tell someone, and it is a better
   * answer than silence.
   */
  {
    league: "soccer/uefa.champions_qual",
    networks: ["CBS Sports Network", "Paramount+", "TUDN"],
  },
  {
    league: "soccer/uefa.europa_qual",
    networks: ["CBS Sports Network", "Paramount+", "TUDN"],
  },
  /*
   * South America. The DOMESTIC broadcaster leads rather than the US one,
   * and that is deliberate: an IPTV playlist carrying the Argentine league
   * is overwhelmingly carrying TyC Sports rather than a US rights holder,
   * which is exactly what a measurement against a real 1,875 channel dump
   * showed — TyC Sports resolved, Fanatiz and GolTV resolved to nothing.
   */
  {
    league: "soccer/arg.1",
    networks: [
      "TyC Sports",
      "ESPN Premium",
      "TNT Sports Premium",
      "Fanatiz",
    ],
  },
  {
    league: "soccer/col.1",
    networks: ["Win Sports", "Win Sports+"],
  },
  /*
   * DELIBERATELY NOT HERE: soccer/ven.1, soccer/bol.1, soccer/par.1 and
   * soccer/swe.1. All four measured at 0% and all four belong on this list
   * on the merits; none of their carriage could be verified to the standard
   * the rows above were, so they are left for someone who can check rather
   * than filled in from memory. They fall through to "No channel listed for
   * this game", which is true.
   */
];

const BY_LEAGUE = new Map(RIGHTS.map((r) => [r.league, r]));

/**
 * The networks that normally carry this league, or nothing.
 *
 * `title` is the event's own name where it has one, which is what lets the
 * slam exceptions fire. A league with no row, and a league whose row this
 * event is an exception to, both answer honestly.
 */
export function presumedNetworks(
  leagueKey: string,
  title?: string,
): readonly string[] {
  const rights = BY_LEAGUE.get(leagueKey);
  if (!rights) return [];
  if (title)
    for (const e of rights.except ?? [])
      if (e.title.test(title)) return e.networks;
  return rights.networks;
}
