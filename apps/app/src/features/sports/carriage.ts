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
      : /* Adam's wording, and it is more honest than the old "Not on your
         * channels": we did not find a match, which is not the same claim
         * as it not being there. The matcher works on broadcaster names
         * against a 20k channel list and misses; saying so leaves the
         * possibility open rather than telling someone their provider does
         * not carry a game it may well carry. */
        "Couldn't find a matching channel";
  if (item.channels.length === 1)
    return `${on} ${item.channels[0].name}${where && ` ${where}`}`;
  return `${on} ${item.channels.length} channels${where && ` ${where}`}`;
}
