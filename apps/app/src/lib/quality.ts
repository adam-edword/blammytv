/**
 * Best-effort stream-quality tags parsed from a channel/provider name.
 *
 * IPTV listings carry no real resolution/HDR/fps metadata (Xtream's API doesn't
 * expose it) — the only pre-play signal is what the provider stuffs into the
 * channel name, e.g. "FOX SPORTS 4K", "ESPN FHD HDR". So these badges are a
 * heuristic over the name, not ground truth.
 */

/** A single resolution tag (highest wins), plus additive HDR / FPS markers. */
export function qualityTags(name: string): string[] {
  const s = name ?? "";
  const tags: string[] = [];

  // Resolution — mutually exclusive, pick the most specific.
  if (/\b(4k|uhd|2160p?)\b/i.test(s)) tags.push("4K");
  else if (/\b(fhd|1080p?)\b/i.test(s)) tags.push("FHD");
  else if (/\bhd\b/i.test(s)) tags.push("HD");
  else if (/\bsd\b/i.test(s)) tags.push("SD");

  if (/\bhdr\b/i.test(s)) tags.push("HDR");
  if (/\b(60\s?fps|60p)\b/i.test(s)) tags.push("60FPS");

  return tags;
}
