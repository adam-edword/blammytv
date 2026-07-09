/**
 * M3U / M3U8 playlist parsing — a pure, standalone reader for the extended
 * M3U format IPTV providers ship. The shape of a real file:
 *
 *   #EXTM3U
 *   #EXTINF:-1 tvg-id="bbc1.uk" tvg-logo="http://…/bbc1.png" group-title="UK",BBC One
 *   http://provider.tv/live/user/pass/12345.ts
 *
 * i.e. an optional header, then repeating pairs of an `#EXTINF` metadata line
 * followed by the stream's URL. Providers are sloppy in every direction, so
 * this parser is deliberately permissive: it tolerates a missing header, blank
 * lines, junk comments, Windows/Unix endings, `#EXTGRP` group lines, and
 * `#EXTVLCOPT`/other `#EXT` directives — and it never throws, returning
 * whatever parsed cleanly.
 *
 * This module is format-handling only; wiring the entries into the
 * source-loading pipeline lives elsewhere.
 */

export interface M3uEntry {
  /** The stream URL — the first non-comment line after the `#EXTINF`. */
  url: string;
  /** Display name: everything after the last unquoted comma on the EXTINF
   * line (falls back to `tvg-name`, then the URL, when that's empty). */
  name: string;
  /** `tvg-logo` — channel artwork. */
  logo?: string;
  /** The folder / category, from `group-title` or a preceding `#EXTGRP`. */
  groupTitle?: string;
  /** `tvg-id` — the EPG channel id used to match guide listings. */
  tvgId?: string;
  /** `tvg-name` — the provider's canonical channel name. */
  tvgName?: string;
  /** Channel number, from `tvg-chno` or `channel-number` when present. */
  channelNumber?: number;
}

/** The metadata half of an entry, parsed from `#EXTINF` before its URL lands. */
interface PendingEntry {
  name: string;
  logo?: string;
  groupTitle?: string;
  tvgId?: string;
  tvgName?: string;
  channelNumber?: number;
}

/**
 * Parse an extended M3U/M3U8 document into channel entries.
 *
 * Each entry needs both an `#EXTINF` line and a following URL line; an EXTINF
 * with no URL is dropped. A URL line is any non-blank line that doesn't start
 * with `#`. Lines that are neither (stray comments, unknown `#EXT` directives)
 * are ignored without disturbing the entry in progress.
 */
export function parseM3U(text: string): M3uEntry[] {
  const entries: M3uEntry[] = [];
  if (!text) return entries;

  // Normalize CRLF / lone-CR endings and strip a leading UTF-8 BOM.
  const lines = text.replace(/^\uFEFF/, "").split(/\r\n|\r|\n/);

  let pending: PendingEntry | null = null;
  // `#EXTGRP` supplies the group for the next entry that lacks its own
  // group-title; it's consumed when that entry completes.
  let pendingGroup: string | undefined;

  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#")) {
      if (/^#EXTINF:/i.test(line)) {
        // A new EXTINF abandons any prior one still waiting for its URL.
        pending = parseExtinf(line.slice(line.indexOf(":") + 1));
      } else if (/^#EXTGRP:/i.test(line)) {
        pendingGroup = line.slice(line.indexOf(":") + 1).trim() || undefined;
      }
      // Every other `#` line (the header, #EXTVLCOPT, plain comments) is
      // ignored and must never be mistaken for a URL.
      continue;
    }

    // A bare URL with no preceding #EXTINF has no metadata to attach — skip it.
    if (!pending) continue;

    const groupTitle = pending.groupTitle ?? pendingGroup;
    entries.push({
      url: line,
      name: pending.name || pending.tvgName || line,
      ...(pending.logo ? { logo: pending.logo } : {}),
      ...(groupTitle ? { groupTitle } : {}),
      ...(pending.tvgId ? { tvgId: pending.tvgId } : {}),
      ...(pending.tvgName ? { tvgName: pending.tvgName } : {}),
      ...(pending.channelNumber != null
        ? { channelNumber: pending.channelNumber }
        : {}),
    });

    pending = null;
    pendingGroup = undefined;
  }

  return entries;
}

/**
 * Parse the body of an `#EXTINF` line (everything after `#EXTINF:`), e.g.
 * `-1 tvg-id="x" group-title="UK",BBC One`. The display name is everything
 * after the LAST unquoted comma; the attribute soup is what precedes it.
 */
function parseExtinf(body: string): PendingEntry {
  const comma = lastUnquotedComma(body);
  const attrPart = comma === -1 ? body : body.slice(0, comma);
  const name = comma === -1 ? "" : body.slice(comma + 1).trim();

  const attrs = parseAttributes(attrPart);
  const chno = attrs["tvg-chno"] ?? attrs["channel-number"];
  // Positive integers only: `tvg-chno=""` coerces to 0 (the Number("")
  // footgun) and some providers ship junk negatives — same guard as the
  // Xtream side's channelNumber().
  const channelNumber = chno != null ? Math.floor(Number(chno)) : Number.NaN;

  return {
    name,
    logo: attrs["tvg-logo"] || undefined,
    groupTitle: attrs["group-title"] || undefined,
    tvgId: attrs["tvg-id"] || undefined,
    tvgName: attrs["tvg-name"] || undefined,
    channelNumber:
      Number.isFinite(channelNumber) && channelNumber > 0
        ? channelNumber
        : undefined,
  };
}

/** Index of the last comma that isn't inside double quotes, or -1. Values
 * like `group-title="Movies, HD"` carry commas that must not split the name. */
function lastUnquotedComma(s: string): number {
  let inQuote = false;
  let last = -1;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c === '"') inQuote = !inQuote;
    else if (c === "," && !inQuote) last = i;
  }
  return last;
}

/** Pull `key="value"` pairs out of the EXTINF attribute soup. Keys are
 * lowercased; values keep their raw text (commas and spaces included). */
function parseAttributes(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)\s*=\s*"([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(s)) !== null) out[m[1].toLowerCase()] = m[2];
  return out;
}
