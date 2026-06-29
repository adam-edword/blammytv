/**
 * Parser for hosted M3U / M3U8 playlists (the IPTV "extended M3U" dialect).
 *
 * Shape we read:
 *   #EXTM3U url-tvg="http://epg.xml" x-tvg-url="..."
 *   #EXTINF:-1 tvg-id="BBC1.uk" tvg-logo="http://logo.png" group-title="UK",BBC One
 *   #EXTGRP:UK            (alternative grouping some providers use)
 *   http://server/live/1
 *
 * Tolerant by design: unknown `#…` directives (e.g. `#EXTVLCOPT`) are skipped,
 * and an entry is only kept once it has an http(s) URL.
 */

export interface M3uEntry {
  name: string;
  url: string;
  logo?: string;
  groupTitle?: string;
  /** tvg-id, used to match XMLTV EPG. */
  tvgId?: string;
}

export interface ParsedM3u {
  entries: M3uEntry[];
  /** EPG URL from the `#EXTM3U` header (`url-tvg` / `x-tvg-url`), if present. */
  epgUrl?: string;
}

/** Pull `key="value"` attributes out of an #EXTINF / #EXTM3U line. */
function parseAttrs(line: string): Record<string, string> {
  const out: Record<string, string> = {};
  const re = /([\w-]+)="([^"]*)"/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(line)) !== null) out[m[1].toLowerCase()] = m[2];
  return out;
}

export function parseM3u(text: string): ParsedM3u {
  const entries: M3uEntry[] = [];
  let epgUrl: string | undefined;
  let pending: M3uEntry | null = null;

  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;

    if (line.startsWith("#EXTM3U")) {
      const attrs = parseAttrs(line);
      let tvg = attrs["url-tvg"] || attrs["x-tvg-url"] || attrs["tvg-url"];
      // The header may list several comma-separated EPG URLs — take the first.
      if (tvg && tvg.includes(",")) tvg = tvg.split(",")[0]!.trim();
      if (tvg) epgUrl = tvg;
      continue;
    }

    if (line.startsWith("#EXTINF")) {
      const attrs = parseAttrs(line);
      const comma = line.indexOf(",");
      const label = comma >= 0 ? line.slice(comma + 1).trim() : "";
      pending = {
        name: label || attrs["tvg-name"] || "Channel",
        url: "",
        logo: attrs["tvg-logo"] || undefined,
        groupTitle: attrs["group-title"] || undefined,
        tvgId: attrs["tvg-id"] || undefined,
      };
      continue;
    }

    if (line.startsWith("#EXTGRP")) {
      const g = line.slice(line.indexOf(":") + 1).trim();
      if (pending && g && !pending.groupTitle) pending.groupTitle = g;
      continue;
    }

    if (line.startsWith("#")) continue; // any other directive — ignore

    // A non-comment line is the stream URL for the pending #EXTINF.
    if (pending) {
      if (/^https?:\/\//i.test(line)) {
        pending.url = line;
        entries.push(pending);
      }
      pending = null;
    }
  }

  return { entries, epgUrl };
}
