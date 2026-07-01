/** "8:38 PM" — the header clock format from the redesign. */
export function formatClock(date: Date): string {
  return date.toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}
