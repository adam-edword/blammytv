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
        ? `Usually on ${item.presumed[0]}`
        : /* NOT "couldn't find a matching channel", which is what this said
         * until #27 measured what actually reaches here. That sentence
         * describes a search that ran and missed, and this branch is the
         * opposite case: the only way to arrive here is with an EMPTY
         * broadcasts list, because a non-empty one is answered above. There
         * was no name to match, so nothing was searched for.
         *
         * The difference is not pedantry, it is most of the catalog.
         * Measured across all 151 leagues, 1,539 games carried 32 broadcast
         * names between them; tennis carried none at all over 1,462
         * matches. Telling that many people we looked and failed was
         * blaming the matcher for a field the source never sent, and it
         * pointed at the wrong fix. See networkMap.ts, which is the right
         * one for the leagues it can cover. */
        "No channel listed for this game";
  // A GUESS FROM THE MAP, worded as one. The channels are real and tunable,
  // so they are offered, but what we know is that the LEAGUE normally lives
  // there — not that this game does. "Live on 2 channels" would be the app
  // stating as fact something no source told it, which is the one thing
  // this feature has consistently refused to do.
  if (item.presumedOnly) {
    const what =
      item.channels.length === 1
        ? item.channels[0].name
        : `${item.channels.length} channels`;
    return `Usually on ${what}${where && ` ${where}`}`;
  }
  if (item.channels.length === 1)
    return `${on} ${item.channels[0].name}${where && ` ${where}`}`;
  return `${on} ${item.channels.length} channels${where && ` ${where}`}`;
}
