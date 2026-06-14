/** Emoji helpers. Used to collapse a source's title down to just its emoji. */

// One emoji "grapheme": a pictographic base plus any variation selector and
// ZWJ-joined parts (so 👨‍👩‍👧 and 🏳️‍🌈 count as one).
const EMOJI_RE =
  /\p{Extended_Pictographic}(?:️|‍\p{Extended_Pictographic})*/gu;

/** All emoji in a string, concatenated (e.g. "World Cup ⚽ 🏆" → "⚽🏆"). */
export function extractEmoji(s: string): string {
  return (s.match(EMOJI_RE) ?? []).join("");
}
