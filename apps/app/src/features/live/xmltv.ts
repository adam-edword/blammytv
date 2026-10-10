import type { GuideChannel, Programme } from "./model";
import { EPG_KEEP_AHEAD_MS } from "./epgWindow";

/**
 * XMLTV parsing: the panel's `xmltv.php` returns one document covering every
 * channel; we read the programmes out of it, window them to keep the result
 * bounded, and match them to channels by their `epg_channel_id`.
 *
 * READ AS TEXT, NOT AS A DOCUMENT (v0.10.11). This used the WebView's
 * DOMParser, which builds the whole document as a tree before anything can
 * be read from it, and it has to run on the page's own thread. Adam's guide
 * is 105.9MB: 3,323ms in one task, the whole app frozen, on every refresh,
 * which a launch starts right after painting from the disk cache. Measured
 * with freezeProbe on his machine: the 3,325ms long task that froze
 * Multi-view's first open.
 *
 * A worker can do the reading (xmltvThread.ts), but a worker has no
 * DOMParser. And XMLTV asks very little of a parser: three attributes on
 * each <programme> and the text of its first <title> and <desc>. So this
 * scans for those directly, which is also far cheaper than a tree: a
 * programme on a channel we do not carry is skipped at its opening tag,
 * and that is most of them. What a tree gave us for free is done here by
 * hand and tested (xmltv.test.ts): entities and character references,
 * CDATA, either quote style, attributes in any order, markup inside text.
 *
 * More forgiving than the tree was. A single malformed byte (a bare "&" in
 * a title, which providers do send) made DOMParser return a parsererror
 * and the whole guide came back empty; here it costs that one title its
 * ampersand.
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

/** Why a guide matched as few channels as it did. These counts separate
 * "the guide genuinely has nothing for those channels" from "it has the
 * data and we failed to match it", which are completely different
 * problems. */
export interface XmltvStats {
  /** Distinct channel ids the document declares. */
  guideChannels: number;
  /** Our ids that found nothing, and theirs we never used. Samples only. */
  unmatchedOurs: string[];
  unmatchedTheirs: string[];
  /**
   * Guide ids that matched ONLY after normalising case and spacing.
   *
   * The answer to "thin guide or matching bug", in one number. Matching
   * used to be exact string equality, so a provider that disagreed with
   * itself about case ("Sky.Sports.uk" in the panel, "sky.sports.uk" in
   * the document) lost those channels silently and the download carried
   * data we threw away. Anything above zero here is that, measured.
   */
  recovered: number;
}

/**
 * The loose key: trimmed, lower-cased, and with runs of whitespace gone.
 *
 * Deliberately conservative. It does not touch punctuation, because dots
 * and dashes carry meaning in these ids ("bbc.one.uk" is not "bbcone.uk"),
 * and collapsing them would start matching channels to the wrong guide,
 * which is worse than no guide at all.
 */
export const loose = (id: string): string =>
  id.trim().toLowerCase().replace(/\s+/g, " ");

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
  return parseGuide(xml, byEpgId, now, stats).programmes;
}

/**
 * The guide's own channel list: each `<channel>`'s `id` and its first
 * `<display-name>`, trimmed, decoded as a title is. A channel with no
 * display-name is named by its id. Distinct ids, the first one wins. In
 * document order, which is the provider's.
 *
 * It is what a channel the guide didn't match is matched BY HAND against:
 * the programmes of every channel nobody matched are dropped below, and
 * without this their names went with them.
 */
export function readGuideChannels(xml: string): GuideChannel[] {
  const out: GuideChannel[] = [];
  const seen = new Set<string>();
  for (const tag of tags(xml, "channel")) {
    const id = attrs(tag.head).get("id");
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({ id, name: child(tag.body(), "display-name")?.trim() || id });
  }
  return out;
}

/**
 * The parse, with the guide's channel list beside the programmes (the Fix
 * guide dialog's source). One scan of the `<channel>` elements serves both
 * that list and the stats' count, where the stats alone used to read them.
 * Read even when none of our channels carries a guide id, so a playlist
 * with no ids at all still gets a list to match from.
 */
export function parseGuide(
  xml: string,
  byEpgId: Map<string, string[]>,
  now: Date,
  stats?: XmltvStats,
): { programmes: Map<string, Programme[]>; channels: GuideChannel[] } {
  const out = new Map<string, Programme[]>();
  const channels = readGuideChannels(xml);
  if (byEpgId.size === 0) return { programmes: out, channels };

  /**
   * Exact first, loose second.
   *
   * Built once rather than per programme: a big document is hundreds of
   * thousands of <programme> elements, and this is a few thousand keys.
   * Exact keeps priority so nothing that matches today can start matching
   * something else; the loose map only ever answers where exact found
   * nothing. First writer wins on a loose collision — two of our ids
   * differing only by case are the same channel spelled twice, and
   * guessing between them would be worse than taking one.
   */
  const byLoose = new Map<string, string[]>();
  for (const [id, targets] of byEpgId) {
    const k = loose(id);
    if (!byLoose.has(k)) byLoose.set(k, targets);
  }
  /** Guide ids that only the loose map could answer for. */
  const recovered = new Set<string>();
  const lookup = (raw: string): string[] | undefined => {
    const exact = byEpgId.get(raw);
    if (exact) return exact;
    const hit = byLoose.get(loose(raw));
    if (hit) recovered.add(raw);
    return hit;
  };

  const from = now.getTime() - PAST_MS;
  const to = now.getTime() + FUTURE_MS;

  // Only when asked: which of their ids we never used. Cheap (a Set of the
  // document's <channel> ids), and it is the difference between a thin
  // guide and a matching bug.
  const theirs = stats ? new Set(channels.map((c) => c.id)) : null;
  if (stats && theirs) stats.guideChannels = theirs.size;

  /** Programmes that came with no stop: they run until the next one on
   * their channel (XMLTV makes stop optional, and some feeds leave it off),
   * which is only known once each channel's list is sorted, below. They
   * used to be dropped. */
  const open = new Set<Programme>();

  for (const prog of tags(xml, "programme")) {
    const a = attrs(prog.head);
    const targets = lookup(a.get("channel") ?? "");
    if (!targets) continue;
    const start = parseXmltvTime(a.get("start"));
    const stop = parseXmltvTime(a.get("stop"));
    if (start == null || start > to || (stop != null && stop < from)) continue;

    const body = prog.body();
    const title = child(body, "title")?.trim() ?? "";
    // Skip filler entries ("To Be Announced", "No Information", untitled…).
    // Providers often add a day-spanning placeholder that overlaps the real
    // programmes — it collides with them in the guide and clutters the hero.
    if (isFillerTitle(title)) continue;
    const synopsis = child(body, "desc")?.trim() || undefined;

    for (const chId of targets) {
      const list = out.get(chId) ?? [];
      const p: Programme = {
        title,
        synopsis,
        start: new Date(start),
        end: new Date(stop ?? start),
      };
      if (stop == null) open.add(p);
      list.push(p);
      out.set(chId, list);
    }
  }

  for (const [chId, list] of out) {
    list.sort((a, b) => a.start.getTime() - b.start.getTime());
    if (!open.size || !list.some((p) => open.has(p))) continue;
    // An open one ends where the next begins. The last one on its channel
    // has nothing to end it and is left out, as before.
    const kept = list.filter((p, i) => {
      if (!open.has(p)) return true;
      const next = list[i + 1];
      if (!next) return false;
      p.end = new Date(next.start.getTime());
      return p.end.getTime() >= from;
    });
    out.set(chId, kept);
  }
  if (stats && theirs) {
    stats.recovered = recovered.size;
    // Ours that got nothing: the guide either lacks them or spells them
    // differently. Theirs we never touched: data sitting unused. Comparing
    // the two samples side by side is what reveals a case/format mismatch.
    // Loose on both sides here too, or the samples report a mismatch the
    // parser just recovered from and send the reader chasing a fixed bug.
    const theirsLoose = new Set([...theirs].map(loose));
    for (const id of byEpgId.keys()) {
      if (stats.unmatchedOurs.length >= 6) break;
      if (!theirsLoose.has(loose(id))) stats.unmatchedOurs.push(id);
    }
    for (const id of theirs) {
      if (stats.unmatchedTheirs.length >= 6) break;
      if (!byLoose.has(loose(id))) stats.unmatchedTheirs.push(id);
    }
  }
  return { programmes: out, channels };
}

/**
 * Every `<name …>` element in the document, in order: its opening tag's
 * attribute text, and its content on demand (most programmes are skipped
 * before anyone asks).
 *
 * The opening tag is matched with its quotes respected, so a ">" inside
 * an attribute value cannot end it early. `<name/>` has no content.
 */
const OPENERS = new Map<string, RegExp>();

function* tags(xml: string, name: string): Generator<{ head: string; body: () => string }> {
  // One per name, not per call: this runs twice for every programme kept.
  // Sticky, so each use starts where it is pointed; no two walks of the
  // same name are ever open at once.
  let open = OPENERS.get(name);
  if (!open) {
    open = new RegExp(`<${name}(?=[\\s/>])((?:[^>"']|"[^"]*"|'[^']*')*)>`, "y");
    OPENERS.set(name, open);
  }
  const close = `</${name}`;
  let i = 0;
  for (;;) {
    const at = xml.indexOf(`<${name}`, i);
    if (at === -1) return;
    open.lastIndex = at;
    const m = open.exec(xml);
    if (!m) {
      i = at + name.length + 1;
      continue;
    }
    const headEnd = open.lastIndex;
    const selfClosing = m[1].endsWith("/");
    const head = selfClosing ? m[1].slice(0, -1) : m[1];
    let bodyEnd = headEnd;
    if (!selfClosing) {
      const c = xml.indexOf(close, headEnd);
      bodyEnd = c === -1 ? xml.length : c;
    }
    const from = headEnd;
    const to = bodyEnd;
    yield { head, body: () => (selfClosing ? "" : xml.slice(from, to)) };
    i = selfClosing ? headEnd : bodyEnd + close.length;
  }
}

const ATTR = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;

/** An opening tag's attributes, values decoded. */
function attrs(head: string): Map<string, string> {
  const out = new Map<string, string>();
  ATTR.lastIndex = 0;
  for (let m = ATTR.exec(head); m; m = ATTR.exec(head))
    out.set(m[1], decode(m[2] ?? m[3] ?? "").replace(/[\t\n\r]/g, " "));
  return out;
}

/** The text of the first `<name>` in `body`, as DOMParser's textContent
 * gave it: entities decoded, CDATA as written, markup inside dropped. */
function child(body: string, name: string): string | undefined {
  for (const t of tags(body, name)) return text(t.body());
  return undefined;
}

function text(inner: string): string {
  let out = "";
  let i = 0;
  while (i < inner.length) {
    const c = inner.indexOf("<![CDATA[", i);
    const plain = inner.slice(i, c === -1 ? inner.length : c);
    out += decode(plain.includes("<") ? plain.replace(/<!--[\s\S]*?-->|<[^>]*>/g, "") : plain);
    if (c === -1) break;
    const e = inner.indexOf("]]>", c + 9);
    out += inner.slice(c + 9, e === -1 ? inner.length : e);
    i = e === -1 ? inner.length : e + 3;
  }
  return out;
}

const NAMED: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };

/** XML's five named entities and its character references. Anything else
 * is left as written: HTML's &nbsp; is not XML, and the tree refused the
 * whole document over it. */
function decode(s: string): string {
  if (!s.includes("&")) return s;
  return s.replace(/&(#[xX][0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g, (m, e: string) => {
    if (e[0] !== "#") return NAMED[e] ?? m;
    const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return code >= 0 && code <= 0x10ffff ? String.fromCodePoint(code) : m;
  });
}

/**
 * "20260614200000 +0000" → epoch ms (UTC when no offset is given).
 *
 * The spec lets a time be cut short from the right ("202606142000" has no
 * seconds, "20260614" is midnight) and some feeds do it; those were read
 * as nothing and their programmes dropped (plan 016, F17). An offset
 * written "+05:30" was not recognised either and the time read as UTC,
 * five and a half hours out.
 */
export function parseXmltvTime(s?: string | null): number | null {
  if (!s) return null;
  const m =
    /^(\d{4})(\d{2})(\d{2})(?:(\d{2})(?:(\d{2})(\d{2})?)?)?\s*(?:([+-])(\d{2}):?(\d{2}))?/.exec(
      String(s).trim(),
    );
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", se = "00", sign, oh, om] = m;
  const offset = sign ? `${sign}${oh}:${om}` : "Z";
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
