/**
 * Whether closing the pop-out starts the Guide's channel again in the mini
 * player. Only for a pop-out the Guide opened (plan 016 F11: a game popped out
 * of Sports, closed while the Guide was up, started the Guide's own channel),
 * with a channel to start, and not over a recording the player has open: the
 * two are never open together, so the channel would play on top of it.
 */
export function resumesGuide(
  openedBy: string | null,
  channelId: string | undefined,
  recId: string | null,
): boolean {
  return openedBy === "guide" && !!channelId && !recId;
}
