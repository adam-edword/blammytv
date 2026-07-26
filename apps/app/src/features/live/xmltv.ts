import type { Programme } from "./model";
import { EPG_KEEP_AHEAD_MS } from "./epgWindow";

/**
 * XMLTV parsing, ported from the old build's proven mapper: the panel's
 * `xmltv.php` returns one document covering every channel; we parse it with
 * the WebView's native DOMParser, window it to keep the result bounded, and
 * match programmes to channels by their `epg_channel_id`.
 */

/** Keep an hour of history (the guide window opens slightly in the past)
 * and enough future listings that a snapshot stays USEFUL for as long as it
 * is allowed to be served.
 *
 * These two numbers are a pair. The disk cache hydrates a snapshot up to
 * `DISK_MAX_AGE_MS` old; keeping less future than that means an old
 * snapshot loads instantly and shows a screen of "No Information", which is
 * the failure it was meant to prevent. The extra 4h is the guide's own
 * visible window, so even a snapshot at the very edge of its life still
 * fills the screen. Import rather than re-declare: two constants that must
 * agree are one constant. */
const PAST_MS = 60 * 60 * 1000;
const FUTURE_MS = EPG_KEEP_AHEAD_MS;

/** Why a guide matched as few channels as it did. Matching is EXACT string
 * equality between the panel's `epg_channel_id` and the document's
 * `channel` attribute, so a provider that disagrees with itself about case
 * or formatting loses those channels silently. These counts separate "the
 * guide genuinely has nothing for those channels" from "it has the data
 * and we failed to match it", which are completely different problems. */
export interface XmltvStats {
  /** Distinct channel ids the document declares. */
  guideChannels: number;
  /** Our ids that found nothing, and theirs we never used. Samples only. */
  unmatchedOurs: string[];
  unmatchedTheirs: string[];
}

/**
 * Parse an XMLTV document into per-channel programme lists.
 *
 * @param byEpgId epg channel id → our channel ids (one EPG feed can back
 *   several channels, e.g. the same channel in two categories).
 * @param stats optional out-param, filled with match diagnostics.
 */
export function parseXmltv(
  xml: string,
  byEpgId: Map<string, string[]>,
  now: Date,
  stats?: XmltvStats,
): Map<string, Programme[]> {
  const out = new Map<string, Programme[]>();
  if (byEpgId.size === 0) return out;

  let doc: Document;
  try {
    doc = new DOMParser().parseFromString(xml, "text/xml");
    if (doc.querySelector("parsererror")) return out;
  } catch {
    return out;
  }

  const from = now.getTime() - PAST_MS;
  const to = now.getTime() + FUTURE_MS;

  // Only when asked: which of their ids we never used. Cheap (a Set of the
  // document's <channel> ids), and it is the difference between a thin
  // guide and a matching bug.
  const theirs = stats
    ? new Set(
        Array.from(doc.getElementsByTagName("channel"))
          .map((c) => c.getAttribute("id") ?? "")
          .filter(Boolean),
      )
    : null;
  if (stats && theirs) stats.guideChannels = theirs.size;

  for (const prog of Array.from(doc.getElementsByTagName("programme"))) {
    const targets = byEpgId.get(prog.getAttribute("channel") ?? "");
    if (!targets) continue;
    const start = parseXmltvTime(prog.getAttribute("start"));
    const stop = parseXmltvTime(prog.getAttribute("stop"));
    if (start == null || stop == null || stop < from || start > to) continue;

    const title =
      prog.getElementsByTagName("title")[0]?.textContent?.trim() ?? "";
    // Skip filler entries ("To Be Announced", "No Information", untitled…).
    // Providers often add a day-spanning placeholder that overlaps the real
    // programmes — it collides with them in the guide and clutters the hero.
    if (isFillerTitle(title)) continue;
    const synopsis =
      prog.getElementsByTagName("desc")[0]?.textContent?.trim() || undefined;

    for (const chId of targets) {
      const list = out.get(chId) ?? [];
      list.push({
        title,
        synopsis,
        start: new Date(start),
        end: new Date(stop),
      });
      out.set(chId, list);
    }
  }

  for (const list of out.values())
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
  if (stats && theirs) {
    // Ours that got nothing: the guide either lacks them or spells them
    // differently. Theirs we never touched: data sitting unused. Comparing
    // the two samples side by side is what reveals a case/format mismatch.
    for (const id of byEpgId.keys()) {
      if (stats.unmatchedOurs.length >= 6) break;
      if (!theirs.has(id)) stats.unmatchedOurs.push(id);
    }
    for (const id of theirs) {
      if (stats.unmatchedTheirs.length >= 6) break;
      if (!byEpgId.has(id)) stats.unmatchedTheirs.push(id);
    }
  }
  return out;
}

/** "20260614200000 +0000" → epoch ms (UTC when no offset is given). */
export function parseXmltvTime(s?: string | null): number | null {
  if (!s) return null;
  const m =
    /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})(?:\s*([+-]\d{4}))?/.exec(
      String(s).trim(),
    );
  if (!m) return null;
  const [, y, mo, d, h, mi, se, tz] = m;
  const offset = tz ? `${tz.slice(0, 3)}:${tz.slice(3)}` : "Z";
  const t = Date.parse(`${y}-${mo}-${d}T${h}:${mi}:${se}${offset}`);
  return Number.isNaN(t) ? null : t;
}

/** Placeholder titles that carry no real info — dropped from the EPG. */
export function isFillerTitle(t: string): boolean {
  if (!t) return true;
  return /^(to be announced|tba|no info(rmation)?|n\/?a|programme|program)\.?$/i.test(
    t,
  );
}
