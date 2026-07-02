import type { Programme } from "./model";

/**
 * XMLTV parsing, ported from the old build's proven mapper: the panel's
 * `xmltv.php` returns one document covering every channel; we parse it with
 * the WebView's native DOMParser, window it to keep the result bounded, and
 * match programmes to channels by their `epg_channel_id`.
 */

/** Keep an hour of history (the guide window opens slightly in the past)
 * and half a day of future listings. */
const PAST_MS = 60 * 60 * 1000;
const FUTURE_MS = 12 * 60 * 60 * 1000;

/**
 * Parse an XMLTV document into per-channel programme lists.
 *
 * @param byEpgId epg channel id → our channel ids (one EPG feed can back
 *   several channels, e.g. the same channel in two categories).
 */
export function parseXmltv(
  xml: string,
  byEpgId: Map<string, string[]>,
  now: Date,
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
