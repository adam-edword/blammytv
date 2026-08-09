import { load, save } from "../../lib/storage";

/**
 * The languages you want, set once, applied to every VOD stream.
 *
 * WHY THIS EXISTS ALONGSIDE playbackPrefs. The player already carried a
 * preferred language, but only as something it LEARNED: `rememberPlayback`
 * writes the global answer on every explicit track click, so your default
 * was whatever you last picked anywhere. That works once you have used the
 * app for a while and does nothing at all on a fresh install, which is the
 * moment someone who does not want English audio most needs it.
 *
 * This is the SET version of the same idea. It changes no player code:
 * `loadPlaybackPrefs` resolves it into the same `audioLang` / `subLang`
 * fields the track-selection effect already reads.
 *
 * PRECEDENCE, decided here and documented in loadPlaybackPrefs:
 *
 *   per-show memory  >  this setting  >  the learned global
 *
 * A per-show choice is the most specific thing you have ever said, so it
 * still wins: an anime pinned to Japanese audio stays that way. But this
 * setting beats the learned global, because a value you typed into Settings
 * should not be silently replaced by a side effect of one click on one
 * show. Before this existed, picking Japanese once made every new show
 * Japanese, and there was no screen anywhere that would tell you why.
 *
 * Unset means unset. With no preference stored, resolution falls straight
 * through to the old behaviour, so nothing changes for anyone who never
 * opens this control.
 */

/** ISO-639-1, matched against a track by playbackPrefs' `matchTrack`. */
export interface LanguageOption {
  code: string;
  label: string;
}

/**
 * What the pickers offer.
 *
 * Deliberately the same set playbackPrefs' NAMES table can normalise, so a
 * language offered here can always be recognised on a real track. Ordered
 * by how often it is wanted rather than alphabetically: the top of a list
 * of thirty is the only part most people read.
 */
export const LANGUAGES: readonly LanguageOption[] = [
  { code: "en", label: "English" },
  { code: "es", label: "Spanish" },
  { code: "fr", label: "French" },
  { code: "de", label: "German" },
  { code: "it", label: "Italian" },
  { code: "pt", label: "Portuguese" },
  { code: "ja", label: "Japanese" },
  { code: "ko", label: "Korean" },
  { code: "zh", label: "Chinese" },
  { code: "hi", label: "Hindi" },
  { code: "ar", label: "Arabic" },
  { code: "ru", label: "Russian" },
  { code: "nl", label: "Dutch" },
  { code: "pl", label: "Polish" },
  { code: "tr", label: "Turkish" },
  { code: "sv", label: "Swedish" },
  { code: "no", label: "Norwegian" },
  { code: "da", label: "Danish" },
  { code: "fi", label: "Finnish" },
  { code: "cs", label: "Czech" },
  { code: "el", label: "Greek" },
  { code: "he", label: "Hebrew" },
  { code: "th", label: "Thai" },
  { code: "vi", label: "Vietnamese" },
  { code: "id", label: "Indonesian" },
  { code: "uk", label: "Ukrainian" },
  { code: "ro", label: "Romanian" },
  { code: "hu", label: "Hungarian" },
];

const VALID = new Set(LANGUAGES.map((l) => l.code));

/** No preference. Resolution falls through to the old behaviour. */
export const AUTO = "";
/** Subtitles only: explicitly none, rather than "no preference". */
export const SUBS_OFF = "off";

const AUDIO_KEY = "preferredAudioLang";
const SUB_KEY = "preferredSubLang";
const VERSION = 1;
const EVENT = "blammytv:language-prefs";

/** A stored value that no longer means anything reads as unset, the same
 * way a stale follow key does in sports: a code we cannot match must not be
 * able to sit in the setting silently doing nothing. */
const cleanAudio = (v: string): string => (VALID.has(v) ? v : AUTO);
const cleanSub = (v: string): string =>
  v === SUBS_OFF || VALID.has(v) ? v : AUTO;

export function loadAudioLang(): string {
  return cleanAudio(load<string>(AUDIO_KEY, VERSION, AUTO));
}

export function loadSubLang(): string {
  return cleanSub(load<string>(SUB_KEY, VERSION, AUTO));
}

export function saveAudioLang(v: string): void {
  save(AUDIO_KEY, VERSION, cleanAudio(v));
  window.dispatchEvent(new CustomEvent(EVENT));
}

export function saveSubLang(v: string): void {
  save(SUB_KEY, VERSION, cleanSub(v));
  window.dispatchEvent(new CustomEvent(EVENT));
}

/** For anything that wants to react without a remount. */
export function onLanguagePrefsChange(cb: () => void): () => void {
  window.addEventListener(EVENT, cb);
  return () => window.removeEventListener(EVENT, cb);
}
