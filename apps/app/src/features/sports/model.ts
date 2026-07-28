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
  /**
   * Our own key for the competition: "mlb", "epl". The stable half of the
   * pair, and the one anything persisted should use — `league` is a display
   * string from the source and can be reworded without warning.
   *
   * Also what makes a club's id unique: source ids are numbered per league,
   * so MLB's 1 and NFL's 1 are different teams entirely.
   */
  leagueKey: string;
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
  /**
   * The channels above were all found in folders the user HID, because
   * nothing visible carried this game (plan 010's fallback). The card says
   * so rather than quietly offering a folder someone muted on purpose.
   */
  hiddenOnly?: boolean;
}
