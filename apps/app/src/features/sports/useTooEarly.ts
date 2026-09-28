import { useEffect, useState } from "react";
import { OPEN_LEAD_MS, tooEarly } from "./day";
import type { Game } from "./model";

/**
 * `tooEarly`, kept current. The cards are memoised, and a game whose data
 * hasn't changed hands back the same object, so a card can go hours
 * without rendering. It used to stay unclickable after its game came
 * inside the window, until something else about the game changed (the
 * Sports audit). A card that is too early now wakes itself as it crosses.
 */
export function useTooEarly(game: Game): boolean {
  const early = tooEarly(game);
  const [, wake] = useState(0);
  const start = game.start.getTime();
  useEffect(() => {
    if (!early) return;
    const wait = start - OPEN_LEAD_MS - Date.now() + 500;
    // setTimeout's own limit (about 24.8 days); past it, it fires at once.
    const t = window.setTimeout(() => wake((n) => n + 1), Math.min(Math.max(0, wait), 2 ** 31 - 1));
    return () => window.clearTimeout(t);
  }, [early, start]);
  return early;
}
