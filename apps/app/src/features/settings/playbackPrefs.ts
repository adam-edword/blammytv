import { load, save } from "../../lib/storage";
import type { TrackEntry } from "../live/overlayApi";

/**
 * VOD playback continuity: the user's last EXPLICIT track/speed choices,
 * re-applied when the next episode's fresh mpv instance comes up (every
 * stream is a new instance, so choices die with the file otherwise — the
 * "subs vanish every Up Next roll" complaint). Captured only from real
 * clicks in the player menus, matched by LANGUAGE (track ids are
 * per-file and meaningless across episodes). Live TV never touches this.
 */

export interface PlaybackPrefs {
  /** Preferred audio language (mpv lang code as seen on a track). */
  audioLang?: string;
  /** Preferred subtitle language, or "off" for explicitly no subs. */
  subLang?: string;
  /** Last chosen playback rate. */
  speed?: number;
}

const KEY = "playbackPrefs";
const VERSION = 1;

export function loadPlaybackPrefs(): PlaybackPrefs {
  return load<PlaybackPrefs>(KEY, VERSION, {});
}

export function rememberPlayback(patch: Partial<PlaybackPrefs>): void {
  save(KEY, VERSION, { ...loadPlaybackPrefs(), ...patch });
}

/** ISO-ish language normalization: "eng" / "en" / "en-US" all agree.
 * Conservative — an empty/unknown lang never matches anything. */
function langKey(s: string): string {
  const base = s.trim().toLowerCase().split(/[-_]/)[0];
  // Two- and three-letter codes for the same language share a prefix in
  // practice (en/eng, ja/jpn is the exception handled by the alias map).
  const ALIAS: Record<string, string> = {
    jpn: "ja",
    ger: "de",
    deu: "de",
    fre: "fr",
    fra: "fr",
    spa: "es",
    ita: "it",
    por: "pt",
    rus: "ru",
    kor: "ko",
    chi: "zh",
    zho: "zh",
  };
  if (ALIAS[base]) return ALIAS[base];
  return base.length === 3 ? base.slice(0, 2) : base;
}

/** The track matching a remembered language, if any. Lang field first,
 * label as fallback (some files only label tracks "English"). */
export function matchTrack(
  tracks: TrackEntry[],
  want: string,
): TrackEntry | undefined {
  const w = langKey(want);
  if (!w) return undefined;
  return (
    tracks.find((t) => t.lang && langKey(t.lang) === w) ??
    tracks.find((t) => langKey(t.label) === w)
  );
}
