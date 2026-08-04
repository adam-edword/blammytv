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
           * ESPN's payload, not about a 20,000 channel playlist. The
           * current wording is about what WE did, so it cannot be wrong.
           *
           * Scale, for why this sentence matters more than it looks:
           * measured across all 151 leagues, 1,539 games carried 32
           * broadcast names between them, and tennis carried none over
           * 1,462 matches. This is the default answer for most of the
           * catalog. See networkMap.ts, which is the real fix for the
           * leagues it can cover. */
          "Could not link channel";
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
    return `Usually found on ${what}${where && ` ${where}`}`;
  }
  if (item.channels.length === 1)
    return `${on} ${item.channels[0].name}${where && ` ${where}`}`;
  return `${on} ${item.channels.length} channels${where && ` ${where}`}`;
}
