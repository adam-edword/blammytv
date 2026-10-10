/**
 * Header clock: "8:38 PM" (the design's default) or 24-hour "20:38".
 *
 * The formatters are built ONCE, lazily. `date.toLocaleTimeString(locale,
 * options)` constructs a fresh Intl.DateTimeFormat on every single call:
 * 0.09ms against 0.01ms for a cached one. That is nothing for the header's
 * one call a minute, and a lot for Guide, which draws a "from – to" range
 * on every programme block in the grid — two calls each, hundreds of
 * blocks. Measured: switching to the live side put a 96-173ms long task on
 * the main thread, and the nav capsule's transition froze inside it.
 *
 * Same output as before: toLocaleTimeString is specified as building this
 * exact formatter and calling format(), and both time components are given
 * here, so neither path falls back on any defaults.
 */
const FORMATS: Record<"12h" | "24h", Intl.DateTimeFormatOptions> = {
  "12h": { hour: "numeric", minute: "2-digit" },
  "24h": { hour: "2-digit", minute: "2-digit", hour12: false },
};
const LOCALES: Record<"12h" | "24h", string> = { "12h": "en-US", "24h": "en-GB" };

const cache = new Map<string, Intl.DateTimeFormat>();

export function formatClock(date: Date, format: "12h" | "24h" = "12h"): string {
  // A formatter throws on an invalid date, where toLocaleTimeString said
  // "Invalid Date". A feed's missing time is dropped further on; it must
  // not take the whole board down on the way (racing.test.ts has one).
  if (Number.isNaN(date.getTime())) return "";
  let fmt = cache.get(format);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(LOCALES[format], FORMATS[format]);
    cache.set(format, fmt);
  }
  return fmt.format(date);
}

const DAY = new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric" });

/**
 * A moment that may not be today: "9:14 AM" when it is, "Oct 9, 9:14 PM"
 * when it isn't, in the clock the user chose. For a stamp the reader needs
 * to place ("last refreshed"), where a bare time would say nothing about
 * which day. Local time, like formatClock. Empty for an invalid date.
 */
export function formatWhen(date: Date, now: Date, format: "12h" | "24h" = "12h"): string {
  const clock = formatClock(date, format);
  if (!clock) return "";
  const today =
    date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
  return today ? clock : `${DAY.format(date)}, ${clock}`;
}

/**
 * A calendar date that a feed sends as an instant, as LOCAL midnight of
 * that date: formatted or filed by day in local time, it is then the same
 * day everywhere.
 *
 * Two feeds do this, and neither means a moment. Measured 2026-09-27:
 * - ESPN's golf `date` and `endDate`: midnight US Eastern on all 115 PGA,
 *   LPGA and DP World events of 2026, Thailand and Dubai included, so
 *   `T04:00Z` in summer and `T05:00Z` in winter.
 * - Cinemeta's episode `released`: `T05:00:00.000Z` on every Breaking Bad
 *   episode, summer and winter. Other addons send `T00:00:00Z`.
 * Read as instants, west of Eastern they are the day before: in Chicago
 * the Wyndham Championship, Thursday 6th to Sunday 9th, read "AUG 5-8",
 * and filed itself under the Wednesday. All of them fall on their own day
 * in UTC, so that is the day taken.
 *
 * Not for a real start time (a kickoff, a race): those are moments, and a
 * 7pm kickoff in New York is rightly 6pm in Chicago.
 *
 * Unparseable gives an Invalid Date, as `new Date` does.
 */
export function calendarDay(iso: string): Date {
  const at = new Date(iso);
  return new Date(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate());
}
