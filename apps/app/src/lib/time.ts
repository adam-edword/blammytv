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
  let fmt = cache.get(format);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat(LOCALES[format], FORMATS[format]);
    cache.set(format, fmt);
  }
  return fmt.format(date);
}
