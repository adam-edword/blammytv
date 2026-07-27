import type { Game } from "./model";

/**
 * Which games belong to a day, what that day is called, and which game the
 * day is "at" right now.
 *
 * Its own module for two reasons. One is Fast Refresh: a component file
 * that also exports a helper cannot be hot-swapped on its own, the same
 * reason result.ts exists. The other is that these three are the only
 * pieces of the hub with a right answer rather than a look, so they are the
 * pieces worth testing, and a test cannot reach into a component file.
 */

/**
 * The games that actually belong to a day, in kick-off order.
 *
 * Asking for a date is not the same as being given it. A league between
 * matchdays answers with its NEXT one whatever you asked for, which is how
 * a Premier League fixture 26 days out turned up under "Today".
 *
 * `keepLive` is for today only: a game that started at 11pm yesterday and
 * is still going is on now, whatever the date on it says.
 */
export function onDay(games: Game[], date: Date, keepLive: boolean): Game[] {
  const key = date.toDateString();
  return games
    .filter(
      (g) => g.start.toDateString() === key || (keepLive && g.state === "live"),
    )
    .sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * What a day's grid is called. The first two get their names; after that a
 * weekday is not enough on its own, because "Wednesday" alone could be any
 * of them.
 *
 * `today` is a parameter so this can be tested without owning the clock.
 */
export function dayLabel(date: Date, today = new Date()): string {
  const midnight = new Date(today);
  midnight.setHours(0, 0, 0, 0);
  const days = Math.round(
    (date.getTime() - midnight.getTime()) / (24 * 3600_000),
  );
  if (days === 0) return "Today";
  if (days === 1) return "Tomorrow";
  return date.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

/**
 * The game the row should open on: whatever is live, and failing that the
 * one that finished most recently, and failing that the next to start.
 *
 * In kick-off order already, so the last final is the latest one.
 */
export function nowish(today: Game[]): Game | undefined {
  return (
    today.find((g) => g.state === "live") ??
    today.filter((g) => g.state === "final").at(-1) ??
    today.find((g) => g.state === "pre")
  );
}
