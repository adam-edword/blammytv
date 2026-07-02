import type { Quality } from "./mock";

/**
 * Best-effort stream quality from a channel/source title. IPTV listings
 * carry no real resolution metadata (Xtream's API doesn't expose it) — the
 * only pre-play signal is what the provider stuffs into the name, e.g.
 * "FOX SPORTS 4K", "ESPN | FHD", "BT Sport UHD HDR". A heuristic, not
 * ground truth.
 *
 * One badge per channel: 4K beats HDR beats FHD beats HD. Plain-SD and
 * unmarked names get no badge at all.
 */

const RE_4K = /\b(?:4k|uhd|ultra[\s-]?hd|2160[pi]?)\b/i;
const RE_HDR = /\b(?:hdr(?:10)?|dolby[\s-]?vision)\b/i;
const RE_FHD = /\b(?:fhd|full[\s-]?hd|1080[pi]?)\b/i;
const RE_HD = /\b(?:hd|720[pi]?)\b/i;

export function extractQuality(title: string): Quality | null {
  if (RE_4K.test(title)) return "4K";
  if (RE_HDR.test(title)) return "HDR";
  if (RE_FHD.test(title)) return "FHD";
  if (RE_HD.test(title)) return "HD";
  return null;
}
