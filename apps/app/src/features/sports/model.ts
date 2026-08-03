/**
 * What a game is, in this app's terms (plan 010).
 *
 * Deliberately NOT the shape of any provider's JSON. The schedule source is
 * still an open decision, and the leading candidate is an undocumented
 * endpoint that can change under us, so an adapter maps into these types and
 * nothing above this file ever sees a vendor field name.
 */

/** Enough to draw a competitor: everything else is decoration. */
export interface Competitor {
  /**
   * The source's own id for this club, and the ONLY stable way to name one.
   *
   * Not the abbreviation. Those are league-scoped ("SEA" is the Mariners,
   * the Seahawks and the Kraken) and, worse, they move: a rebrand or a
   * relocation rewrites them, and anything the user SAVED against one goes
   * quietly dead. Backfilling the harness fixtures showed the churn is real
   * rather than theoretical, with four clubs across two leagues whose
   * abbreviations no longer resolve against the current season.
   *
   * Optional, because it is the source's field and not ours to promise.
   * Every real capture has one; anything that keys off it must handle a
   * competitor that does not.
   */
  id?: string;
  /** "Brazil", "Chicago Cubs". */
  name: string;
  /**
   * The name a broadcast would say: "Cubs", "Man City". ESPN calls this
   * shortDisplayName and every schedule source has some version of it,
   * because no sports UI has ever had room for the full one.
   *
   * The small card prefers it, the wide card does not use it. Optional
   * because a source may not carry one, and for most competitors ("Brazil")
   * it is the same string as the name.
   */
  shortName?: string;
  /** "BRA", "CHC". The card shows this above the name. */
  abbr: string;
  /** Crest, flag or team mark. Doubles as the card's background wash. */
  logo?: string;
  /**
   * The same mark, inverted for a dark background (ESPN's "500-dark").
   *
   * Needed because a mark drawn small and sharp on a near-black card has
   * to survive on its own: measured over the opaque pixels, the Yankees'
   * default mark averages luminance 27 and the Rays' 70, against a card at
   * 15. Teams whose mark already reads on dark (the Cubs) get a
   * byte-identical file, so preferring this one costs nothing.
   *
   * The blurred background wash keeps `logo`: there the point is the
   * colour, not the shape.
   *
   * Optional and not always present even when `logo` is: the pattern held
   * for every US league checked and 404s for some soccer clubs, so
   * whatever paints it needs a fallback.
   */
  logoDark?: string;
  /** Team colour, used for the card's tint. Hex, no leading #. */
  color?: string;
  /**
   * Their season record, as the sport keeps it: "59-53", "41-25-16",
   * "9-3-5".
   *
   * Absent, not zeroed, before a season has anything to say — see
   * teamRecord. Absent too for a sport that does not keep one, which is
   * every individual sport: a tennis player's record is not a fact about
   * the match in front of you.
   */
  record?: string;
  score?: number;
}

export type GameState = "pre" | "live" | "final";

/**
 * Everything on the board, whatever shape it is.
 *
 * This is the part the BOARD runs on, and the list is worth reading as a
 * claim: bucketing a day, picking the row's anchor, matching channels,
 * filtering by what you follow and opening the theater all happen up here
 * and none of them care whether the thing has two sides. Measured before
 * the split was chosen — `matcher.ts`, `day.ts` and `autoplay.ts` read no
 * side at all — which is why one collection with a discriminated union
 * beat two collections that would have forked every one of those.
 */
interface Board {
  id: string;
  /**
   * Which sport this is, in the source's own word: "soccer", "baseball",
   * "mma", "water-polo".
   *
   * A STRING, not a union, and that is a correction rather than a
   * loosening. The union named six and the comment claimed the renderer
   * branched on it; nothing in the app ever has. Meanwhile the catalog
   * carries 14 sports and any of them can now be followed, so a closed set
   * of six was a promise this field could not keep the moment D1 landed.
   */
  sport: string;
  /** Display name of the competition: "FIFA World Cup", "MLB". */
  league: string;
  /**
   * The competition's catalog path: "baseball/mlb", "soccer/eng.1". The
   * stable half of the pair, and the one anything persisted should use —
   * `league` is a display string from the source and can be reworded
   * without warning.
   *
   * The path rather than a key of our own (it was "mlb", "epl"), because
   * this is now the thing that gets FETCHED as well as the thing that gets
   * stored, and the catalog has 151 of them. One id for both jobs means a
   * followed league needs no lookup to become a request.
   *
   * Also what makes a club's id unique: source ids are numbered per league,
   * so MLB's 1 and NFL's 1 are different teams entirely.
   */
  leagueKey: string;
  state: GameState;
  /**
   * The channel list has not loaded yet, so carriage is UNKNOWN.
   *
   * Distinct from "no channel carries this". A cold start on the Sports tab
   * reaches the board before the 20k channel guide is parsed, and for that
   * window the cards were flatly asserting "Not on your channels" with no
   * basis for it. `null` already means "not yet" everywhere else in this
   * feature; this carries that meaning as far as the card.
   */
  channelsPending?: boolean;
  /** Absolute kickoff. Everything renders in local time from this. */
  start: Date;
  /** The short status string, already formatted by the adapter because
   * every sport says it differently: "41'", "TOP 2nd", "Final", "7:30 PM". */
  status: string;
  /** Stadium, city, or the circuit. Shown bottom-left on a wide card. */
  venue?: string;
  /**
   * Why this game is not an ordinary one, in the source's own words:
   * "CLE leads series 2-0", "East 1st Round - Game 2", "Hall of Fame Game".
   *
   * Rare and load-bearing when present. Never a claim about THIS game's
   * result: a series line counts the ones already played.
   */
  note?: string;
  /**
   * A wire one-liner about the fixture: "Dodgers look to stop slide in
   * matchup with the Cubs".
   *
   * Too long for a card face at 60 to 80 characters, so it is the tooltip.
   */
  headline?: string;
  /** Network names as the SOURCE calls them, before any matching. */
  broadcasts: string[];
  /** Channels of the user's own that carry this game. Resolved at render
   * time against the live channel list, never stored: playlists change and
   * a stale channel id plays the wrong thing. Empty until the matcher
   * exists (plan 010 phase 2). */
  channels: { id: string; name: string }[];
  /**
   * The channels above were all found in folders the user HID, because
   * nothing visible carried this game (plan 010's fallback). The card says
   * so rather than quietly offering a folder someone muted on purpose.
   */
  hiddenOnly?: boolean;
}

/**
 * TWO SIDES AND A SCORE, which is 134 of the catalog's 151 leagues.
 */
export interface Fixture extends Board {
  kind: "fixture";
  home: Competitor;
  away: Competitor;
}

/** One entrant in an ordered field, in finishing order. */
export interface Entrant {
  /** 1, 2, 3. */
  place: number;
  /** As the source names them: "Lando Norris". */
  name: string;
  /** The three letters a broadcast would caption them with. */
  code: string;
  /** Their country's flag. The source carries no constructor. */
  mark?: string;
}

/**
 * AN ORDERED FIELD, which is what a race session and a golf round are.
 *
 * Twenty-two entrants, no head-to-head, and the interesting part is the
 * top of it. Nothing here overlaps with a Fixture, which is the whole
 * reason the two are a union rather than one type with optional halves: a
 * Game with neither `home` nor `away` would be a lie the compiler could
 * not catch.
 */
export interface Field extends Board {
  kind: "field";
  /** "FP1", "Qual", "Race". The named part of a weekend. */
  session: string;
  /** Where, in one word: "Hungary". The circuit's own name is `venue`. */
  place: string;
  /** The circuit id, for the art and the flag. Absent outside F1. */
  circuitId?: string;
  /**
   * Is this a RACE, as opposed to practice or qualifying?
   *
   * The Grand Prix and the sprint both are. It decides whether the card
   * counts laps, because a lap number means nothing in a practice hour:
   * measured over a finished weekend, `status.period` read 19, 26, 20 and
   * 16 for the four non-race sessions and 70 for the race.
   */
  race: boolean;
  /**
   * The lap being run, and the number there are.
   *
   * `laps` is OPTIONAL and that is not tidiness. The scoreboard carries a
   * lap NUMBER and no total anywhere in the payload; the total only
   * appears if ESPN writes it into the status text, which cannot be
   * confirmed until a session is actually running (plan 010 #8). So a card
   * shows "LAP 41 / 72" when it is told the total and "LAP 41" when it is
   * not, and neither is a broken state.
   */
  lap?: number;
  laps?: number;
  /** The top of the field, or as much of it as exists yet. */
  entrants: Entrant[];
}

/**
 * A thing on the board.
 *
 * Narrow with `isField`. Anything that reads `home` or `away` has to,
 * which is 9 files and 13 sites; everything else works on the union.
 */
export type Game = Fixture | Field;

/** An ordered field rather than a fixture. */
export function isField(game: Game): game is Field {
  return game.kind === "field";
}
