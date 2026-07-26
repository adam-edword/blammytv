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
  /** Team colour, used for the card's tint. Hex, no leading #. */
  color?: string;
  score?: number;
}

export type GameState = "pre" | "live" | "final";

export interface Game {
  id: string;
  /** Which sport's card layout to use. Each sport reads its clock and its
   * score differently, so the renderer branches on this rather than trying
   * to be universal. */
  sport: "soccer" | "football" | "basketball" | "baseball" | "hockey" | "f1";
  /** Display name of the competition: "FIFA World Cup", "MLB". */
  league: string;
  state: GameState;
  /** Absolute kickoff. Everything renders in local time from this. */
  start: Date;
  /** The short status string, already formatted by the adapter because
   * every sport says it differently: "41'", "TOP 2nd", "Final", "7:30 PM". */
  status: string;
  home: Competitor;
  away: Competitor;
  /** Stadium or city, shown bottom-left. */
  venue?: string;
  /** Network names as the SOURCE calls them, before any matching. */
  broadcasts: string[];
  /** Channels of the user's own that carry this game. Resolved at render
   * time against the live channel list, never stored: playlists change and
   * a stale channel id plays the wrong thing. Empty until the matcher
   * exists (plan 010 phase 2). */
  channels: { id: string; name: string }[];
}
