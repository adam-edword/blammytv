/**
 * Source titles from real providers often carry an emoji ("🇺🇸 US SPORTS",
 * "⚽ | FOOTBALL"). The first emoji becomes the row's icon and is removed
 * from the label; titles without one fall back to a stock icon.
 *
 * Graphemes come from Intl.Segmenter so flags (regional-indicator pairs),
 * ZWJ families and variation-selector sequences stay whole. A cluster
 * counts as an emoji when it has emoji *presentation* — a colored glyph by
 * default, a regional indicator, or an explicit VS16 — so text-style
 * symbols in names (™, ©, №) are left alone.
 */

const graphemes = new Intl.Segmenter(undefined, { granularity: "grapheme" });

const EMOJI_CUE = /\p{Emoji_Presentation}|\p{Regional_Indicator}|\uFE0F/u;

/** Leading separators left behind once a leading emoji is removed. */
const DANGLING_LEAD = /^[\s|\-–—•·:]+/;

export function splitTitleEmoji(title: string): {
  emoji: string | null;
  label: string;
} {
  for (const { segment, index } of graphemes.segment(title)) {
    if (!EMOJI_CUE.test(segment)) continue;
    const label = (title.slice(0, index) + title.slice(index + segment.length))
      .replace(/\s{2,}/g, " ")
      .replace(DANGLING_LEAD, "")
      .trimEnd();
    // A title that is nothing but the emoji keeps it as the label too.
    return { emoji: segment, label: label || title.trim() };
  }
  return { emoji: null, label: title.trim() };
}
