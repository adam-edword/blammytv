/** Header clock: "8:38 PM" (the design's default) or 24-hour "20:38". */
export function formatClock(date: Date, format: "12h" | "24h" = "12h"): string {
  if (format === "24h") {
    return date.toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  }
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
