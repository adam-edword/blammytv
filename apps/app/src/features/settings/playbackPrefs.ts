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
  /** Output level, 0-1. Unlike the fields above this is device-level, not
   * VOD-only: it rides EVERY playback (live included). Volume lived only
   * in component state, so the popout round-trip — which unmounts the
   * chrome — restored 100% and pushed it to mpv. */
  volume?: number;
  /** Muted, same scope as volume. */
  muted?: boolean;
}

const KEY = "playbackPrefs";
const VERSION = 1;

export function loadPlaybackPrefs(): PlaybackPrefs {
  return load<PlaybackPrefs>(KEY, VERSION, {});
}

export function rememberPlayback(patch: Partial<PlaybackPrefs>): void {
  save(KEY, VERSION, { ...loadPlaybackPrefs(), ...patch });
}

/** Language NAMES as providers write them, mapped to the same codes. A
 * remux often ships tracks with an empty `lang` and only a human label
 * ("English SDH", "Japanese (FLAC 2.0)"), so a pick on one file was stored
 * as a name and could never match the next file's `eng`. Normalizing both
 * sides to one key is what makes a remembered choice survive an episode
 * boundary on those files. */
const NAMES: Record<string, string> = {
  english: "en",
  japanese: "ja",
  spanish: "es",
  castilian: "es",
  french: "fr",
  german: "de",
  italian: "it",
  portuguese: "pt",
  brazilian: "pt",
  russian: "ru",
  korean: "ko",
  chinese: "zh",
  mandarin: "zh",
  cantonese: "zh",
  dutch: "nl",
  polish: "pl",
  turkish: "tr",
  arabic: "ar",
  hindi: "hi",
  swedish: "sv",
  norwegian: "no",
  danish: "da",
  finnish: "fi",
  czech: "cs",
  greek: "el",
  hebrew: "he",
  thai: "th",
  vietnamese: "vi",
  indonesian: "id",
  ukrainian: "uk",
  romanian: "ro",
  hungarian: "hu",
};

/** ISO-ish language normalization: "eng", "en", "en-US", and "English SDH"
 * all agree. Conservative: an empty or unrecognized value never matches
 * anything, so a wrong guess can't hijack a track the user didn't pick. */
function langKey(s: string): string {
  // Labels carry decoration the language never does: "English (AC3 5.1)",
  // "Japanese [Dub]", "Spanish - Latin America". Take the leading word and
  // let the tables below decide whether it means anything.
  const head = s
    .trim()
    .toLowerCase()
    .replace(/[([].*$/, "")
    .split(/[-_,/|]/)[0]
    .trim()
    .split(/\s+/)[0];
  if (!head) return "";
  if (NAMES[head]) return NAMES[head];
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
  if (ALIAS[head]) return ALIAS[head];
  // Only code-shaped leftovers are keys. A stray word ("commentary",
  // "forced") must NOT become a matchable key, or it would collide with
  // the same word on an unrelated track.
  return head.length === 2 || head.length === 3
    ? head.length === 3
      ? head.slice(0, 2)
      : head
    : "";
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
