/**
 * What a wide card's bottom-right says: where you can actually watch this.
 *
 * Pulled out of GameCard the moment a second wide card needed it (the race
 * card, plan 010 #4). It is the one line that makes this app a viewer
 * rather than a scores app, so two copies of it drifting apart would be
 * two different answers to the only question the hub exists to answer.
 *
 * Takes the fields rather than a Game, because a race session is not one
 * and will not be one even after the adapter lands: it is the `Field` half
 * of the union, and this is true of both halves.
 */

export interface Carriable {
  state: "pre" | "live" | "final";
  /** The channel list has not loaded yet, so carriage is UNKNOWN. */
  channelsPending?: boolean;
  channels: { id: string; name: string }[];
  /** Network names as the SOURCE calls them, before any matching. */
  broadcasts: string[];
  /** Everything that carries this was in a folder the user hid. */
  hiddenOnly?: boolean;
  /** The channels came from the curated network map, not from the source. */
  presumedOnly?: boolean;
  /** What the map says normally carries this league, tunable or not. */
  presumed?: string[];
}

/**
 * THERE IS NOTHING HERE TO PRESS.
 *
 * The whole of it, and the simplicity is the point. This started as "we
 * named a broadcaster rather than a channel", because "On Paramount+" has
 * the same grammar as "On US: MASN" and the opposite usefulness. Adam then
 * asked the obvious next question — put the badge "wherever we can't link
 * a channel" — and that collapses three conditions into one: no channels
 * means no channels, however we got there.
 *
 * Which is better than the rule it replaces, because the old one made the
 * viewer's answer depend on OUR plumbing. Whether ESPN happened to name a
 * network decided whether they got a badge, and #42 settled that they do
 * not care about that and should not have to.
 *
 * So the line now splits cleanly in two. `carriageText` says WHERE the
 * game is, when anything knows; this says whether you can act on it. They
 * are independent, which is why "On Paramount+" carries both and the state
 * where nothing is known carries only this one.
 *
 * A predicate rather than a flag on the game: it is derivable from what is
 * already there, and this file is where the meaning of that line lives.
 * See the header — two answers to the same question is the failure mode
 * this module exists to prevent.
 */
export function carriageUnlinked(item: Carriable): boolean {
  // Not yet known is not the same as nothing. The catalog is still loading
  // and the line says so itself.
  if (item.channelsPending) return false;
  // Nothing to flag on a game that has finished: the foot swaps the whole
  // carriage line out for when it started, so a pill would be marking a
  // sentence that is not on screen.
  if (item.state === "final") return false;
  return item.channels.length === 0;
}

/**
 * WHERE the game is, in as few words as the truth allows, or nothing.
 *
 * Half of the answer. The other half — whether any of it is pressable —
 * is `carriageUnlinked`, and the two are deliberately independent: "On
 * Paramount+" is a true statement about where a game is AND a dead end,
 * and one string trying to carry both is what produced four wordings in
 * eight versions.
 *
 * Returns "" when nothing knows where the game is. That is not a missing
 * case, it is the case: the pill says the actionable part, and a sentence
 * beside it would be repeating it.
 */
export function carriageText(item: Carriable): string {
  // One channel names it; several advertise the choice, because being able
  // to hop is the reason to use this tab. "Live on" only where it is true:
  // a game at 8:30 is not live on anything yet.
  const on = item.state === "live" ? "Live on" : "On";
  // A match found only in a folder the viewer hid says so. It is still
  // offered, because they asked for the game and this is the only copy of
  // it, but calling it "Live on 1 channel" would be a small lie about a
  // folder somebody muted deliberately.
  const where = item.hiddenOnly ? "in a hidden folder" : "";
  if (item.channelsPending) return "Checking your channels…";
  if (item.channels.length === 0)
    return item.broadcasts.length > 0
      ? `On ${item.broadcasts[0]}`
      : // The map knows where this league lives even though the playlist
        // has nothing to show for it. Naming the network is the same
        // courtesy "On Peacock" already extends when the SOURCE names
        // something nobody carries: you cannot press it, but you now know
        // where to go looking.
        item.presumed && item.presumed.length > 0
        ? `Usually found on ${item.presumed[0]}`
        : /* SAY WHETHER IT LINKS. Nothing else.
           *
           * Adam, settling it: "people don't care that ESPN didn't have a
           * channel listed, just if it links to their EPG or not." The
           * three-way distinction sitting behind this line — no broadcast
           * name at all, a name we could not match, a name we matched — is
           * real, and it is entirely OUR business. The viewer has one
           * question and it is binary: can I press this. So the line
           * answers that and does not explain itself.
           *
           * It took three goes to get there, and the wrong turns are worth
           * keeping because each was defensible on its own terms.
           *
           * This line has said, in order:
           *   "Not on your channels"            - a claim about the playlist
           *   "Couldn't find a matching channel"- a search that never ran
           *   "No channel listed for this game" - a claim about the world
           *   "Could not link channel"          - a claim about US, at last
           *
           * Each fixed the last one's lie and told a new one, and all three
           * of the first ones describe the WORLD. v0.8.149 was the closest
           * miss: reaching here means an EMPTY broadcasts list, so nothing
           * was ever searched for, and saying so seemed more honest than
           * implying a failed search. Adam, reading it back: it "still
           * implies there isn't a channel in the entire EPG that has these
           * games, not that it couldn't be linked... we can't really know
           * that." The schedule naming no broadcaster is a fact about
           * ESPN's payload, not about a 20,000 channel playlist.
           *
           * The fourth wording, "Could not link channel", was right and is
           * now UNSAID, which is the fifth and hopefully last move. It is
           * the pill's job: `carriageUnlinked` is true here and every
           * renderer draws the badge, so a sentence saying the same thing
           * would be the caption to its own icon. Nothing is known about
           * where this game is, so the WHERE half has nothing to say and
           * says nothing.
           *
           * Scale, for why this empty string matters more than it looks:
           * measured across all 151 leagues, 1,539 games carried 32
           * broadcast names between them, and tennis carried none over
           * 1,462 matches. This is the default state for most of the
           * catalog. See networkMap.ts, which is the real fix for the
           * leagues it can cover. */
          "";
  // A GUESS FROM THE MAP, worded as one. The channels are real and tunable,
  // so they are offered, but what we know is that the LEAGUE normally lives
  // there — not that this game does. "Live on 2 channels" would be the app
  // stating as fact something no source told it, which is the one thing
  // this feature has consistently refused to do.
  //
  // "FOUND ON" rather than a bare "on", Adam's call, and the same phrasing
  // whether or not it resolved to something pressable. It reads as a
  // statement about where the league lives generally, which is exactly the
  // claim being made; "Usually on" leans closer to being about this game.
  // Measured before choosing it, since it is the longest string the slot
  // ever holds: 302px against a 697px budget on the wide card.
  if (item.presumedOnly) {
    const what =
      item.channels.length === 1
        ? item.channels[0].name
        : `${item.channels.length} channels`;
    const guess = `Usually found on ${what}${where && ` ${where}`}`;
    // BOTH, where the schedule named something we could not find. The map
    // is only reached now because that name matched nothing, and the two
    // facts are different sizes: "On Paramount+" is about this fixture and
    // came from the source, the guess is about the league and came from
    // us. Dropping the first would be the MLB.TV mistake — a schedule
    // naming a particular feed is telling you the game is not on the
    // ordinary one, and that is worth knowing even while we offer the
    // ordinary one to try. Keeping both is what made the fall-through
    // safe enough to do at all.
    return item.broadcasts.length > 0
      ? `On ${item.broadcasts[0]} · ${guess}`
      : guess;
  }
  if (item.channels.length === 1)
    return `${on} ${item.channels[0].name}${where && ` ${where}`}`;
  return `${on} ${item.channels.length} channels${where && ` ${where}`}`;
}
