import { load, save } from "../../lib/storage";

/** Header clock format. Saving notifies listeners (the header) so the clock
 * flips immediately, not on the next tick. */

export type ClockFormat = "12h" | "24h";

const KEY = "clockFormat";
const VERSION = 1;
const EVENT = "blammytv:clock-format";

export function loadClockFormat(): ClockFormat {
  return load<ClockFormat>(KEY, VERSION, "12h") === "24h" ? "24h" : "12h";
}

export function saveClockFormat(format: ClockFormat): void {
  save(KEY, VERSION, format);
  window.dispatchEvent(new CustomEvent(EVENT, { detail: format }));
}

export function onClockFormatChange(
  cb: (format: ClockFormat) => void,
): () => void {
  const handler = (e: Event) =>
    cb((e as CustomEvent<ClockFormat>).detail === "24h" ? "24h" : "12h");
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
