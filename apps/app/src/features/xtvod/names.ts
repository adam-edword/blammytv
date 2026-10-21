/**
 * What a provider's title says (plan 028). A panel names a movie the way it
 * files it: "4K The Fantastic 4: First Steps (2025)", the quality in front and
 * the year behind. The card wants "The Fantastic 4: First Steps", 2025, and the
 * quality goes to the source the title came from.
 *
 * Conservative on purpose: a title that loses a word it needs is worse than one
 * that keeps a tag it did not need. So a leading tag comes off only in a form
 * no title is written in:
 *
 *   4K, UHD, FHD, 2160p, 1080p, 720p   followed by a space or a separator
 *   HD, SD, HDR                        only in brackets or before a separator
 *   (any of them)                      "[4K] Movie", "(FHD) Movie"
 *
 * The first group are not words ("4K The Movie" is a tag). The second group
 * are ("HD Radio Story" and "SD Gundam" are titles), so they need to be set
 * apart: "HD | Movie", "HD - Movie", "HD: Movie", "[HD] Movie". A separator is
 * a "|", or a "-" or ":" with a space after it, so "HD-DVD Collection" stays.
 * The exception is a second tag: once one has come off, "HDR" with a space
 * after it is a tag too ("4K HDR The Movie"), as there is no title yet.
 * "The 4400", "4 Weddings and a Funeral" and "Fantastic 4" have no tag in them
 * at all: "4" is not "4K".
 *
 * Pure: no network, no storage.
 */

import type { Quality } from "../live/model";
import { extractQuality } from "../live/quality";

/** What a title's tag says about the file. Live's badge set, and SD for the
 * tag Live has no badge for. Null is a name with no tag, which says nothing. */
export type XtQuality = Quality | "SD";

export interface ParsedName {
  title: string;
  year?: number;
  quality: XtQuality | null;
}

const PLAIN = "4k|uhd|fhd|2160p|1080p|720p";
const WORDY = "hd|sd|hdr";
// A "|" with any space around it, or a "-", en or em dash, or ":" with a
// space after it (the dashes as escapes, so no source line holds one).
const SEP = String.raw`\s*(?:\||[:\-\u2013\u2014]\s)\s*`;

const LEADING = new RegExp(
  String.raw`^(?:[\[(]\s*(${PLAIN}|${WORDY})\s*[\])](?:${SEP}|\s*)` +
    String.raw`|(${PLAIN})(?:${SEP}|\s+)` +
    String.raw`|(${WORDY})${SEP})(?=\S)`,
  "i",
);

// A word-like tag with only a space after it, where another tag came first.
const FOLLOWING = new RegExp(String.raw`^(${WORDY})(?:${SEP}|\s+)(?=\S)`, "i");

const TRAILING_YEAR = /\s*\((\d{4})\)$/;

/** Whether a number is a year a film or show can carry. "(2160)" and "(1080)"
 * are not years. */
export const validYear = (n: number): boolean => n >= 1880 && n <= 2100;

/** The most tags read off one name ("4K UHD HDR The Movie" is three). */
const MAX_TAGS = 4;

export function parseName(raw: string): ParsedName {
  let rest = raw.replace(/\s+/g, " ").trim();
  const tags: string[] = [];
  for (let i = 0; i < MAX_TAGS; i++) {
    const m = LEADING.exec(rest) ?? (tags.length > 0 ? FOLLOWING.exec(rest) : null);
    if (!m) break;
    tags.push(m[1] ?? m[2] ?? m[3]);
    rest = rest.slice(m[0].length);
  }

  let year: number | undefined;
  const y = TRAILING_YEAR.exec(rest);
  if (y) {
    const n = Number(y[1]);
    const left = rest.slice(0, y.index).trim();
    // A year alone is the whole name: keep it as the title.
    if (validYear(n) && left) {
      year = n;
      rest = left;
    }
  }

  const said = tags.join(" ");
  const quality: XtQuality | null = extractQuality(said) ?? (/\bsd\b/i.test(said) ? "SD" : null);
  return { title: rest, ...(year !== undefined ? { year } : {}), quality };
}
