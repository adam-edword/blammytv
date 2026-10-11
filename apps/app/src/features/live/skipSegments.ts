import type { SkipType } from "../settings/skipping";
import type { ChapterInfo } from "./overlayApi";

/**
 * Where the player is inside a skippable stretch, and what kind it is.
 *
 * The overlay used to work this out inline and name it with a label. Skipping
 * (plan 025, P3a) gives each kind its own setting, so the kind is the thing
 * that has to come out, and the label follows from it.
 */

/** Chapter titles worth a Skip button. Deliberately conservative: a
 * false "Skip Intro" over real content is worse than a missing one. */
export const SKIP_RX =
  /\b(intro|opening|op|recap|previously|credits|ending|ed|outro|preview)\b/i;
export const CREDITS_RX = /credits|ending|outro|\bed\b/i;
export const PREVIEW_RX = /preview/i;
const RECAP_RX = /recap|previously/i;

/** The kind of an AniSkip or marker interval (op/ed/mixed-op/mixed-ed/recap,
 * and AIOStreams' preview). Null for any other: it has no setting, so it is
 * not a stretch. Both sources only ever send the ones named. */
export function remoteSkipType(type: string): SkipType | null {
  switch (type) {
    case "op":
    case "mixed-op":
      return "intro";
    case "ed":
    case "mixed-ed":
      return "credits";
    case "recap":
      return "recap";
    case "preview":
      return "preview";
    default:
      return null;
  }
}

/** The kind of a chapter that already passed SKIP_RX. Credits before preview,
 * and anything left (intro, opening, op) is the intro. */
export function chapterSkipType(title: string): SkipType {
  if (RECAP_RX.test(title)) return "recap";
  if (CREDITS_RX.test(title)) return "credits";
  if (PREVIEW_RX.test(title)) return "preview";
  return "intro";
}

const NAMES: Record<SkipType, string> = {
  intro: "Intro",
  recap: "Recap",
  credits: "Credits",
  preview: "Preview",
};

/** The chip's words. */
export const skipChipLabel = (type: SkipType): string => `Skip ${NAMES[type]}`;
const COMBINED_LABEL = "Skip Credits & Preview";

/** What the chip's place says for four seconds after an automatic skip. */
export const skippedLabel = (label: string): string => label.replace(/^Skip /, "Skipped ");

export interface SkipSegment {
  type: SkipType;
  start: number;
  /** Where a skip lands, never past the end of the file. */
  end: number;
  /** The chip's words: "Skip Intro", or "Skip Credits & Preview" for a run. */
  label: string;
  /** Names this stretch for the length of one play. */
  key: string;
}

export interface SkipInputs {
  pos: number;
  dur: number;
  /** AniSkip or marker intervals (meta.skips). They go first: community
   * timed, not guessed from a title. */
  skips?: ReadonlyArray<{ type: string; start: number; end: number }>;
  chapters: ReadonlyArray<ChapterInfo>;
  /** Merge a run of credits and preview chapters into one jump. */
  combine: boolean;
}

/** A stretch covering half the file is mislabelled content, not an intro. */
const MAX_SHARE = 0.5;

const segment = (type: SkipType, start: number, end: number, label: string): SkipSegment => ({
  type,
  start,
  end,
  label,
  key: `${type}:${start}-${end}`,
});

/**
 * The stretch `pos` is inside, or null. Intervals first; the file's chapter
 * titles when no interval has it. An interval of a kind with no setting is not
 * a stretch, and a chapter under an interval never wins over it.
 */
export function skipSegmentAt({ pos, dur, skips, chapters, combine }: SkipInputs): SkipSegment | null {
  if (!(dur > 0)) return null;
  for (const s of skips ?? []) {
    if (!(pos >= s.start && pos < s.end && s.end - s.start < dur * MAX_SHARE)) continue;
    const type = remoteSkipType(s.type);
    if (type) return segment(type, s.start, Math.min(s.end, dur), skipChipLabel(type));
  }
  if (chapters.length <= 1) return null;
  const idx = chapters.findIndex(
    (c, i) => pos >= c.start && (i + 1 >= chapters.length || pos < chapters[i + 1].start),
  );
  if (idx < 0 || !SKIP_RX.test(chapters[idx].title)) return null;
  const tailish = (t: string) => CREDITS_RX.test(t) || PREVIEW_RX.test(t);
  let last = idx;
  if (combine && tailish(chapters[idx].title)) {
    while (last + 1 < chapters.length && tailish(chapters[last + 1].title)) last++;
  }
  const end = last + 1 < chapters.length ? chapters[last + 1].start : dur;
  const start = chapters[idx].start;
  // The last chapter has no next one to end it, so `pos` can sit past its end:
  // at the very end of the file, which a skip to the end puts it. Nothing is
  // left to skip there.
  if (!(pos < end && end - start < dur * MAX_SHARE)) return null;
  const span = chapters.slice(idx, last + 1).map((c) => c.title);
  // A run with both in it is a credits stretch, so it takes Credits' setting.
  const both = last > idx && span.some((t) => CREDITS_RX.test(t)) && span.some((t) => PREVIEW_RX.test(t));
  if (both) return segment("credits", start, end, COMBINED_LABEL);
  const type = chapterSkipType(chapters[idx].title);
  return segment(type, start, end, skipChipLabel(type));
}
