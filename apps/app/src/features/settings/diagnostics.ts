import { scrub } from "../../lib/scrub";
import type { AboutRow } from "./aboutRows";

/**
 * What Copy Diagnostics puts on the clipboard (plan 025, P4b), as plain text a
 * person can paste into a message: the versions, what this window is running
 * in, and the end of the log.
 *
 * Built here from what the page was told, so it can be tested without a page.
 * EVERYTHING goes through the scrubber at the end, the versions and the user
 * agent as well as the log: the log was scrubbed once by the page that wrote
 * it and once by native's own care, and it is scrubbed again because this text
 * is the thing that leaves the PC.
 */

/** How many lines of the log are copied. */
export const LOG_LINES = 200;

export interface DiagnosticsInput {
  /** The page's own version (lib/version.ts). */
  app: string;
  /** What native said of the rest (aboutRows), in the order About draws them.
   * Empty when native could not say, or there is no native. */
  rows: readonly AboutRow[];
  /** The webview's user agent. */
  userAgent: string;
  /** The log's last lines, oldest first. Null when native could not give them:
   * an older build with no `log_tail`, or a plain browser. An empty list is a
   * log with nothing in it yet. */
  log: readonly string[] | null;
  /** When it was copied. */
  when: Date;
}

export function composeDiagnostics({ app, rows, userAgent, log, when }: DiagnosticsInput): string {
  const lines = [
    `BlammyTV diagnostics, ${when.toISOString()}`,
    "",
    `App: ${app}`,
    ...rows.map((r) => `${r.label}: ${r.value}`),
    `Webview: ${userAgent.trim() || "unknown"}`,
    "",
  ];
  if (log === null) {
    lines.push("Log: the log wasn't available.");
  } else if (log.length === 0) {
    lines.push("Log: empty.");
  } else {
    lines.push(`Log, the last ${log.length} ${log.length === 1 ? "line" : "lines"}:`, ...log);
  }
  return scrub(lines.join("\n"));
}
