/**
 * An update's notes, ready to show under the update row (plan 025, P4a).
 *
 * They come from `latest.json` or `frontend.json`, over the network, from a
 * file that is not signed. So they are TEXT, always: the row draws what this
 * returns as a React text child and never as HTML, and a `<b>` in a note shows
 * as the characters `<b>`. Native has already cut them to a size and dropped
 * the control characters (about.rs); this makes them fit a row.
 *
 * Markdown headings lose their `#` (a release's notes are often written as a
 * heading and a list); nothing else is touched. Line breaks stay, runs of
 * blank lines become one, and the whole thing is cut at NOTES_LINES lines with
 * a line of its own that says "…".
 */

/** How many lines of notes the row shows before it says there is more. */
export const NOTES_LINES = 6;
/** The longest a line gets before it is cut. A note is a sentence or two. */
export const NOTES_LINE_CHARS = 160;

/** A heading marker, the CommonMark way: one to six `#` and then a space, or
 * `#`s and nothing. `#1 fix` is not a heading. */
const HEADING = /^ {0,3}#{1,6}(?:[ \t]+|$)/;

export function noteLines(raw: string | null | undefined): string[] {
  if (typeof raw !== "string") return [];
  const lines: string[] = [];
  for (const line of raw.split(/\r\n|\r|\n/)) {
    const text = line.replace(HEADING, "").trim();
    if (!text) {
      // Blank lines are kept as one, never first and never twice.
      if (lines.length && lines[lines.length - 1] !== "") lines.push("");
      continue;
    }
    const chars = [...text];
    lines.push(chars.length > NOTES_LINE_CHARS ? chars.slice(0, NOTES_LINE_CHARS - 1).join("") + "…" : text);
  }
  while (lines.length && lines[lines.length - 1] === "") lines.pop();
  if (lines.length <= NOTES_LINES) return lines;
  const kept = lines.slice(0, NOTES_LINES);
  while (kept.length && kept[kept.length - 1] === "") kept.pop();
  return [...kept, "…"];
}
